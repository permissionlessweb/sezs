//! Mainnet (or mock LCD) event-contract role reader.

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

const BECH32_CONTRACT_RE: &str = r"^terp1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38,58}$";

#[derive(Debug, Clone)]
pub struct EventRoles {
    pub contract: String,
    pub curators: Vec<String>,
    pub coordinators: Vec<String>,
    pub ushers: Vec<String>,
    pub coordinators_group: String,
    pub usher_group: String,
    pub service_key: String,
}

#[derive(Debug, Clone)]
pub struct AddressRole {
    pub role: Option<String>,
    pub source: String,
    pub live: bool,
    pub error: Option<String>,
    pub contract: Option<String>,
}

#[derive(Clone)]
pub struct MainnetRoleReader {
    lcd: String,
    allowed: Vec<String>,
    allowed_set: HashSet<String>,
    cache_ttl: Duration,
    timeout: Duration,
    cache: std::sync::Arc<std::sync::Mutex<HashMap<String, (Instant, EventRoles)>>>,
}

impl MainnetRoleReader {
    pub fn new(lcd: String, contracts: Vec<String>) -> Self {
        let allowed: Vec<String> = contracts
            .into_iter()
            .filter(|c| is_contract(c))
            .collect::<Vec<_>>();
        let allowed_set = allowed.iter().cloned().collect();
        Self {
            lcd,
            allowed,
            allowed_set,
            cache_ttl: Duration::from_millis(15_000),
            timeout: Duration::from_millis(3_000),
            cache: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }

    pub fn allowed_contracts(&self) -> &[String] {
        &self.allowed
    }

    fn validate_lcd(&self) -> Result<(), &'static str> {
        if self.lcd.is_empty() {
            return Err("missing_lcd");
        }
        let u = url::Url::parse(&self.lcd).map_err(|_| "bad_lcd")?;
        let host = u.host_str().unwrap_or("");
        let loopback =
            host == "127.0.0.1" || host == "localhost" || host == "::1" || host == "[::1]";
        match u.scheme() {
            "https" => Ok(()),
            "http" if loopback => Ok(()),
            _ => Err("lcd_refused"),
        }
    }

    fn resolve_contract(&self, requested: &str) -> Result<String, &'static str> {
        let clean = requested.trim();
        if clean.is_empty() {
            return self.allowed.first().cloned().ok_or("no_event_contract");
        }
        if !is_contract(clean) {
            return Err("bad_contract");
        }
        if !self.allowed_set.is_empty() && !self.allowed_set.contains(clean) {
            return Err("unknown_contract");
        }
        Ok(clean.to_string())
    }

    pub async fn query_contract_roles(&self, contract: &str) -> Result<EventRoles, String> {
        self.validate_lcd().map_err(|e| e.to_string())?;
        if !is_contract(contract) {
            return Err("bad_contract".into());
        }
        if let Ok(cache) = self.cache.lock() {
            if let Some((exp, data)) = cache.get(contract) {
                if *exp > Instant::now() {
                    return Ok(data.clone());
                }
            }
        }
        let q = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            serde_json::json!({"roles": {}}).to_string().as_bytes(),
        );
        let base = self.lcd.trim_end_matches('/');
        let url = format!("{base}/cosmwasm/wasm/v1/contract/{contract}/smart/{q}");
        let client = reqwest_client(self.timeout)?;
        let res = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("role_query_failed: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("role_query_{}", res.status().as_u16()));
        }
        let raw: Value = res.json().await.map_err(|e| e.to_string())?;
        let body = raw.get("data").cloned().unwrap_or(raw);
        let parsed = EventRoles {
            contract: contract.to_string(),
            curators: addrs_of(body.get("curators")),
            coordinators: addrs_of(body.get("coordinators")),
            ushers: addrs_of(body.get("ushers")),
            coordinators_group: body
                .get("coordinators_group")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            usher_group: body
                .get("usher_group")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            service_key: body
                .get("service_key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        };
        if let Ok(mut cache) = self.cache.lock() {
            if cache.len() >= 64 {
                if let Some(oldest) = cache.keys().next().cloned() {
                    cache.remove(&oldest);
                }
            }
            cache.insert(
                contract.to_string(),
                (Instant::now() + self.cache_ttl, parsed.clone()),
            );
        }
        Ok(parsed)
    }

    pub async fn get_event_roles(&self, requested: &str) -> Result<Value, (u16, Value)> {
        let contract = self
            .resolve_contract(requested)
            .map_err(|e| (400, serde_json::json!({"ok": false, "error": e})))?;
        match self.query_contract_roles(&contract).await {
            Ok(roles) => Ok(serde_json::json!({
                "ok": true,
                "contract": contract,
                "contracts": self.allowed,
                "coordinators": roles.coordinators,
                "curators": roles.curators,
                "ushers": roles.ushers.iter().map(|terp| serde_json::json!({"terp": terp})).collect::<Vec<_>>(),
                "coordinatorsGroup": roles.coordinators_group,
                "usherGroup": roles.usher_group,
                "signing": { "methods": ["zafu-tx"] },
            })),
            Err(e) => Err((502, serde_json::json!({"ok": false, "error": e}))),
        }
    }

    pub async fn resolve_address_role(&self, address: &str, requested: &str) -> AddressRole {
        if address.is_empty()
            || !regex::Regex::new(r"^terp1[a-z0-9]{20,}$")
                .unwrap()
                .is_match(address)
        {
            return AddressRole {
                role: Some("guest".into()),
                source: "session".into(),
                live: !self.allowed.is_empty(),
                error: None,
                contract: None,
            };
        }
        let targets: Vec<String> = if requested.trim().is_empty() {
            self.allowed.clone()
        } else {
            match self.resolve_contract(requested) {
                Ok(c) => vec![c],
                Err(_) => vec![],
            }
        };
        if targets.is_empty() {
            return AddressRole {
                role: Some("guest".into()),
                source: "session".into(),
                live: false,
                error: None,
                contract: None,
            };
        }
        let lower = address.to_lowercase();
        let has = |list: &[String]| list.iter().any(|a| a.to_lowercase() == lower);
        for c in &targets {
            match self.query_contract_roles(c).await {
                Ok(roles) => {
                    if has(&roles.curators) || has(&roles.coordinators) {
                        return AddressRole {
                            role: Some("coordinator".into()),
                            source: "event_roles".into(),
                            live: true,
                            error: None,
                            contract: Some(c.clone()),
                        };
                    }
                    if has(&roles.ushers) {
                        return AddressRole {
                            role: Some("usher".into()),
                            source: "event_roles".into(),
                            live: true,
                            error: None,
                            contract: Some(c.clone()),
                        };
                    }
                }
                Err(e) => {
                    return AddressRole {
                        role: None,
                        source: "query_failed".into(),
                        live: true,
                        error: Some(e),
                        contract: None,
                    };
                }
            }
        }
        AddressRole {
            role: Some("guest".into()),
            source: "event_roles".into(),
            live: true,
            error: None,
            contract: None,
        }
    }
}

fn is_contract(s: &str) -> bool {
    regex::Regex::new(BECH32_CONTRACT_RE)
        .map(|r| r.is_match(s))
        .unwrap_or(false)
}

fn addrs_of(v: Option<&Value>) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::String(s) => {
                if s.starts_with("terp1")
                    || s.starts_with("sezs1")
                    || regex::Regex::new(r"^[a-z]+1[a-z0-9]+$")
                        .map(|r| r.is_match(s))
                        .unwrap_or(false)
                {
                    if !out.iter().any(|x| x == s) {
                        out.push(s.clone());
                    }
                }
            }
            Value::Array(arr) => {
                for x in arr {
                    walk(x, out);
                }
            }
            Value::Object(map) => {
                for k in [
                    "addr",
                    "address",
                    "member",
                    "members",
                    "curators",
                    "coordinators",
                    "ushers",
                    "data",
                ] {
                    if let Some(val) = map.get(k) {
                        walk(val, out);
                    }
                }
            }
            _ => {}
        }
    }
    if let Some(v) = v {
        walk(v, &mut out);
    }
    out
}

pub fn parse_contracts(raw: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for part in raw.split(',') {
        let c = part.trim();
        if c.is_empty() || seen.contains(c) || !is_contract(c) {
            continue;
        }
        seen.insert(c.to_string());
        out.push(c.to_string());
    }
    out
}

fn reqwest_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())
}
