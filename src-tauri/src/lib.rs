pub mod auth;
pub mod browser;
pub mod downloader;
pub mod extractor;
pub mod models;
pub mod proxy;
pub mod sources_config;
pub mod updater;

use browser::{
    control_platform_webview, get_cached_title, get_platform_webview_url,
    mount_or_update_platform_webview, sync_webview_cookies,
};
use downloader::{control_task, start_download};
use extractor::{
    extract_original_only, fetch_danmaku as fetch_remote_danmaku, parse_url_entry, search_media_sources,
};
use models::{DanmakuItem, DownloadTask, SearchResultItem, StartDownloadParams, VideoMetadata};
use proxy::{start_local_stream_proxy, PROXY_PORT};
use std::sync::atomic::Ordering;
use tauri::AppHandle;

#[tauri::command]
fn get_proxy_port() -> u16 {
    PROXY_PORT.load(Ordering::Relaxed)
}

#[tauri::command]
async fn parse_media_url(
    app: AppHandle,
    url: String,
    proxy_url: Option<String>,
    official_only: Option<bool>,
) -> Result<VideoMetadata, String> {
    sync_webview_cookies(&app);
    if official_only.unwrap_or(false) {
        return extract_original_only(&url, proxy_url.as_deref()).await;
    }
    let title_hint = get_cached_title();
    let hint_opt = if title_hint.trim().is_empty() {
        None
    } else {
        Some(title_hint.as_str())
    };
    parse_url_entry(&url, hint_opt, proxy_url.as_deref()).await
}

#[tauri::command]
async fn search_media(
    query: String,
    platform: String,
    custom_vod_api_url: Option<String>,
    _proxy_url: Option<String>,
) -> Result<Vec<SearchResultItem>, String> {
    search_media_sources(&query, &platform, custom_vod_api_url.as_deref()).await
}

#[tauri::command]
async fn fetch_danmaku(cid: u64) -> Result<Vec<DanmakuItem>, String> {
    fetch_remote_danmaku(cid).await
}

#[tauri::command]
async fn start_download_task(
    app: AppHandle,
    params: StartDownloadParams,
) -> Result<DownloadTask, String> {
    sync_webview_cookies(&app);
    start_download(app, params).await
}

#[tauri::command]
async fn control_download_task(task_id: String, action: String) -> Result<(), String> {
    control_task(&task_id, &action)
}

#[tauri::command]
async fn sync_platform_webview(
    app: AppHandle,
    url: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    window_height: Option<f64>,
    visible: bool,
) -> Result<String, String> {
    mount_or_update_platform_webview(&app, url, x, y, width, height, window_height, visible)
}

#[tauri::command]
async fn action_platform_webview(app: AppHandle, action: String) -> Result<String, String> {
    control_platform_webview(&app, &action)
}

#[tauri::command]
async fn current_platform_webview_url(app: AppHandle) -> Result<String, String> {
    get_platform_webview_url(&app)
}

#[tauri::command]
fn commands_updater_state() -> Result<updater::UpdateState, String> {
    Ok(updater::get_current_state())
}

#[tauri::command]
async fn commands_updater_check(
    app: AppHandle,
    force: Option<bool>,
) -> Result<updater::UpdateState, String> {
    updater::check_and_download(app, force.unwrap_or(false)).await
}

#[tauri::command]
fn commands_updater_install(app: AppHandle) -> Result<(), String> {
    updater::restart_app(&app)
}

#[tauri::command]
fn get_sources_config() -> sources_config::SourcesConfig {
    sources_config::get_current_sources_config()
}

#[tauri::command]
fn save_sources_config(app: AppHandle, config: sources_config::SourcesConfig) -> Result<(), String> {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_config_dir().or_else(|_| app.path().app_data_dir()) {
        let _ = std::fs::create_dir_all(&dir);
        sources_config::set_config_dir(dir);
    }
    sources_config::update_sources_config(config)
}

#[tauri::command]
fn import_sources_json(app: AppHandle, json_content: String) -> Result<sources_config::SourcesConfig, String> {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_config_dir().or_else(|_| app.path().app_data_dir()) {
        let _ = std::fs::create_dir_all(&dir);
        sources_config::set_config_dir(dir);
    }
    sources_config::import_sources_from_string(&json_content)
}

#[tauri::command]
async fn import_sources_url(app: AppHandle, url: String) -> Result<sources_config::SourcesConfig, String> {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_config_dir().or_else(|_| app.path().app_data_dir()) {
        let _ = std::fs::create_dir_all(&dir);
        sources_config::set_config_dir(dir);
    }
    sources_config::import_sources_from_url(&url).await
}

#[tauri::command]
fn reset_sources_config(app: AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_config_dir().or_else(|_| app.path().app_data_dir()) {
        let _ = std::fs::create_dir_all(&dir);
        sources_config::set_config_dir(dir);
    }
    sources_config::reset_sources_config_file()
}

#[tauri::command]
fn load_local_sources_file(path: Option<String>) -> Result<sources_config::SourcesConfig, String> {
    let target_path = path
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("sources.json"));
    if !target_path.exists() {
        return Err(format!("未在 {} 找到规则文件", target_path.display()));
    }
    let content = std::fs::read_to_string(&target_path).map_err(|e| e.to_string())?;
    sources_config::import_sources_from_string(&content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_config_dir().or_else(|_| app.path().app_data_dir()) {
                let _ = std::fs::create_dir_all(&dir);
                sources_config::set_config_dir(dir.clone());
                auth::set_auth_dir(dir.join("auth"));
            }
            sources_config::init_sources_config();
            tauri::async_runtime::spawn(async move {
                let _port = start_local_stream_proxy().await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_proxy_port,
            parse_media_url,
            search_media,
            fetch_danmaku,
            start_download_task,
            control_download_task,
            sync_platform_webview,
            action_platform_webview,
            current_platform_webview_url,
            commands_updater_state,
            commands_updater_check,
            commands_updater_install,
            get_sources_config,
            save_sources_config,
            import_sources_json,
            import_sources_url,
            reset_sources_config,
            load_local_sources_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vexa Tauri application");
}
