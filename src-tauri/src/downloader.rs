use crate::extractor::parse_url_entry;
use crate::models::{DownloadTask, StartDownloadParams};
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub static ACTIVE_PIDS: Lazy<Mutex<HashMap<String, u32>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub static ACTIVE_CANCELLATIONS: Lazy<Mutex<HashSet<String>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

pub static TASK_STORE: Lazy<Mutex<HashMap<String, DownloadTask>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn expand_download_dir(app: Option<&AppHandle>, raw_dir: &str) -> PathBuf {
    use tauri::Manager;
    if raw_dir.starts_with("~/") || raw_dir.is_empty() {
        if let Some(a) = app {
            if let Ok(dl) = a.path().download_dir().or_else(|_| a.path().app_data_dir()) {
                let p = dl.join("Vexa");
                let _ = std::fs::create_dir_all(&p);
                return p;
            }
        }
        if let Some(home) = dirs::home_dir() {
            let p = home.join(if raw_dir.starts_with("~/") {
                &raw_dir[2..]
            } else {
                "Downloads/Vexa"
            });
            let _ = std::fs::create_dir_all(&p);
            return p;
        }
    }
    let path = PathBuf::from(raw_dir);
    let _ = std::fs::create_dir_all(&path);
    path
}

fn sanitize_filename(name: &str) -> String {
    let re = Regex::new(r#"[/\\?%*:|"<>]"#).unwrap();
    let cleaned = re.replace_all(name, "_").trim().to_string();
    if cleaned.is_empty() {
        "vexa_video".to_string()
    } else {
        cleaned.chars().take(80).collect()
    }
}

pub async fn start_download(
    app: AppHandle,
    params: StartDownloadParams,
) -> Result<DownloadTask, String> {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let task_id = format!("dl-{}", now_ms);

    let out_dir = expand_download_dir(Some(&app), &params.download_dir);
    let ext = if params.audio_only { "mp3" } else { "mp4" };
    let safe_title = sanitize_filename(&params.title);
    let out_file = out_dir.join(format!("{}.{}", safe_title, ext));

    let initial_task = DownloadTask {
        id: task_id.clone(),
        url: params.url.clone(),
        title: params.title.clone(),
        thumbnail: params.thumbnail.clone(),
        platform_name: params.platform_name.clone(),
        quality_label: if params.audio_only {
            "MP3 高音质音频".to_string()
        } else {
            params.quality_label.clone()
        },
        format_id: params.format_id.clone(),
        audio_only: params.audio_only,
        status: "downloading_video".to_string(),
        progress: 0.0,
        speed: "准备中...".to_string(),
        eta: "--:--".to_string(),
        total_size: None,
        output_path: Some(out_file.to_string_lossy().to_string()),
        created_at: now_ms,
        error_msg: None,
    };

    if let Ok(mut map) = TASK_STORE.lock() {
        map.insert(task_id.clone(), initial_task.clone());
    }

    if let Ok(mut c) = ACTIVE_CANCELLATIONS.lock() {
        c.remove(&task_id);
    }

    let task_clone = initial_task.clone();
    tokio::spawn(async move {
        run_native_http_download(&app, &params, task_clone, &out_file).await;
    });

    Ok(initial_task)
}

async fn run_native_http_download(
    app: &AppHandle,
    params: &StartDownloadParams,
    mut task: DownloadTask,
    out_file: &PathBuf,
) {
    let (mut stream_url, resolved_title, resolved_thumb) = if let Ok(meta) = parse_url_entry(
        &params.url,
        Some(params.title.as_str()),
        params.proxy_url.as_deref(),
    )
    .await
    {
        let stream = meta.formats
            .iter()
            .find(|f| !f.is_dash)
            .or_else(|| meta.formats.first())
            .map(|f| f.video_url.clone())
            .unwrap_or_else(|| params.url.clone());
        (stream, Some(meta.title), Some(meta.thumbnail))
    } else {
        let cached = crate::browser::get_cached_media_src();
        let fallback = if !cached.is_empty() { cached } else { params.url.clone() };
        (fallback, None, None)
    };

    // If stream_url is still a raw webpage or share link, extract via parse_video
    if !stream_url.contains(".mp4")
        && !stream_url.contains(".m3u8")
        && !stream_url.contains(".ts")
        && !stream_url.contains(".flv")
    {
        if let Ok(meta) = crate::extractor::parse_video(&stream_url).await {
            if let Some(f) = meta.formats.first() {
                stream_url = f.video_url.clone();
            }
        }
    }

    if let Some(ref t) = resolved_title {
        if !t.is_empty() && (task.title.contains("视频 (") || task.title.is_empty()) {
            task.title = t.clone();
            let _ = app.emit("download-progress", &task);
        }
    }
    if let Some(ref th) = resolved_thumb {
        if !th.is_empty() && task.thumbnail.is_empty() {
            task.thumbnail = th.clone();
            let _ = app.emit("download-progress", &task);
        }
    }

    let client = match reqwest::Client::builder()
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(6))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            task.status = "failed".to_string();
            task.error_msg = Some(e.to_string());
            let _ = app.emit("download-progress", &task);
            return;
        }
    };

    // Branch 1: Native m3u8 playlist chunked downloader
    if stream_url.contains(".m3u8") {
        download_m3u8_native(app, &client, &stream_url, &mut task, out_file).await;
        return;
    }

    // Branch 2: Direct media file stream downloader (MP4 / TS / FLV)
    let mut req = client.get(&stream_url);
    if let Ok(parsed) = reqwest::Url::parse(&stream_url) {
        if let Some(host) = parsed.host_str() {
            let parts: Vec<&str> = host.split('.').collect();
            let base_domain = if parts.len() >= 2 {
                format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
            } else {
                host.to_string()
            };
            req = req.header("Referer", format!("{}://www.{}/", parsed.scheme(), base_domain));
            req = req.header("Origin", format!("{}://www.{}", parsed.scheme(), base_domain));
        }
    }

    let resp = match req.send().await {
        Ok(r) if r.status().is_success() => {
            if let Some(ct) = r.headers().get(reqwest::header::CONTENT_TYPE) {
                if let Ok(ct_str) = ct.to_str() {
                    if ct_str.contains("text/html") {
                        task.status = "failed".to_string();
                        task.error_msg = Some("下载失败：获取到的是网页内容而非视频流，请在官方网站中播放该视频后再试".to_string());
                        let _ = app.emit("download-progress", &task);
                        return;
                    }
                }
            }
            r
        }
        Ok(r) => {
            task.status = "failed".to_string();
            task.error_msg = Some(format!("HTTP 状态码错误: {}", r.status()));
            let _ = app.emit("download-progress", &task);
            return;
        }
        Err(e) => {
            task.status = "failed".to_string();
            task.error_msg = Some(e.to_string());
            let _ = app.emit("download-progress", &task);
            return;
        }
    };

    let total_bytes = resp.content_length().unwrap_or(50 * 1024 * 1024);
    let Ok(mut file) = std::fs::File::create(out_file) else {
        task.status = "failed".to_string();
        task.error_msg = Some("无法创建下载输出文件".to_string());
        let _ = app.emit("download-progress", &task);
        return;
    };

    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();
    let mut last_emit = std::time::Instant::now();
    let mut last_bytes = 0u64;

    while let Some(chunk_res) = stream.next().await {
        // Check for cancellation
        if let Ok(cancels) = ACTIVE_CANCELLATIONS.lock() {
            if cancels.contains(&task.id) {
                task.status = "paused".to_string();
                task.speed = "已取消".to_string();
                let _ = app.emit("download-progress", &task);
                return;
            }
        }

        if let Ok(chunk) = chunk_res {
            let _ = file.write_all(&chunk);
            downloaded += chunk.len() as u64;

            let elapsed_ms = last_emit.elapsed().as_millis();
            if elapsed_ms >= 350 {
                let dt = last_emit.elapsed().as_secs_f64();
                let bytes_diff = downloaded.saturating_sub(last_bytes);
                let speed_bps = if dt > 0.0 { bytes_diff as f64 / dt } else { 0.0 };
                let speed_str = if speed_bps >= 1024.0 * 1024.0 {
                    format!("{:.1} MB/s", speed_bps / (1024.0 * 1024.0))
                } else {
                    format!("{:.0} KB/s", (speed_bps / 1024.0).max(1.0))
                };

                let eta_str = if speed_bps > 0.0 && total_bytes > downloaded {
                    let rem_sec = (total_bytes - downloaded) as f64 / speed_bps;
                    let m = (rem_sec / 60.0) as u64;
                    let s = (rem_sec % 60.0) as u64;
                    format!("{:02}:{:02}", m, s)
                } else {
                    "--:--".to_string()
                };

                last_emit = std::time::Instant::now();
                last_bytes = downloaded;

                task.progress = ((downloaded as f64 / total_bytes as f64) * 100.0).min(99.5);
                task.total_size = Some(format!("{:.1} MB", total_bytes as f64 / (1024.0 * 1024.0)));
                task.speed = speed_str;
                task.eta = eta_str;
                let _ = app.emit("download-progress", &task);
            }
        }
    }

    task.status = "completed".to_string();
    task.progress = 100.0;
    task.speed = "已完成".to_string();
    task.eta = "00:00".to_string();
    let _ = app.emit("download-progress", &task);
}

async fn download_m3u8_native(
    app: &AppHandle,
    client: &reqwest::Client,
    m3u8_url: &str,
    task: &mut DownloadTask,
    out_file: &PathBuf,
) {
    let mut m3u8_req = client.get(m3u8_url);
    if let Ok(parsed) = reqwest::Url::parse(m3u8_url) {
        if let Some(host) = parsed.host_str() {
            let parts: Vec<&str> = host.split('.').collect();
            let base_domain = if parts.len() >= 2 {
                format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
            } else {
                host.to_string()
            };
            m3u8_req = m3u8_req.header("Referer", format!("{}://www.{}/", parsed.scheme(), base_domain));
        }
    }
    let Ok(resp) = m3u8_req.send().await else {
        task.status = "failed".to_string();
        task.error_msg = Some("无法下载 m3u8 播放列表".to_string());
        let _ = app.emit("download-progress", &*task);
        return;
    };

    let Ok(content) = resp.text().await else {
        task.status = "failed".to_string();
        task.error_msg = Some("无法解析 m3u8 文本内容".to_string());
        let _ = app.emit("download-progress", &*task);
        return;
    };

    let base_url = m3u8_url
        .rfind('/')
        .map(|idx| &m3u8_url[..=idx])
        .unwrap_or("");
    let origin = if let Ok(u) = reqwest::Url::parse(m3u8_url) {
        let port_str = u.port().map(|p| format!(":{}", p)).unwrap_or_default();
        format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or(""), port_str)
    } else {
        String::new()
    };

    // Check for nested master playlist
    let mut sub_m3u8: Option<String> = None;
    for line in content.lines() {
        let t = line.trim();
        if !t.is_empty() && !t.starts_with('#') && t.contains(".m3u8") {
            let abs_sub = if t.starts_with("http") {
                t.to_string()
            } else if t.starts_with('/') {
                format!("{}{}", origin, t)
            } else {
                format!("{}{}", base_url, t)
            };
            sub_m3u8 = Some(abs_sub);
            break;
        }
    }

    let actual_m3u8_content = if let Some(sub_url) = sub_m3u8 {
        if let Ok(sub_resp) = client.get(&sub_url).send().await {
            sub_resp.text().await.unwrap_or(content)
        } else {
            content
        }
    } else {
        content
    };

    // Parse all video segment URLs
    let mut segment_urls = Vec::new();
    for line in actual_m3u8_content.lines() {
        let t = line.trim();
        if !t.is_empty() && !t.starts_with('#') {
            let abs_seg = if t.starts_with("http") {
                t.to_string()
            } else if t.starts_with('/') {
                format!("{}{}", origin, t)
            } else {
                format!("{}{}", base_url, t)
            };
            segment_urls.push(abs_seg);
        }
    }

    if segment_urls.is_empty() {
        task.status = "failed".to_string();
        task.error_msg = Some("m3u8 列表中未解析到有效视频分片".to_string());
        let _ = app.emit("download-progress", &*task);
        return;
    }

    let Ok(mut file) = std::fs::File::create(out_file) else {
        task.status = "failed".to_string();
        task.error_msg = Some("无法创建下载输出文件".to_string());
        let _ = app.emit("download-progress", &*task);
        return;
    };

    let total_segs = segment_urls.len();
    let mut downloaded_bytes = 0u64;
    let start_instant = std::time::Instant::now();

    for (idx, seg_url) in segment_urls.iter().enumerate() {
        // Check for cancellation
        if let Ok(cancels) = ACTIVE_CANCELLATIONS.lock() {
            if cancels.contains(&task.id) {
                task.status = "paused".to_string();
                task.speed = "已取消".to_string();
                let _ = app.emit("download-progress", &*task);
                return;
            }
        }

        let mut seg_req = client.get(seg_url);
        if let Ok(parsed) = reqwest::Url::parse(seg_url) {
            if let Some(host) = parsed.host_str() {
                let parts: Vec<&str> = host.split('.').collect();
                let base_domain = if parts.len() >= 2 {
                    format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
                } else {
                    host.to_string()
                };
                seg_req = seg_req.header("Referer", format!("{}://www.{}/", parsed.scheme(), base_domain));
            }
        }
        if let Ok(seg_resp) = seg_req.send().await {
            if let Ok(bytes) = seg_resp.bytes().await {
                let _ = file.write_all(&bytes);
                downloaded_bytes += bytes.len() as u64;
            }
        }

        let pct = ((idx + 1) as f64 / total_segs as f64 * 100.0).min(99.5);
        let elapsed = start_instant.elapsed().as_secs_f64();
        let speed_bps = if elapsed > 0.0 { downloaded_bytes as f64 / elapsed } else { 0.0 };
        let speed_str = if speed_bps >= 1024.0 * 1024.0 {
            format!("{:.1} MB/s", speed_bps / (1024.0 * 1024.0))
        } else {
            format!("{:.0} KB/s", (speed_bps / 1024.0).max(1.0))
        };

        let est_total_bytes = if idx > 0 {
            (downloaded_bytes as f64 / (idx + 1) as f64 * total_segs as f64) as u64
        } else {
            downloaded_bytes * total_segs as u64
        };

        let eta_str = if speed_bps > 0.0 && est_total_bytes > downloaded_bytes {
            let rem_sec = (est_total_bytes - downloaded_bytes) as f64 / speed_bps;
            let m = (rem_sec / 60.0) as u64;
            let s = (rem_sec % 60.0) as u64;
            format!("{:02}:{:02}", m, s)
        } else {
            "--:--".to_string()
        };

        task.progress = pct;
        task.total_size = Some(format!("{}/{} 分片", idx + 1, total_segs));
        task.speed = speed_str;
        task.eta = eta_str;
        let _ = app.emit("download-progress", &*task);
    }

    task.status = "completed".to_string();
    task.progress = 100.0;
    task.speed = "已完成".to_string();
    task.eta = "00:00".to_string();
    let _ = app.emit("download-progress", &*task);
}

pub fn control_task(task_id: &str, action: &str) -> Result<(), String> {
    match action {
        "pause" | "cancel" => {
            if let Ok(mut cancels) = ACTIVE_CANCELLATIONS.lock() {
                cancels.insert(task_id.to_string());
            }

            if let Ok(mut pids) = ACTIVE_PIDS.lock() {
                if let Some(pid) = pids.remove(task_id) {
                    #[cfg(unix)]
                    {
                        let _ = Command::new("kill").arg("-TERM").arg(pid.to_string()).output();
                    }
                    #[cfg(windows)]
                    {
                        let _ = Command::new("taskkill")
                            .args(["/F", "/T", "/PID", &pid.to_string()])
                            .output();
                    }
                }
            }
            Ok(())
        }
        "open_folder" => {
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let dir = expand_download_dir(None, "~/Downloads/Vexa");
                #[cfg(target_os = "macos")]
                {
                    let _ = Command::new("open").arg(dir).spawn();
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = Command::new("explorer").arg(dir).spawn();
                }
                #[cfg(target_os = "linux")]
                {
                    let _ = Command::new("xdg-open").arg(dir).spawn();
                }
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
