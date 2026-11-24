//! The ticket backend never learns a ticket secret (sezs-0001 / sezs-0010).

const FORBIDDEN: &[&str] = &[
    "secret",
    "k",
    "secrethex",
    "secret_hex",
    "ticketsecret",
    "ticket_secret",
    "seed",
    "seedhex",
    "seed_hex",
    "plaintext",
    "mnemonic",
    "privatekey",
    "private_key",
];

fn norm(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

fn is_forbidden_key(key: &str) -> bool {
    let n = norm(key);
    FORBIDDEN.iter().any(|k| norm(k) == n)
}

/// Returns the first forbidden key path in a JSON body, if any.
pub fn find_forbidden_secret_field(body: &serde_json::Value) -> Option<String> {
    walk(body, "", 0, 6)
}

fn walk(v: &serde_json::Value, path: &str, depth: u32, max_depth: u32) -> Option<String> {
    if v.is_null() || depth > max_depth {
        return None;
    }
    match v {
        serde_json::Value::Array(arr) => {
            for (i, item) in arr.iter().enumerate() {
                let child = format!("{path}[{i}]");
                if let Some(hit) = walk(item, &child, depth + 1, max_depth) {
                    return Some(hit);
                }
            }
            None
        }
        serde_json::Value::Object(map) => {
            for (k, val) in map {
                let child = if path.is_empty() {
                    k.clone()
                } else {
                    format!("{path}.{k}")
                };
                if is_forbidden_key(k) {
                    return Some(child);
                }
                if let Some(hit) = walk(val, &child, depth + 1, max_depth) {
                    return Some(hit);
                }
            }
            None
        }
        _ => None,
    }
}

pub fn refuse_secret_fields(body: &serde_json::Value) -> Option<serde_json::Value> {
    find_forbidden_secret_field(body).map(|field| {
        serde_json::json!({
            "ok": false,
            "error": "secret_refused",
            "message": "Refused: the ticket backend does not accept a ticket secret.",
            "field": field,
        })
    })
}
