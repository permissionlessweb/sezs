//! Parity with `apps/sezs/dev/splash/payroll.mjs`.
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

pub const ROLES: &[&str] = &["artist", "vendor", "staff", "usher"];
pub const BATCH_STATUSES: &[&str] = &["proposed", "signing", "signed", "executed", "refused"];
pub const KEY_PREFIX: &str = "sezsreg_";
const UM_HRPS: &[&str] = &["penumbra", "penumbratest", "plmt", "penumbrat"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Splits {
    pub charity: f64,
    pub venue: f64,
    pub remainder: f64,
}

impl Default for Splits {
    fn default() -> Self {
        Self {
            charity: 0.111,
            venue: 0.111,
            remainder: 0.778,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RoleAmounts {
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub staff: String,
    #[serde(default)]
    pub usher: String,
}

impl RoleAmounts {
    fn get(&self, role: &str) -> &str {
        match role {
            "artist" => &self.artist,
            "vendor" => &self.vendor,
            "staff" => &self.staff,
            "usher" => &self.usher,
            _ => "",
        }
    }
    fn set(&mut self, role: &str, v: String) {
        match role {
            "artist" => self.artist = v,
            "vendor" => self.vendor = v,
            "staff" => self.staff = v,
            "usher" => self.usher = v,
            _ => {}
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub id: String,
    pub role: String,
    #[serde(default)]
    pub label: String,
    pub commitment: String,
    pub status: String,
    pub created_at: i64,
    #[serde(default)]
    pub consumed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub id: String,
    pub invite_id: String,
    pub role: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub display_name: String,
    pub status: String,
    pub zec: String,
    pub um: String,
    #[serde(default)]
    pub amount: String,
    pub registered_at: i64,
    #[serde(default)]
    pub paid_at: Option<i64>,
    #[serde(default)]
    pub zec_txid: Option<String>,
    #[serde(default)]
    pub um_txid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItem {
    pub participant_id: String,
    pub role: String,
    pub display_name: String,
    pub amount: String,
    pub zec: String,
    pub um: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub id: String,
    pub status: String,
    pub items: Vec<BatchItem>,
    pub splits: Splits,
    pub digest: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default)]
    pub pubkey: Option<String>,
    #[serde(default)]
    pub receipt_id: Option<String>,
    #[serde(default)]
    pub executed_at: Option<i64>,
    #[serde(default)]
    pub execution: Option<Value>,
    pub created_at: i64,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayrollState {
    pub version: u32,
    pub invites: Vec<Invite>,
    pub participants: Vec<Participant>,
    pub batches: Vec<Batch>,
    pub splits: Splits,
    #[serde(rename = "roleAmounts")]
    pub role_amounts: RoleAmounts,
}

impl Default for PayrollState {
    fn default() -> Self {
        Self {
            version: 1,
            invites: vec![],
            participants: vec![],
            batches: vec![],
            splits: Splits::default(),
            role_amounts: RoleAmounts::default(),
        }
    }
}

pub fn hash_key(key: &str) -> String {
    hex::encode(Sha256::digest(key.as_bytes()))
}

pub fn generate_registration_key() -> String {
    let mut b = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut b);
    format!("{KEY_PREFIX}{}", hex::encode(b))
}

pub fn is_registration_key(key: &str) -> bool {
    let rest = match key.strip_prefix(KEY_PREFIX) {
        Some(r) => r,
        None => return false,
    };
    rest.len() == 64 && rest.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn truncate_addr(addr: &str) -> String {
    let s = addr.trim();
    if s.is_empty() {
        return "—".into();
    }
    if s.len() <= 14 {
        return s.to_string();
    }
    format!("{}…{}", &s[..8], &s[s.len() - 6..])
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id(prefix: &str) -> String {
    let mut b = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut b);
    format!("{prefix}-{}", hex::encode(b))
}

fn assert_safe_path(p: &Path) -> Result<(), String> {
    if p.to_string_lossy().contains("..") {
        return Err("bad_store_path".into());
    }
    Ok(())
}

pub fn load_payroll(path: &Path) -> Result<PayrollState, String> {
    assert_safe_path(path)?;
    if !path.exists() {
        return Ok(PayrollState::default());
    }
    let raw: Value = serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mut state = PayrollState::default();
    if let Ok(s) = serde_json::from_value::<PayrollState>(raw.clone()) {
        state = s;
    } else {
        // tolerate partial files
        if let Ok(inv) = serde_json::from_value(raw.get("invites").cloned().unwrap_or(Value::Null))
        {
            state.invites = inv;
        }
    }
    Ok(state)
}

pub fn save_payroll(state: &PayrollState, path: &Path) -> Result<(), String> {
    assert_safe_path(path)?;
    if let Some(dir) = path.parent() {
        fs::DirBuilder::new()
            .mode(0o700)
            .recursive(true)
            .create(dir)
            .map_err(|e| e.to_string())?;
    }
    let tmp = PathBuf::from(format!("{}.{}.tmp", path.display(), std::process::id()));
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        use std::io::Write;
        let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
        f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }
    let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    Ok(())
}

pub fn public_invite(inv: &Invite) -> Value {
    serde_json::json!({
        "id": inv.id,
        "role": inv.role,
        "label": inv.label,
        "status": inv.status,
        "consumedAt": inv.consumed_at,
        "createdAt": inv.created_at,
    })
}

pub fn public_participant(p: &Participant) -> Value {
    serde_json::json!({
        "id": p.id,
        "inviteId": p.invite_id,
        "role": p.role,
        "label": p.label,
        "displayName": p.display_name,
        "status": p.status,
        "zec": truncate_addr(&p.zec),
        "um": truncate_addr(&p.um),
        "amount": p.amount,
        "registeredAt": p.registered_at,
        "paidAt": p.paid_at,
    })
}

pub fn public_batch(b: &Batch) -> Value {
    let sig = b.signature.as_ref().map(|s| {
        if s.chars().count() > 16 {
            format!("{}…", s.chars().take(16).collect::<String>())
        } else {
            s.clone()
        }
    });
    serde_json::json!({
        "id": b.id,
        "status": b.status,
        "items": b.items,
        "splits": b.splits,
        "digest": b.digest,
        "sessionId": b.session_id,
        "signature": sig,
        "receiptId": b.receipt_id,
        "executedAt": b.executed_at,
        "execution": b.execution,
        "createdAt": b.created_at,
        "note": b.note,
    })
}

pub fn list_public(state: &PayrollState) -> Value {
    serde_json::json!({
        "ok": true,
        "splits": state.splits,
        "roleAmounts": state.role_amounts,
        "invites": state.invites.iter().map(public_invite).collect::<Vec<_>>(),
        "participants": state.participants.iter().map(public_participant).collect::<Vec<_>>(),
        "batches": state.batches.iter().map(public_batch).collect::<Vec<_>>(),
    })
}

pub fn create_invite(state: &mut PayrollState, role: &str, label: &str) -> Value {
    if !ROLES.contains(&role) {
        return serde_json::json!({"ok": false, "error": "bad_role"});
    }
    let key = generate_registration_key();
    let invite = Invite {
        id: new_id("inv"),
        role: role.to_string(),
        label: label.chars().take(80).collect(),
        commitment: hash_key(&key),
        status: "invited".into(),
        created_at: now_ms(),
        consumed_at: None,
    };
    let pub_inv = public_invite(&invite);
    state.invites.push(invite);
    serde_json::json!({"ok": true, "invite": pub_inv, "key": key})
}

fn eq_hex(a: &str, b: &str) -> bool {
    let ba = match hex::decode(a) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let bb = match hex::decode(b) {
        Ok(v) => v,
        Err(_) => return false,
    };
    ba.len() == bb.len() && subtle::ConstantTimeEq::ct_eq(ba.as_slice(), bb.as_slice()).into()
}

/// Penumbra addresses use BIP-173/350 *or* pcli's last generator
/// (`0x2a1462b3`). Official addresses only verify with the pcli set
/// (see apps/sezs/src/pay/bech32.mjs).
pub fn looks_um_bech32(s: &str) -> bool {
    decode_um_bech32(s)
        .map(|(hrp, _)| UM_HRPS.contains(&hrp.as_str()))
        .unwrap_or(false)
}

const BECH32_CHARSET: &[u8] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN_BIP: [u32; 5] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2e880328];
const GEN_PCLI: [u32; 5] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST: u32 = 1;
const BECH32M_CONST: u32 = 0x2bc830a3;

fn polymod(values: &[u8], gen: &[u32; 5]) -> u32 {
    let mut chk: u32 = 1;
    for &v in values {
        let top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ (v as u32);
        for i in 0..5 {
            if (top >> i) & 1 == 1 {
                chk ^= gen[i];
            }
        }
    }
    chk
}

fn hrp_expand(hrp: &str) -> Vec<u8> {
    let mut out = Vec::new();
    for c in hrp.bytes() {
        out.push(c >> 5);
    }
    out.push(0);
    for c in hrp.bytes() {
        out.push(c & 31);
    }
    out
}

fn verify_bech32(hrp: &str, data: &[u8], const_: u32) -> bool {
    let mut values = hrp_expand(hrp);
    values.extend_from_slice(data);
    polymod(&values, &GEN_BIP) == const_ || polymod(&values, &GEN_PCLI) == const_
}

fn decode_um_bech32(s: &str) -> Option<(String, Vec<u8>)> {
    let raw = s.trim();
    if raw.len() < 8 || raw.len() > 256 {
        return None;
    }
    if raw != raw.to_lowercase() && raw != raw.to_uppercase() {
        return None;
    }
    let str_l = raw.to_lowercase();
    let pos = str_l.rfind('1')?;
    if pos < 1 || pos + 7 > str_l.len() {
        return None;
    }
    let hrp = &str_l[..pos];
    let body = &str_l[pos + 1..];
    let mut data = Vec::with_capacity(body.len());
    for c in body.bytes() {
        let i = BECH32_CHARSET.iter().position(|&x| x == c)?;
        data.push(i as u8);
    }
    if !verify_bech32(hrp, &data, BECH32_CONST) && !verify_bech32(hrp, &data, BECH32M_CONST) {
        return None;
    }
    Some((hrp.to_string(), data))
}

pub fn looks_shielded_zec(s: &str) -> bool {
    let v = s.trim();
    if v.len() < 20 || v.len() > 256 {
        return false;
    }
    let lower = v.to_ascii_lowercase();
    if lower.starts_with('t')
        && lower.len() > 1
        && ('1'..='9').contains(&lower.chars().nth(1).unwrap_or('0'))
        && !lower.starts_with("tex1")
    {
        // /^t[1-9a-z]/i and not tex1 — the JS also allows t + letter; keep the
        // documented rule: refuse transparent t-addrs, allow tex1.
        if !lower.starts_with("tex1") && lower.starts_with('t') && !lower.starts_with("u") {
            // zs/zregtestsapling handled below
        }
        if re_transparent_t(&lower) {
            return false;
        }
    }
    let ok = regex_is(&lower);
    ok
}

fn re_transparent_t(lower: &str) -> bool {
    let t_form = regex::Regex::new(r"^t[1-9a-z]").unwrap();
    t_form.is_match(lower) && !lower.starts_with("tex1")
}

fn regex_is(lower: &str) -> bool {
    let a = regex::Regex::new(r"^(u|uregtest|utest|zs|zregtestsapling|u1)[a-z0-9]+$").unwrap();
    let b = regex::Regex::new(r"^(u1|uregtest1|utest1|zs1)").unwrap();
    a.is_match(lower) || b.is_match(lower)
}

pub fn register_with_key(state: &mut PayrollState, body: &Value) -> Value {
    let key = body
        .get("registrationKey")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !is_registration_key(key) {
        return serde_json::json!({"ok": false, "error": "bad_key"});
    }
    let commitment = hash_key(key);
    let Some(pos) = state
        .invites
        .iter()
        .position(|i| eq_hex(&i.commitment, &commitment))
    else {
        return serde_json::json!({"ok": false, "error": "unknown_key"});
    };
    {
        let invite = &state.invites[pos];
        if invite.status != "invited" || invite.consumed_at.is_some() {
            return serde_json::json!({"ok": false, "error": "key_consumed"});
        }
    }
    let zec = body
        .get("zec")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let um = body
        .get("um")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if !looks_shielded_zec(&zec) {
        return serde_json::json!({"ok": false, "error": "bad_zec"});
    }
    if !looks_um_bech32(&um) {
        return serde_json::json!({"ok": false, "error": "bad_um"});
    }
    let display_name = body
        .get("displayName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if display_name.is_empty() {
        return serde_json::json!({"ok": false, "error": "bad_name"});
    }
    let invite = &mut state.invites[pos];
    invite.status = "registered".into();
    invite.consumed_at = Some(now_ms());
    let participant = Participant {
        id: new_id("prt"),
        invite_id: invite.id.clone(),
        role: invite.role.clone(),
        label: invite.label.clone(),
        display_name,
        status: "registered".into(),
        zec,
        um,
        amount: String::new(),
        registered_at: now_ms(),
        paid_at: None,
        zec_txid: None,
        um_txid: None,
    };
    let pub_p = public_participant(&participant);
    state.participants.push(participant);
    serde_json::json!({"ok": true, "participant": pub_p})
}

pub fn set_amounts(state: &mut PayrollState, body: &Value) -> Value {
    if let Some(splits) = body.get("splits").filter(|v| v.is_object()) {
        let charity = splits
            .get("charity")
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN);
        let venue = splits
            .get("venue")
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN);
        let remainder = splits
            .get("remainder")
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN);
        if ![charity, venue, remainder]
            .iter()
            .all(|n| n.is_finite() && *n >= 0.0)
        {
            return serde_json::json!({"ok": false, "error": "bad_splits"});
        }
        if (charity + venue + remainder - 1.0).abs() > 0.001 {
            return serde_json::json!({"ok": false, "error": "splits_must_sum_to_one"});
        }
        state.splits = Splits {
            charity,
            venue,
            remainder,
        };
    }
    if let Some(role_amounts) = body.get("roleAmounts").and_then(|v| v.as_object()) {
        for role in ROLES {
            if let Some(v) = role_amounts.get(*role) {
                let s = v
                    .as_str()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| v.to_string());
                state.role_amounts.set(role, s.chars().take(32).collect());
            }
        }
    }
    if let Some(amounts) = body.get("amounts").and_then(|v| v.as_array()) {
        for row in amounts {
            let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(p) = state.participants.iter_mut().find(|x| x.id == id) {
                let amt = row
                    .get("amount")
                    .map(|v| {
                        v.as_str()
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| v.to_string())
                    })
                    .unwrap_or_default();
                p.amount = amt.chars().take(32).collect();
            }
        }
    }
    serde_json::json!({"ok": true, "splits": state.splits, "roleAmounts": state.role_amounts})
}

pub fn batch_digest(items: &Value, splits: &Splits) -> String {
    let payload = serde_json::json!({"items": items, "splits": splits});
    hex::encode(Sha256::digest(payload.to_string().as_bytes()))
}

pub fn propose_batch(state: &mut PayrollState, note: &str) -> Value {
    let registered: Vec<&Participant> = state
        .participants
        .iter()
        .filter(|p| p.status == "registered" || p.status == "paid")
        .collect();
    if registered.is_empty() {
        return serde_json::json!({"ok": false, "error": "no_participants"});
    }
    let items: Vec<BatchItem> = registered
        .iter()
        .map(|p| {
            let amount = if !p.amount.is_empty() {
                p.amount.clone()
            } else {
                state.role_amounts.get(&p.role).to_string()
            };
            let amount = if amount.is_empty() {
                "0".into()
            } else {
                amount
            };
            BatchItem {
                participant_id: p.id.clone(),
                role: p.role.clone(),
                display_name: p.display_name.clone(),
                amount,
                zec: truncate_addr(&p.zec),
                um: truncate_addr(&p.um),
            }
        })
        .collect();
    if items.iter().any(|i| i.amount.is_empty() || i.amount == "0") {
        return serde_json::json!({"ok": false, "error": "missing_amounts"});
    }
    let items_v = serde_json::to_value(&items).unwrap();
    let digest = batch_digest(&items_v, &state.splits);
    let batch = Batch {
        id: new_id("pay"),
        status: "proposed".into(),
        items,
        splits: state.splits.clone(),
        digest,
        session_id: None,
        signature: None,
        pubkey: None,
        receipt_id: None,
        executed_at: None,
        execution: None,
        created_at: now_ms(),
        note: note.chars().take(160).collect(),
    };
    let pub_b = public_batch(&batch);
    state.batches.push(batch);
    serde_json::json!({"ok": true, "batch": pub_b})
}

pub fn mark_signing(state: &mut PayrollState, batch_id: &str, session_id: Option<&str>) -> Value {
    let Some(b) = state.batches.iter_mut().find(|x| x.id == batch_id) else {
        return serde_json::json!({"ok": false, "error": "unknown_batch"});
    };
    if b.status != "proposed" && b.status != "signing" {
        return serde_json::json!({"ok": false, "error": "bad_status"});
    }
    b.status = "signing".into();
    if let Some(s) = session_id {
        b.session_id = Some(s.to_string());
    }
    serde_json::json!({"ok": true, "batch": public_batch(b)})
}

pub fn accept_signature(
    state: &mut PayrollState,
    batch_id: &str,
    signature: &str,
    pubkey: &str,
) -> Value {
    let Some(b) = state.batches.iter_mut().find(|x| x.id == batch_id) else {
        return serde_json::json!({"ok": false, "error": "unknown_batch"});
    };
    if b.status != "signing" && b.status != "proposed" {
        return serde_json::json!({"ok": false, "error": "bad_status"});
    }
    if signature.is_empty() || pubkey.is_empty() {
        return serde_json::json!({"ok": false, "error": "missing_signature"});
    }
    b.status = "signed".into();
    b.signature = Some(signature.to_string());
    b.pubkey = Some(pubkey.to_string());
    serde_json::json!({"ok": true, "batch": public_batch(b)})
}

/// Default payout fails closed (`chain_unavailable`), matching Node when no
/// local session rails are up. Tests inject a payout function.
pub fn execute_batch(state: &mut PayrollState, batch_id: &str, payout: Option<Value>) -> Value {
    let Some(idx) = state.batches.iter().position(|x| x.id == batch_id) else {
        return serde_json::json!({"ok": false, "error": "unknown_batch"});
    };
    if state.batches[idx].status != "signed" {
        return serde_json::json!({"ok": false, "error": "not_signed"});
    }
    let paid =
        payout.unwrap_or_else(|| serde_json::json!({"ok": false, "error": "chain_unavailable"}));
    if paid.get("ok") != Some(&Value::Bool(true)) {
        return serde_json::json!({
            "ok": false,
            "error": paid.get("error").cloned().unwrap_or(Value::String("payout_failed".into())),
            "message": paid.get("message"),
            "errors": paid.get("errors"),
        });
    }
    let execution = paid.get("execution").cloned().unwrap_or(Value::Null);
    let executed_at = now_ms();
    let receipt_id = new_id("rcpt");
    {
        let b = &mut state.batches[idx];
        b.status = "executed".into();
        b.receipt_id = Some(receipt_id);
        b.executed_at = Some(executed_at);
        b.execution = Some(execution.clone());
    }
    let items = state.batches[idx].items.clone();
    for item in items {
        if let Some(p) = state
            .participants
            .iter_mut()
            .find(|x| x.id == item.participant_id)
        {
            p.status = "paid".into();
            p.paid_at = Some(executed_at);
            if let Some(txs) = execution.get("zec").and_then(|v| v.as_array()) {
                if let Some(tx) = txs
                    .iter()
                    .find(|x| x.get("participantId").and_then(|v| v.as_str()) == Some(&p.id))
                {
                    p.zec_txid = tx
                        .get("txid")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
            if let Some(txs) = execution.get("um").and_then(|v| v.as_array()) {
                if let Some(tx) = txs
                    .iter()
                    .find(|x| x.get("participantId").and_then(|v| v.as_str()) == Some(&p.id))
                {
                    p.um_txid = tx
                        .get("txid")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
        }
    }
    serde_json::json!({"ok": true, "batch": public_batch(&state.batches[idx])})
}
