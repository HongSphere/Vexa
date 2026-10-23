use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub checking: bool,
    pub downloading: bool,
    pub downloaded: bool,
    pub progress: Option<f64>,
    pub version: Option<String>,
    pub error: bool,
    pub message: String,
}

impl Default for UpdateState {
    fn default() -> Self {
        Self {
            checking: false,
            downloading: false,
            downloaded: false,
            progress: None,
            version: None,
            error: false,
            message: String::new(),
        }
    }
}

static CURRENT_STATE: Mutex<Option<UpdateState>> = Mutex::new(None);
static IS_CHECKING: AtomicBool = AtomicBool::new(false);
static IS_DOWNLOADING: AtomicBool = AtomicBool::new(false);
static IS_READY_TO_RESTART: AtomicBool = AtomicBool::new(false);

fn emit_state(app: &AppHandle, state: UpdateState) {
    if let Ok(mut lock) = CURRENT_STATE.lock() {
        *lock = Some(state.clone());
    }
    let _ = app.emit("updater:state", state);
}

pub fn get_current_state() -> UpdateState {
    if let Ok(lock) = CURRENT_STATE.lock() {
        if let Some(ref s) = *lock {
            return s.clone();
        }
    }
    UpdateState::default()
}

pub async fn check_only(app: AppHandle) -> Result<UpdateState, String> {
    if IS_CHECKING.swap(true, Ordering::SeqCst) {
        return Ok(get_current_state());
    }

    let initial_state = UpdateState {
        checking: true,
        downloading: false,
        downloaded: false,
        progress: None,
        version: None,
        error: false,
        message: "正在检查更新...".to_string(),
    };
    emit_state(&app, initial_state);

    let res = do_check_only(app.clone()).await;
    IS_CHECKING.store(false, Ordering::SeqCst);

    match res {
        Ok(s) => {
            emit_state(&app, s.clone());
            Ok(s)
        }
        Err(e) => {
            let err_state = UpdateState {
                checking: false,
                downloading: false,
                downloaded: false,
                progress: None,
                version: None,
                error: true,
                message: format!("检查更新失败: {}", e),
            };
            emit_state(&app, err_state.clone());
            Err(e)
        }
    }
}

async fn do_check_only(app: AppHandle) -> Result<UpdateState, String> {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return Err(format!("更新器初始化失败: {}", e)),
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return Ok(UpdateState {
                checking: false,
                downloading: false,
                downloaded: false,
                progress: None,
                version: None,
                error: false,
                message: "当前已是最新版本".to_string(),
            });
        }
        Err(e) => {
            let err_msg = e.to_string();
            let err_lower = err_msg.to_lowercase();
            if err_lower.contains("404")
                || err_lower.contains("not found")
                || err_lower.contains("targetnotfound")
                || err_lower.contains("target not found")
                || err_lower.contains("could not find release")
                || err_lower.contains("no release")
            {
                return Ok(UpdateState {
                    checking: false,
                    downloading: false,
                    downloaded: false,
                    progress: None,
                    version: None,
                    error: false,
                    message: "当前已是最新版本".to_string(),
                });
            }
            return Err(format!("获取更新信息失败: {}", e));
        }
    };

    let target_ver = update.version.clone();
    Ok(UpdateState {
        checking: false,
        downloading: false,
        downloaded: false,
        progress: None,
        version: Some(target_ver.clone()),
        error: false,
        message: format!("发现新版本 v{}，点击立即下载", target_ver),
    })
}

pub async fn download_update(app: AppHandle) -> Result<UpdateState, String> {
    if IS_DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Ok(get_current_state());
    }

    let res = do_download_update(app.clone()).await;
    IS_DOWNLOADING.store(false, Ordering::SeqCst);

    match res {
        Ok(s) => {
            emit_state(&app, s.clone());
            Ok(s)
        }
        Err(e) => {
            let err_state = UpdateState {
                checking: false,
                downloading: false,
                downloaded: false,
                progress: None,
                version: None,
                error: true,
                message: format!("下载更新失败: {}", e),
            };
            emit_state(&app, err_state.clone());
            Err(e)
        }
    }
}

async fn do_download_update(app: AppHandle) -> Result<UpdateState, String> {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return Err(format!("更新器初始化失败: {}", e)),
    };

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            return Ok(UpdateState {
                checking: false,
                downloading: false,
                downloaded: false,
                progress: None,
                version: None,
                error: false,
                message: "当前已是最新版本".to_string(),
            });
        }
        Err(e) => return Err(format!("获取更新信息失败: {}", e)),
    };

    let target_ver = update.version.clone();
    let app_handle = app.clone();
    let target_ver_clone = target_ver.clone();

    emit_state(
        &app_handle,
        UpdateState {
            checking: false,
            downloading: true,
            downloaded: false,
            progress: Some(0.0),
            version: Some(target_ver_clone.clone()),
            error: false,
            message: format!("正在连接下载 v{}...", target_ver_clone),
        },
    );

    let mut downloaded_bytes: u64 = 0;
    let mut total_bytes: Option<u64> = None;

    let res = update
        .download_and_install(
            move |chunk_len, content_len| {
                downloaded_bytes += chunk_len as u64;
                if total_bytes.is_none() {
                    total_bytes = content_len;
                }
                let percent = if let Some(total) = total_bytes {
                    if total > 0 {
                        ((downloaded_bytes as f64 / total as f64) * 100.0).min(99.0)
                    } else {
                        0.0
                    }
                } else {
                    0.0
                };
                let msg = if percent > 0.0 {
                    format!("正在下载更新 {:.0}%", percent)
                } else {
                    format!("正在下载更新 v{}...", target_ver_clone)
                };
                emit_state(
                    &app_handle,
                    UpdateState {
                        checking: false,
                        downloading: true,
                        downloaded: false,
                        progress: Some(percent),
                        version: Some(target_ver_clone.clone()),
                        error: false,
                        message: msg,
                    },
                );
            },
            || {},
        )
        .await;

    match res {
        Ok(()) => {
            IS_READY_TO_RESTART.store(true, Ordering::SeqCst);
            Ok(UpdateState {
                checking: false,
                downloading: false,
                downloaded: true,
                progress: Some(100.0),
                version: Some(target_ver.clone()),
                error: false,
                message: format!("新版本 v{} 已下载完成，点击立即安装并重启", target_ver),
            })
        }
        Err(e) => Err(format!("下载或安装更新失败: {}", e)),
    }
}

pub async fn check_and_download(app: AppHandle, _force: bool) -> Result<UpdateState, String> {
    download_update(app).await
}

pub fn restart_app(app: &AppHandle) -> Result<(), String> {
    app.restart();
}
