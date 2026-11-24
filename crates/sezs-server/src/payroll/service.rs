//! Coordinator-gated `/sezs/payroll/*` handlers.
use super::itl_frost::{self, FROST_N, FROST_T};
use super::store::{
    accept_signature, create_invite, execute_batch, list_public, load_payroll, mark_signing,
    propose_batch, register_with_key, save_payroll, set_amounts, PayrollState,
};
use serde_json::{json, Value};
use sezs_frost_payroll::run_ceremony;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct HandlerOut {
    pub status: u16,
    pub body: Value,
    pub headers: Vec<(String, String)>,
}

fn out(status: u16, body: Value) -> HandlerOut {
    HandlerOut {
        status,
        body,
        headers: vec![],
    }
}

/// How coordinator-gated routes are authorized.
#[derive(Clone, Debug, Default)]
pub enum PayrollGate {
    /// Tests and the in-process desk when explicitly opened.
    Open,
    /// Require a session cookie; allow admin roles or the dev override.
    #[default]
    Session,
}

pub struct PayrollServiceConfig {
    pub path: PathBuf,
    pub gate: PayrollGate,
    pub cookie_name: String,
    pub dev_coordinator: bool,
    pub share_local: String,
    pub share_public: String,
}

impl Default for PayrollServiceConfig {
    fn default() -> Self {
        Self {
            path: PathBuf::from("payroll.json"),
            gate: PayrollGate::Session,
            cookie_name: "sezs_session".into(),
            dev_coordinator: false,
            share_local: "http://127.0.0.1:3051".into(),
            share_public: "https://permissionless.money/sez".into(),
        }
    }
}

pub struct PayrollService {
    cfg: PayrollServiceConfig,
    state: Mutex<PayrollState>,
}

pub fn share_urls(local: &str, public: &str, key: &str) -> Value {
    let enc = urlencoding_loose(key);
    json!({
        "local": format!("{local}/register?c={enc}"),
        "public": format!("{public}/register?c={enc}"),
    })
}

fn urlencoding_loose(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.as_str())
}

impl PayrollService {
    pub fn new(cfg: PayrollServiceConfig) -> Result<Self, String> {
        let state = load_payroll(&cfg.path)?;
        Ok(Self {
            cfg,
            state: Mutex::new(state),
        })
    }

    pub fn with_open_gate(path: PathBuf) -> Result<Self, String> {
        let mut cfg = PayrollServiceConfig::default();
        cfg.path = path;
        cfg.gate = PayrollGate::Open;
        Self::new(cfg)
    }

    fn persist(&self, state: &PayrollState) -> Result<(), String> {
        save_payroll(state, &self.cfg.path)
    }

    fn cookie_of(&self, headers: &[(String, String)]) -> Option<String> {
        let cookie = header(headers, "cookie")?;
        let name = regex::escape(&self.cfg.cookie_name);
        let re = regex::Regex::new(&format!(r"(?:^|;\s*){name}=([^;]+)")).ok()?;
        re.captures(cookie)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
    }

    fn refusal_for(&self, role: Option<&str>) -> Option<Value> {
        match role {
            None => Some(json!({
                "error": "not_member",
                "message": "Sign in with a ZID or passkey first."
            })),
            Some("usher") => Some(json!({
                "error": "usher_forbidden",
                "message": "Ushers may only check in holders and use usher chat."
            })),
            Some(r) if matches!(r, "admin" | "coordinator" | "frost_admin") => None,
            Some(_) => Some(json!({
                "error": "not_coordinator",
                "message": "Only a registered event admin or coordinator may do this."
            })),
        }
    }

    fn require_coordinator(&self, headers: &[(String, String)]) -> Option<HandlerOut> {
        match self.cfg.gate {
            PayrollGate::Open => None,
            PayrollGate::Session => {
                if self.cookie_of(headers).is_none() {
                    return Some(out(
                        403,
                        json!({"ok": false, "error": "not_member", "message": "Sign in with a ZID or passkey first."}),
                    ));
                }
                let role = header(headers, "x-sezs-role").or(if self.cfg.dev_coordinator {
                    Some("coordinator")
                } else {
                    None
                });
                // Session-backed live role is resolved by the desk in Node; here
                // a signed-in caller is a guest unless the dev override or an
                // explicit role header (tests / live-role adapter) is set.
                if let Some(denied) = self.refusal_for(role) {
                    let mut body = denied;
                    if let Some(obj) = body.as_object_mut() {
                        obj.insert("ok".into(), json!(false));
                    }
                    return Some(out(403, body));
                }
                None
            }
        }
    }

    pub fn handle(
        &self,
        method: &str,
        path: &str,
        headers: &[(String, String)],
        body: &Value,
    ) -> HandlerOut {
        let full = if path.starts_with("/sezs/") {
            path.to_string()
        } else {
            format!("/sezs{path}")
        };
        match (method, full.as_str()) {
            ("GET", "/sezs/payroll/state") => self.gated(headers, |state| list_public(state)),
            ("POST", "/sezs/payroll/invites") => self.gated(headers, |state| {
                let role = body.get("role").and_then(|v| v.as_str()).unwrap_or("");
                let label = body.get("label").and_then(|v| v.as_str()).unwrap_or("");
                let r = create_invite(state, role, label);
                if r.get("ok") == Some(&Value::Bool(true)) {
                    if let Err(e) = self.persist(state) {
                        return json!({"ok": false, "error": e});
                    }
                    let key = r.get("key").and_then(|v| v.as_str()).unwrap_or("");
                    json!({
                        "ok": true,
                        "invite": r.get("invite"),
                        "share": share_urls(&self.cfg.share_local, &self.cfg.share_public, key),
                        "key": key,
                    })
                } else {
                    r
                }
            }),
            ("POST", "/sezs/payroll/register") => {
                let mut g = self.state.lock().unwrap();
                let r = register_with_key(&mut g, body);
                if r.get("ok") == Some(&Value::Bool(true)) {
                    if let Err(e) = self.persist(&g) {
                        return out(200, json!({"ok": false, "error": e}));
                    }
                }
                out(200, r)
            }
            ("POST", "/sezs/payroll/amounts") => self.gated(headers, |state| {
                let r = set_amounts(state, body);
                if r.get("ok") == Some(&Value::Bool(true)) {
                    if let Err(e) = self.persist(state) {
                        return json!({"ok": false, "error": e});
                    }
                    let mut pub_s = list_public(state);
                    if let Some(obj) = pub_s.as_object_mut() {
                        obj.insert("ok".into(), json!(true));
                    }
                    return pub_s;
                }
                r
            }),
            ("POST", "/sezs/payroll/batches") => self.gated(headers, |state| {
                let note = body.get("note").and_then(|v| v.as_str()).unwrap_or("");
                let r = propose_batch(state, note);
                if r.get("ok") == Some(&Value::Bool(true)) {
                    if let Err(e) = self.persist(state) {
                        return json!({"ok": false, "error": e});
                    }
                }
                r
            }),
            ("POST", "/sezs/payroll/batches/frost") => self.frost(headers, body),
            ("POST", "/sezs/payroll/batches/execute") => self.gated(headers, |state| {
                let batch_id = body.get("batchId").and_then(|v| v.as_str()).unwrap_or("");
                let payout = body.get("payout").cloned();
                let r = execute_batch(state, batch_id, payout);
                if r.get("ok") == Some(&Value::Bool(true)) {
                    if let Err(e) = self.persist(state) {
                        return json!({"ok": false, "error": e});
                    }
                }
                r
            }),
            _ => out(404, json!({"ok": false, "error": "not_found"})),
        }
    }

    fn gated(
        &self,
        headers: &[(String, String)],
        f: impl FnOnce(&mut PayrollState) -> Value,
    ) -> HandlerOut {
        if let Some(denied) = self.require_coordinator(headers) {
            return denied;
        }
        let mut g = self.state.lock().unwrap();
        out(200, f(&mut g))
    }

    fn frost(&self, headers: &[(String, String)], body: &Value) -> HandlerOut {
        if let Some(denied) = self.require_coordinator(headers) {
            return denied;
        }
        let batch_id = body.get("batchId").and_then(|v| v.as_str()).unwrap_or("");
        let mut g = self.state.lock().unwrap();
        let digest = match g.batches.iter().find(|x| x.id == batch_id) {
            Some(b) => b.digest.clone(),
            None => return out(200, json!({"ok": false, "error": "unknown_batch"})),
        };
        let marked = mark_signing(&mut g, batch_id, None);
        if marked.get("ok") != Some(&Value::Bool(true)) {
            return out(200, marked);
        }
        if let Err(e) = self.persist(&g) {
            return out(200, json!({"ok": false, "error": e}));
        }
        drop(g);
        // In-process ceremony (no second frost-inbox bind, no child process).
        let result = match run_ceremony(&digest, FROST_T, FROST_N) {
            Ok(v) => v,
            Err(e) => return out(200, json!({"ok": false, "error": e})),
        };
        let session_id = result
            .get("sessionId")
            .and_then(|v| v.as_str())
            .unwrap_or("local");
        let signature = result.get("signature").cloned().unwrap_or(Value::Null);
        let vk = result.get("verifyingKey").cloned().unwrap_or(Value::Null);
        let vk_hex = result
            .get("verifying_key_hex")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // Unify with hash-market roster/memo policy (itl_frost prefixes).
        let commit = itl_frost::roster_commit(0, FROST_T, FROST_N, &vk_hex, &[]);
        let memo = itl_frost::spend_memo_roster(&commit);
        let mut g = self.state.lock().unwrap();
        mark_signing(&mut g, batch_id, Some(session_id));
        let acc = accept_signature(&mut g, batch_id, &signature.to_string(), &vk.to_string());
        if acc.get("ok") != Some(&Value::Bool(true)) {
            return out(200, acc);
        }
        if let Err(e) = self.persist(&g) {
            return out(200, json!({"ok": false, "error": e}));
        }
        out(
            200,
            json!({
                "ok": true,
                "batch": acc.get("batch"),
                "sessionId": session_id,
                "via": "in-process",
                "rosterCommit": commit,
                "spendMemo": memo,
            }),
        )
    }
}
