pub mod auth;
pub mod browser;
pub mod downloader;
pub mod extractor;
pub mod health_tracker;
pub mod models;
pub mod proxy;
pub mod proxy_cache;
pub mod sources_config;
pub mod updater;

use browser::{
    control_platform_webview, detect_platform_from_url,
    get_cached_title_for_platform, get_platform_webview_url,
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
    title_hint: Option<String>,
    proxy_url: Option<String>,
    official_only: Option<bool>,
) -> Result<VideoMetadata, String> {
    sync_webview_cookies(&app);
    if official_only.unwrap_or(false) {
        return extract_original_only(&url, proxy_url.as_deref()).await;
    }
    let (plat, _) = detect_platform_from_url(&url);
    let hint = title_hint
        .filter(|t| !t.trim().is_empty())
        .or_else(|| get_cached_title_for_platform(&plat));
    let hint_opt = hint.as_deref().filter(|s| !s.trim().is_empty());
    parse_url_entry(&url, hint_opt, proxy_url.as_deref(), Some(&app)).await
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
fn get_latest_browsed_url() -> Option<String> {
    proxy::get_latest_nav_url()
}

#[tauri::command]
fn commands_set_fullscreen(app: AppHandle, fullscreen: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_fullscreen(fullscreen);
        }
    }
    Ok(())
}

#[tauri::command]
fn commands_updater_state() -> Result<updater::UpdateState, String> {
    Ok(updater::get_current_state())
}

#[tauri::command]
async fn commands_updater_check(
    app: AppHandle,
    _force: Option<bool>,
) -> Result<updater::UpdateState, String> {
    updater::check_only(app).await
}

#[tauri::command]
async fn commands_updater_download(app: AppHandle) -> Result<updater::UpdateState, String> {
    updater::download_update(app).await
}

#[tauri::command]
fn commands_updater_install(app: AppHandle) -> Result<(), String> {
    updater::restart_app(&app)
}

#[tauri::command]
fn commands_open_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd").args(&["/c", "start", "", &url]).spawn();
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    Ok(())
}

#[tauri::command]
fn commands_exit_app(app: AppHandle) {
    app.exit(0);
    #[cfg(not(target_os = "android"))]
    std::process::exit(0);
}

#[tauri::command]
fn get_sources_config(app: AppHandle) -> sources_config::SourcesConfig {
    use tauri::Manager;
    if let Ok(dir) = app.path().app_config_dir().or_else(|_| app.path().app_data_dir()) {
        let _ = std::fs::create_dir_all(&dir);
        sources_config::set_config_dir(dir);
    }
    sources_config::get_current_sources_config()
}

#[tauri::command]
async fn commands_check_latest_github_release() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Vexa-App/1.0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get("https://github.com/HongSphere/Vexa/releases/latest")
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if let Some(loc) = res.headers().get("location") {
        if let Ok(loc_str) = loc.to_str() {
            if let Some(tag) = loc_str.split("/tag/").nth(1) {
                let clean_ver = tag.trim_start_matches('v');
                let apk_url = format!("https://github.com/HongSphere/Vexa/releases/download/{}/Vexa_{}.apk", tag, clean_ver);
                return Ok(serde_json::json!({
                    "tag_name": tag,
                    "version": clean_ver,
                    "download_url": apk_url,
                    "release_url": loc_str,
                }));
            }
        }
    }
    Err("未能获取到最新版本发布信息".to_string())
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

#[tauri::command]
fn report_source_health(source_id: String, success: bool, latency_ms: u64) {
    health_tracker::record_source_result(&source_id, success, latency_ms);
}

#[tauri::command]
async fn prefetch_m3u8_index(
    url: String,
    headers: Option<std::collections::HashMap<String, String>>,
) -> bool {
    proxy_cache::prefetch_m3u8_index(&url, headers).await
}

#[tauri::command]
fn get_source_health_scores() -> std::collections::HashMap<String, f64> {
    health_tracker::get_all_health_scores()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init());
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            use tauri::Manager;
            if let Ok(dir) = app.path().app_config_dir().or_else(|_| app.path().app_data_dir()) {
                let _ = std::fs::create_dir_all(&dir);
                sources_config::set_config_dir(dir.clone());
                health_tracker::set_config_dir(dir.clone());
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
            get_latest_browsed_url,
            commands_set_fullscreen,
            commands_updater_state,
            commands_updater_check,
            commands_updater_download,
            commands_updater_install,
            commands_open_browser,
            commands_exit_app,
            commands_check_latest_github_release,
            get_sources_config,
            save_sources_config,
            import_sources_json,
            import_sources_url,
            reset_sources_config,
            load_local_sources_file,
            report_source_health,
            prefetch_m3u8_index,
            get_source_health_scores,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vexa Tauri application");
}
