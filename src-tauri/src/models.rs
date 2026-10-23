use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFormat {
    pub format_id: String,
    pub quality_label: String,
    pub height: u32,
    pub fps: Option<u32>,
    pub ext: String,
    pub vcodec: String,
    pub acodec: String,
    pub filesize: Option<u64>,
    pub video_url: String,
    pub audio_url: Option<String>,
    pub is_dash: bool,
    pub is_hls: bool,
    pub headers: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeItem {
    pub index: usize,
    pub id: String,
    pub cid: Option<u64>,
    pub title: String,
    pub duration: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub lang: String,
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DanmakuItem {
    pub time: f64,
    pub text: String,
    pub color: String,
    pub mode: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSource {
    pub source_id: String,
    pub source_name: String,
    pub matched_title: String,
    pub remarks: String,
    pub source_type: String, // "native" | "m3u8" | "jx_iframe"
    pub play_url: String,
    pub episodes: Vec<EpisodeItem>,
    pub formats: Vec<VideoFormat>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub id: String,
    pub url: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail: String,
    pub duration: u64,
    pub view_count: Option<u64>,
    pub description: Option<String>,
    pub platform: String,
    pub platform_name: String,
    pub cid: Option<u64>,
    pub formats: Vec<VideoFormat>,
    pub episodes: Vec<EpisodeItem>,
    pub current_episode_index: usize,
    pub subtitles: Vec<SubtitleTrack>,
    pub auth_used: String,
    pub sources: Vec<MediaSource>,
    pub active_source_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub id: String,
    pub url: String,
    pub title: String,
    pub uploader: String,
    pub thumbnail: String,
    pub duration: u64,
    pub view_count: Option<String>,
    pub platform: String,
    pub platform_name: String,
    pub badge: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    pub title: String,
    pub thumbnail: String,
    pub platform_name: String,
    pub quality_label: String,
    pub format_id: String,
    pub audio_only: bool,
    pub status: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub total_size: Option<String>,
    pub output_path: Option<String>,
    pub created_at: u64,
    pub error_msg: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDownloadParams {
    pub url: String,
    pub title: String,
    pub thumbnail: String,
    pub platform_name: String,
    pub format_id: String,
    pub quality_label: String,
    pub height: u32,
    pub audio_only: bool,
    pub download_dir: String,
    pub proxy_url: Option<String>,
}
