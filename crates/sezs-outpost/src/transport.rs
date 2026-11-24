//! Transport abstraction. First version: in-memory simulated devices.
//! A later native GATT central can implement the same trait.
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone)]
pub struct PublicDevice {
    pub id: String,
    pub label: String,
    pub public_hex: Option<String>,
    pub noise_hex: Option<String>,
    pub status: String,
    pub last_seen: i64,
}

impl PublicDevice {
    pub fn to_json(&self) -> Value {
        serde_json::json!({
            "id": self.id,
            "label": self.label,
            "publicHex": self.public_hex,
            "noiseHex": self.noise_hex,
            "status": self.status,
            "lastSeen": self.last_seen,
        })
    }
}

pub trait Transport: Send {
    fn devices(&self) -> Vec<PublicDevice>;
    fn simulate(
        &mut self,
        id: String,
        label: String,
        public_hex: Option<String>,
        noise_hex: Option<String>,
    ) -> PublicDevice;
    fn connect(&mut self, id: &str) -> Result<PublicDevice, &'static str>;
    fn disconnect(&mut self, id: &str) -> Result<(), &'static str>;
    fn ingest(
        &mut self,
        id: Option<&str>,
        frame: Value,
        public_hex: Option<String>,
        noise_hex: Option<String>,
    ) -> Result<(), &'static str>;
    fn next(&mut self, id: &str) -> Option<Value>;
}

#[derive(Default)]
pub struct SimulatedTransport {
    devices: HashMap<String, PublicDevice>,
    queues: HashMap<String, VecDeque<Value>>,
}

impl SimulatedTransport {
    pub fn new() -> Self {
        Self::default()
    }
    fn now() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

impl Transport for SimulatedTransport {
    fn devices(&self) -> Vec<PublicDevice> {
        let mut v: Vec<_> = self.devices.values().cloned().collect();
        v.sort_by(|a, b| a.id.cmp(&b.id));
        v
    }

    fn simulate(
        &mut self,
        id: String,
        label: String,
        public_hex: Option<String>,
        noise_hex: Option<String>,
    ) -> PublicDevice {
        let d = PublicDevice {
            id: id.clone(),
            label,
            public_hex,
            noise_hex,
            status: "disconnected".into(),
            last_seen: 0,
        };
        self.devices.insert(id.clone(), d.clone());
        self.queues.entry(id).or_default();
        d
    }

    fn connect(&mut self, id: &str) -> Result<PublicDevice, &'static str> {
        let d = self.devices.get_mut(id).ok_or("unknown_device")?;
        d.status = "connected".into();
        d.last_seen = Self::now();
        Ok(d.clone())
    }

    fn disconnect(&mut self, id: &str) -> Result<(), &'static str> {
        if let Some(d) = self.devices.get_mut(id) {
            d.status = "disconnected".into();
        }
        Ok(())
    }

    fn ingest(
        &mut self,
        id: Option<&str>,
        frame: Value,
        public_hex: Option<String>,
        noise_hex: Option<String>,
    ) -> Result<(), &'static str> {
        let qid = if let Some(id) = id {
            if !self.devices.contains_key(id) {
                self.devices.insert(
                    id.to_string(),
                    PublicDevice {
                        id: id.to_string(),
                        label: id.to_string(),
                        public_hex,
                        noise_hex,
                        status: "connected".into(),
                        last_seen: 0,
                    },
                );
                self.queues.entry(id.to_string()).or_default();
            }
            id.to_string()
        } else {
            self.devices.keys().next().cloned().ok_or("no_device")?
        };
        let d = self.devices.get_mut(&qid).ok_or("no_device")?;
        d.last_seen = Self::now();
        d.status = "connected".into();
        self.queues.entry(qid).or_default().push_back(frame);
        Ok(())
    }

    fn next(&mut self, id: &str) -> Option<Value> {
        self.queues.get_mut(id).and_then(|q| q.pop_front())
    }
}
