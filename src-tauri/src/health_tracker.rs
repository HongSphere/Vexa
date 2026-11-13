use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceHealth {
    pub success_count: u32,
    pub fail_count: u32,
    pub avg_latency_ms: f64,
    pub last_updated: u64,
}

static CONFIG_DIR: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

static HEALTH_MAP: Lazy<RwLock<HashMap<String, SourceHealth>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

pub fn set_config_dir(dir: PathBuf) {
    if let Ok(mut guard) = CONFIG_DIR.write() {
        *guard = Some(dir);
    }
    let loaded = load_health_from_disk();
    if !loaded.is_empty() {
        if let Ok(mut map) = HEALTH_MAP.write() {
            for (k, v) in loaded {
                map.entry(k).or_insert(v);
            }
        }
    }
}

fn health_file_path() -> Option<PathBuf> {
    if let Ok(guard) = CONFIG_DIR.read() {
        if let Some(ref dir) = *guard {
            return Some(dir.join("source_health.json"));
        }
    }
    dirs::config_dir().map(|d| d.join("vexa").join("source_health.json"))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn load_health_from_disk() -> HashMap<String, SourceHealth> {
    if let Some(path) = health_file_path() {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, SourceHealth>>(&content) {
                return map;
            }
        }
    }
    HashMap::new()
}

fn save_health_to_disk(map: &HashMap<String, SourceHealth>) {
    if let Some(path) = health_file_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string(map) {
            let _ = fs::write(path, json);
        }
    }
}

pub fn record_source_result(source_id: &str, success: bool, latency_ms: u64) {
    if source_id.trim().is_empty() {
        return;
    }
    if let Ok(mut map) = HEALTH_MAP.write() {
        let entry = map.entry(source_id.to_string()).or_default();
        if success {
            entry.success_count = entry.success_count.saturating_add(1);
            let lat = latency_ms.max(10) as f64;
            if entry.avg_latency_ms <= 0.0 {
                entry.avg_latency_ms = lat;
            } else {
                entry.avg_latency_ms = entry.avg_latency_ms * 0.65 + lat * 0.35;
            }
        } else {
            entry.fail_count = entry.fail_count.saturating_add(1);
        }
        entry.last_updated = now_secs();
        let snapshot = map.clone();
        drop(map);
        std::thread::spawn(move || {
            save_health_to_disk(&snapshot);
        });
    }
}

pub fn score_source(source_id: &str) -> f64 {
    if let Ok(map) = HEALTH_MAP.read() {
        if let Some(h) = map.get(source_id) {
            let total = (h.success_count + h.fail_count) as f64;
            if total <= 0.0 {
                return 0.0;
            }
            let success_rate = (h.success_count as f64 + 1.0) / (total + 2.0);
            let latency_penalty = if h.avg_latency_ms > 0.0 {
                (h.avg_latency_ms / 1000.0).min(8.0) * 10.0
            } else {
                0.0
            };
            return success_rate * 100.0 - latency_penalty;
        }
    }
    50.0
}

pub fn get_all_health_scores() -> HashMap<String, f64> {
    let mut out = HashMap::new();
    if let Ok(map) = HEALTH_MAP.read() {
        for k in map.keys() {
            out.insert(k.clone(), score_source(k));
        }
    }
    out
}
