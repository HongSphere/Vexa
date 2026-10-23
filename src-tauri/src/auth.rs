use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCookieRecord {
    pub platform: String,
    pub raw_cookie: String,
}

static AUTH_DIR: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

pub fn set_auth_dir(p: PathBuf) {
    if let Ok(mut lock) = AUTH_DIR.write() {
        *lock = Some(p);
    }
}

fn auth_storage_dir() -> PathBuf {
    if let Ok(lock) = AUTH_DIR.read() {
        if let Some(ref dir) = *lock {
            let _ = fs::create_dir_all(dir);
            return dir.clone();
        }
    }
    let base = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = base.join("com.hongsphere.vexa").join("auth");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn accounts_json_path() -> PathBuf {
    auth_storage_dir().join("accounts.json")
}

pub fn load_stored_records() -> HashMap<String, StoredCookieRecord> {
    let path = accounts_json_path();
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, StoredCookieRecord>>(&content) {
            return map;
        }
    }
    HashMap::new()
}

pub fn save_stored_records(map: &HashMap<String, StoredCookieRecord>) {
    let path = accounts_json_path();
    if let Ok(json) = serde_json::to_string_pretty(map) {
        let _ = fs::write(path, json);
    }
}

pub fn get_platform_raw_cookie(platform: &str) -> Option<String> {
    let map = load_stored_records();
    map.get(platform)
        .filter(|r| !r.raw_cookie.trim().is_empty())
        .map(|r| r.raw_cookie.clone())
}

pub fn persist_platform_cookie(
    platform: &str,
    _domain: &str,
    raw_cookie: &str,
    _username: Option<String>,
) {
    let mut map = load_stored_records();
    map.insert(
        platform.to_string(),
        StoredCookieRecord {
            platform: platform.to_string(),
            raw_cookie: raw_cookie.to_string(),
        },
    );
    save_stored_records(&map);
}
