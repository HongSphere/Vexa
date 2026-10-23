use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SiteConfig {
    pub id: String,
    pub name: String,
    pub home_url: String,
    #[serde(default)]
    pub mobile_home_url: Option<String>,
    #[serde(default)]
    pub search_url_template: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub desc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VodProviderConfig {
    pub id: String,
    pub name: String,
    pub api_base: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseLineConfig {
    pub id: String,
    pub name: String,
    pub url_prefix: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourcesConfig {
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub sites: Vec<SiteConfig>,
    #[serde(default)]
    pub vod_providers: Vec<VodProviderConfig>,
    #[serde(default)]
    pub parse_lines: Vec<ParseLineConfig>,
}

static CURRENT_SOURCES_CONFIG: Lazy<RwLock<SourcesConfig>> =
    Lazy::new(|| RwLock::new(load_sources_config_from_disk()));

static CONFIG_DIR: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

pub fn set_config_dir(p: PathBuf) {
    if let Ok(mut lock) = CONFIG_DIR.write() {
        *lock = Some(p);
    }
}

pub fn get_config_file_path() -> PathBuf {
    if let Ok(lock) = CONFIG_DIR.read() {
        if let Some(ref dir) = *lock {
            let _ = fs::create_dir_all(dir);
            return dir.join("sources.json");
        }
    }
    if let Some(config_dir) = dirs::config_dir() {
        let dir = config_dir.join("vexa");
        let _ = fs::create_dir_all(&dir);
        dir.join("sources.json")
    } else {
        PathBuf::from("sources.json")
    }
}

pub fn load_sources_config_from_disk() -> SourcesConfig {
    let path = get_config_file_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<SourcesConfig>(&content) {
                return cfg;
            }
        }
    }

    // Secondary check: look for sources.json in current working directory
    let cwd_path = PathBuf::from("sources.json");
    if cwd_path.exists() {
        if let Ok(content) = fs::read_to_string(&cwd_path) {
            if let Ok(cfg) = serde_json::from_str::<SourcesConfig>(&content) {
                let _ = fs::write(&path, &content);
                return cfg;
            }
        }
    }

    SourcesConfig::default()
}

pub fn init_sources_config() {
    let cfg = load_sources_config_from_disk();
    if let Ok(mut lock) = CURRENT_SOURCES_CONFIG.write() {
        *lock = cfg;
    }
}

pub fn get_current_sources_config() -> SourcesConfig {
    CURRENT_SOURCES_CONFIG
        .read()
        .map(|c| c.clone())
        .unwrap_or_default()
}

pub fn update_sources_config(new_config: SourcesConfig) -> Result<(), String> {
    let path = get_config_file_path();
    let json_str = serde_json::to_string_pretty(&new_config).map_err(|e| e.to_string())?;
    fs::write(&path, &json_str).map_err(|e| format!("写入配置文件失败: {}", e))?;

    if let Ok(mut lock) = CURRENT_SOURCES_CONFIG.write() {
        *lock = new_config;
    }
    Ok(())
}

pub fn import_sources_from_string(json_str: &str) -> Result<SourcesConfig, String> {
    let cfg = serde_json::from_str::<SourcesConfig>(json_str)
        .map_err(|e| format!("解析规则 JSON 格式失败: {}", e))?;
    update_sources_config(cfg.clone())?;
    Ok(cfg)
}

pub async fn import_sources_from_url(url: &str) -> Result<SourcesConfig, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        )
        .send()
        .await
        .map_err(|e| format!("拉取远程订阅规则失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("远程服务器返回状态码: {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取订阅响应内容失败: {}", e))?;

    import_sources_from_string(&text)
}

pub fn reset_sources_config_file() -> Result<(), String> {
    let path = get_config_file_path();
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    if let Ok(mut lock) = CURRENT_SOURCES_CONFIG.write() {
        *lock = SourcesConfig::default();
    }
    Ok(())
}

pub fn get_active_vod_providers() -> Vec<VodProviderConfig> {
    CURRENT_SOURCES_CONFIG
        .read()
        .map(|cfg| {
            cfg.vod_providers
                .iter()
                .filter(|p| p.enabled && !p.api_base.trim().is_empty())
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

pub fn get_active_parse_lines() -> Vec<ParseLineConfig> {
    CURRENT_SOURCES_CONFIG
        .read()
        .map(|cfg| {
            cfg.parse_lines
                .iter()
                .filter(|l| l.enabled && !l.url_prefix.trim().is_empty())
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

pub fn get_active_sites() -> Vec<SiteConfig> {
    CURRENT_SOURCES_CONFIG
        .read()
        .map(|cfg| cfg.sites.clone())
        .unwrap_or_default()
}
