//! Provider adapter: file sink for dev, no vendor SDK in core.

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_EMAIL_FROM: &str = "sezs@permissionless.money";

#[derive(Debug, Clone, Serialize)]
pub struct EmailMessage {
    pub to: String,
    pub from: String,
    pub subject: String,
    pub text: String,
    #[serde(rename = "tokenRef")]
    pub token_ref: Option<String>,
    pub at: i64,
}

pub trait EmailProvider: Send + Sync {
    fn send_email(&self, msg: EmailMessage) -> Result<(), String>;
}

pub fn resolve_email_from(env: &[(&str, String)]) -> String {
    env.iter()
        .find(|(k, _)| *k == "SEZS_EMAIL_FROM")
        .map(|(_, v)| v.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_EMAIL_FROM.into())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn with_from(mut msg: EmailMessage, from: &str) -> EmailMessage {
    if msg.from.trim().is_empty() {
        msg.from = from.to_string();
    }
    msg
}

pub struct MemorySink {
    pub inbox: Mutex<Vec<EmailMessage>>,
    from: String,
}

impl MemorySink {
    pub fn new() -> Self {
        Self {
            inbox: Mutex::new(Vec::new()),
            from: DEFAULT_EMAIL_FROM.into(),
        }
    }
    pub fn with_from(from: String) -> Self {
        Self {
            inbox: Mutex::new(Vec::new()),
            from,
        }
    }
    pub fn last(&self) -> Option<EmailMessage> {
        self.inbox.lock().unwrap().last().cloned()
    }
    pub fn len(&self) -> usize {
        self.inbox.lock().unwrap().len()
    }
}

impl Default for MemorySink {
    fn default() -> Self {
        Self::new()
    }
}

impl EmailProvider for MemorySink {
    fn send_email(&self, msg: EmailMessage) -> Result<(), String> {
        let mail = with_from(
            EmailMessage {
                at: if msg.at == 0 { now_ms() } else { msg.at },
                ..msg
            },
            &self.from,
        );
        self.inbox.lock().unwrap().push(mail);
        Ok(())
    }
}

pub struct FileSink {
    dir: PathBuf,
    seq: Mutex<u64>,
    from: String,
}

impl FileSink {
    pub fn new(dir: impl AsRef<Path>) -> std::io::Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        }
        Ok(Self {
            dir,
            seq: Mutex::new(0),
            from: DEFAULT_EMAIL_FROM.into(),
        })
    }
}

impl EmailProvider for FileSink {
    fn send_email(&self, msg: EmailMessage) -> Result<(), String> {
        let mail = with_from(
            EmailMessage {
                at: if msg.at == 0 { now_ms() } else { msg.at },
                ..msg
            },
            &self.from,
        );
        let mut seq = self.seq.lock().unwrap();
        let n = *seq;
        *seq += 1;
        drop(seq);
        let ref_id = mail
            .token_ref
            .as_deref()
            .unwrap_or("msg")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .take(64)
            .collect::<String>();
        let ref_id = if ref_id.is_empty() {
            "msg".into()
        } else {
            ref_id
        };
        let name = format!("{}-{}-{}-{}.json", mail.at, std::process::id(), n, ref_id);
        let path = self.dir.join(&name);
        let tmp = self
            .dir
            .join(format!("{}.{}.tmp", name, std::process::id()));
        let body = serde_json::to_vec_pretty(&mail).map_err(|e| e.to_string())?;
        {
            let mut opts = OpenOptions::new();
            opts.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                opts.mode(0o600);
            }
            let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
            f.write_all(&body).map_err(|e| e.to_string())?;
        }
        fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

pub struct UnavailableSink;

impl EmailProvider for UnavailableSink {
    fn send_email(&self, _msg: EmailMessage) -> Result<(), String> {
        Err("email_provider_not_configured".into())
    }
}

/// Resolve the provider from env. Production never uses the file sink.
/// No vendor SDK is selected here.
pub fn create_email_provider_from_env(
    env: &[(&str, String)],
    fallback_dir: Option<&Path>,
) -> Box<dyn EmailProvider> {
    let from = resolve_email_from(env);
    let mode = env
        .iter()
        .find(|(k, _)| *k == "SEZS_EMAIL_PROVIDER")
        .map(|(_, v)| v.trim().to_lowercase())
        .unwrap_or_else(|| {
            let prod = env
                .iter()
                .any(|(k, v)| (*k == "NODE_ENV" || *k == "SEZS_ENV") && v == "production");
            if prod {
                "none".into()
            } else {
                "file".into()
            }
        });
    let prod = env
        .iter()
        .any(|(k, v)| (*k == "NODE_ENV" || *k == "SEZS_ENV") && v == "production");
    if mode == "file" && !prod {
        let dir = env
            .iter()
            .find(|(k, _)| *k == "SEZS_EMAIL_OUTBOX_DIR")
            .map(|(_, v)| PathBuf::from(v))
            .or_else(|| fallback_dir.map(|p| p.to_path_buf()));
        if let Some(dir) = dir {
            if let Ok(sink) = FileSink::new(dir) {
                return Box::new(Prefixed { inner: sink, from });
            }
        }
    }
    Box::new(Prefixed {
        inner: UnavailableSink,
        from,
    })
}

struct Prefixed<T> {
    inner: T,
    from: String,
}

impl<T: EmailProvider> EmailProvider for Prefixed<T> {
    fn send_email(&self, mut msg: EmailMessage) -> Result<(), String> {
        if msg.from.trim().is_empty() {
            msg.from = self.from.clone();
        }
        self.inner.send_email(msg)
    }
}
