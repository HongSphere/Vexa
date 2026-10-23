use crate::auth::get_platform_raw_cookie;
use crate::models::{
    DanmakuItem, EpisodeItem, MediaSource, SearchResultItem,
    VideoFormat, VideoMetadata,
};
use flate2::read::DeflateDecoder;
use futures_util::future::join_all;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr};

#[inline]
fn dec(bytes: &[u8]) -> String {
    bytes.iter().map(|b| (b ^ 0x5a) as char).collect()
}

pub const BILI_HOST: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 45, 45, 45, 116, 56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55, 117];
pub const BILI_VIEW: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 59, 42, 51, 116, 56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55, 117, 34, 117, 45, 63, 56, 119, 51, 52, 46, 63, 40, 60, 59, 57, 63, 117, 44, 51, 63, 45, 101];
pub const BILI_PLAY: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 59, 42, 51, 116, 56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55, 117, 34, 117, 42, 54, 59, 35, 63, 40, 117, 42, 54, 59, 35, 47, 40, 54, 101];
pub const BILI_DM: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 59, 42, 51, 116, 56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55, 117, 34, 117, 44, 107, 117, 62, 55, 117, 54, 51, 41, 46, 116, 41, 53, 101, 53, 51, 62, 103];
pub const BILI_PGC: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 59, 42, 51, 116, 56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55, 117, 42, 61, 57, 117, 44, 51, 63, 45, 117, 45, 63, 56, 117, 41, 63, 59, 41, 53, 52, 101];
pub const BILI_POP: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 59, 42, 51, 116, 56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55, 117, 34, 117, 45, 63, 56, 119, 51, 52, 46, 63, 40, 60, 59, 57, 63, 117, 42, 53, 42, 47, 54, 59, 40, 101, 42, 41, 103, 107, 108, 124, 42, 52, 103, 107];
pub const BILI_SEARCH: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 59, 42, 51, 116, 56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55, 117, 34, 117, 45, 63, 56, 119, 51, 52, 46, 63, 40, 60, 59, 57, 63, 117, 41, 63, 59, 40, 57, 50, 117, 46, 35, 42, 63, 101, 41, 63, 59, 40, 57, 50, 5, 46, 35, 42, 63, 103, 44, 51, 62, 63, 53, 124, 49, 63, 35, 45, 53, 40, 62, 103, 33, 39, 124, 42, 59, 61, 63, 103, 107];
pub const BILI_VIDEO_PREFIX: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 45, 45, 45, 116, 56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55, 117, 44, 51, 62, 63, 53, 117];
pub const FEED_API: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 59, 42, 51, 116, 59, 55, 63, 55, 44, 116, 57, 53, 55, 117, 59, 45, 63, 55, 63, 117, 44, 107, 117, 60, 63, 63, 62, 117, 101, 59, 45, 63, 55, 63, 5, 51, 62, 103];
pub const FEED_HOST: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 45, 45, 45, 116, 62, 53, 47, 35, 51, 52, 116, 57, 53, 55, 117];
pub const FEED_VIDEO_PREFIX: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 45, 45, 45, 116, 62, 53, 47, 35, 51, 52, 116, 57, 53, 55, 117, 44, 51, 62, 63, 53, 117];
pub const QQ_API: &[u8] = &[50, 46, 46, 42, 41, 96, 117, 117, 52, 53, 62, 63, 116, 44, 51, 62, 63, 53, 116, 43, 43, 116, 57, 53, 55, 117, 34, 117, 59, 42, 51, 117, 60, 54, 53, 59, 46, 5, 44, 51, 52, 60, 53, 104, 101];
pub const B23_DOMAIN: &[u8] = &[56, 104, 105, 116, 46, 44];
pub const BILI_DOMAIN: &[u8] = &[56, 51, 54, 51, 56, 51, 54, 51, 116, 57, 53, 55];
pub const BILIVIDEO_DOMAIN: &[u8] = &[56, 51, 54, 51, 44, 51, 62, 63, 53, 116, 57, 53, 55];
pub const FEED_DOMAIN: &[u8] = &[62, 53, 47, 35, 51, 52, 116, 57, 53, 55];
pub const FEED_SHARE_DOMAIN: &[u8] = &[51, 63, 41, 62, 53, 47, 35, 51, 52, 116, 57, 53, 55];
pub const FEED_SHORT_DOMAIN: &[u8] = &[44, 116, 62, 53, 47, 35, 51, 52];
pub const PLAT_BILI: &[u8] = &[56, 51, 54, 51, 56, 51, 54, 51];
pub const PLAT_FEED: &[u8] = &[62, 53, 47, 35, 51, 52];

fn build_ipv4_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(4))
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

pub fn detect_platform(url: &str) -> (String, String) {
    let lower = url.to_lowercase();
    let trimmed = url.trim();
    if lower.contains(&dec(BILI_DOMAIN)) || lower.contains(&dec(B23_DOMAIN)) || lower.starts_with("bv") {
        (dec(PLAT_BILI), "官方原画".to_string())
    } else if lower.contains(&dec(FEED_DOMAIN))
        || lower.contains(&dec(FEED_SHARE_DOMAIN))
        || lower.contains(&dec(FEED_SHORT_DOMAIN))
        || (trimmed.chars().all(|c| c.is_ascii_digit()) && trimmed.len() >= 18 && trimmed.len() <= 20)
    {
        (dec(PLAT_FEED), "媒体视频".to_string())
    } else if let Ok(parsed) = reqwest::Url::parse(&lower) {
        if let Some(host) = parsed.host_str() {
            let parts: Vec<&str> = host.split('.').collect();
            let domain_part = if parts.len() >= 2 {
                parts[parts.len() - 2].to_string()
            } else {
                host.to_string()
            };
            (domain_part.clone(), format!("{} 专线", domain_part))
        } else {
            ("generic".to_string(), "全网聚合源".to_string())
        }
    } else {
        ("generic".to_string(), "全网聚合源".to_string())
    }
}

fn is_generic_platform_title(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.chars().count() < 2 {
        return true;
    }
    let noise_list = [
        "中国领先的在线视频媒体平台",
        "在线视频",
        "高清正版",
        "电视剧",
        "电影",
        "综艺",
        "动漫",
        "番剧",
        "国创",
        "首页",
        "全集在线观看",
        "会员专区",
        "登录",
    ];
    noise_list.iter().any(|&w| trimmed.eq_ignore_ascii_case(w))
        || trimmed.contains("中国领先的在线视频")
        || trimmed.contains("海量正版")
        || trimmed.contains("高清视频在线观看")
}

fn clean_single_title_candidate(raw: &str) -> Option<(String, String, Option<usize>)> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let ep_re = Regex::new(r"第\s*0*(\d+)\s*[集期话]|[Ee][Pp]\s*0*(\d+)").ok()?;
    let detected_ep = ep_re.captures(trimmed).and_then(|c| {
        c.get(1)
            .or_else(|| c.get(2))
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .filter(|&n| n >= 1 && n <= 2000)
    });

    // 1. If enclosed in 《...》, prefer the book-title mark content
    if let Ok(book_re) = Regex::new(r"《([^》]{2,40})》") {
        if let Some(cap) = book_re.captures(trimmed) {
            let inner = cap[1].trim().to_string();
            if !is_generic_platform_title(&inner) {
                let base = strip_season_suffix(&inner);
                return Some((base, inner, detected_ep));
            }
        }
    }

    // 2. Otherwise split by common title separators (- _ | —)
    let mut candidate = trimmed.to_string();
    if let Ok(bracket_re) = Regex::new(r"【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\)") {
        candidate = bracket_re.replace_all(&candidate, " ").to_string();
    }
    if let Ok(ep_strip_re) =
        Regex::new(r"第\s*\d+\s*[集期话].*$|[Ee][Pp]\s*\d+.*$|1080[Pp].*$|高清.*$|正版.*$|在线观看.*$|完整版.*$")
    {
        candidate = ep_strip_re.replace_all(&candidate, "").to_string();
    }

    for part in candidate.split(&['-', '_', '|', '—', '–', '：', ':'][..]) {
        let p = part.trim();
        if p.chars().count() >= 2 && p.chars().count() <= 35 && !is_generic_platform_title(p) {
            let base = strip_season_suffix(p);
            return Some((base, p.to_string(), detected_ep));
        }
    }

    None
}

fn strip_season_suffix(title: &str) -> String {
    if let Ok(re) = Regex::new(r"\s*第[一二三四五六七八九十\d]+[季部]\s*$") {
        let stripped = re.replace(title, "").trim().to_string();
        if stripped.chars().count() >= 2 {
            return stripped;
        }
    }
    title.trim().to_string()
}

fn extract_clean_vod_query_and_episode(raw_hint: &str) -> Option<(String, String, Option<usize>)> {
    for segment in raw_hint.split("|||") {
        if let Some(res) = clean_single_title_candidate(segment) {
            return Some(res);
        }
    }
    None
}

fn parse_maccms_m3u8_episodes(vod_play_url: &str) -> Vec<EpisodeItem> {
    let m3u8_re = match Regex::new(r"https?://[^\s#$]+\.m3u8[^\s#$]*") {
        Ok(r) => r,
        Err(_) => return vec![],
    };

    let mut best_group: Vec<EpisodeItem> = Vec::new();
    for group in vod_play_url.split("$$$") {
        if !group.contains(".m3u8") {
            continue;
        }
        let mut episodes = Vec::new();
        for (idx, raw_ep) in group.split('#').enumerate() {
            let trimmed = raw_ep.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(m) = m3u8_re.find(trimmed) {
                let url = m.as_str().to_string();
                let title = trimmed
                    .split('$')
                    .next()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty() && !s.starts_with("http"))
                    .unwrap_or_else(|| "正片")
                    .to_string();
                let ep_index = episodes.len() + 1;
                episodes.push(EpisodeItem {
                    index: ep_index,
                    id: format!("ep-{}-{}", idx + 1, ep_index),
                    cid: None,
                    title,
                    duration: 0,
                    url,
                });
            }
        }
        if episodes.len() > best_group.len() {
            best_group = episodes;
        }
    }
    best_group
}

async fn query_single_vod_api(
    source_id: String,
    source_name: String,
    api_base: String,
    base_kw: String,
    full_kw: String,
    preferred_ep: Option<usize>,
) -> Option<(MediaSource, String, String)> {
    let client = build_ipv4_client(4).ok()?;
    let url = format!(
        "{}?ac=detail&wd={}",
        api_base.trim_end_matches('?'),
        urlencoding::encode(&base_kw)
    );
    let resp = client.get(&url).send().await.ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let list = json["list"].as_array()?;
    if list.is_empty() {
        return None;
    }

    let norm_full = full_kw.replace(' ', "").to_lowercase();
    let norm_base = base_kw.replace(' ', "").to_lowercase();

    let mut best_item: Option<(&serde_json::Value, Vec<EpisodeItem>, i32)> = None;

    for item in list.iter().take(10) {
        let vod_name = item["vod_name"].as_str().unwrap_or("").trim();
        if vod_name.is_empty() || vod_name.contains("解说") || vod_name.contains("预告") {
            continue;
        }
        let play_str = item["vod_play_url"].as_str().unwrap_or("");
        let episodes = parse_maccms_m3u8_episodes(play_str);
        if episodes.is_empty() {
            continue;
        }

        let norm_name = vod_name.replace(' ', "").to_lowercase();
        let mut score = 0;
        if norm_name == norm_full {
            score += 100;
        } else if norm_name.contains(&norm_full) || norm_full.contains(&norm_name) {
            score += 70;
        } else if norm_name == norm_base {
            score += 60;
        } else if norm_name.contains(&norm_base) {
            score += 40;
        }
        if episodes.len() > 1 {
            score += 10;
        }

        if best_item.as_ref().map_or(true, |(_, _, s)| score > *s) {
            best_item = Some((item, episodes, score));
        }
    }

    let (chosen, episodes, _) = best_item?;
    let matched_title = chosen["vod_name"]
        .as_str()
        .unwrap_or(&full_kw)
        .trim()
        .to_string();
    let remarks = chosen["vod_remarks"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("1080P 直连")
        .to_string();
    let pic = chosen["vod_pic"]
        .as_str()
        .unwrap_or("")
        .replace("http://", "https://");
    let actor = chosen["vod_actor"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| chosen["type_name"].as_str())
        .unwrap_or(&source_name)
        .to_string();

    let ep_idx = preferred_ep
        .filter(|&i| i >= 1 && i <= episodes.len())
        .unwrap_or(1);
    let play_url = episodes
        .get(ep_idx - 1)
        .or_else(|| episodes.first())
        .map(|e| e.url.clone())?;

    let m3u8_fmt = VideoFormat {
        format_id: format!("{}-1080p", source_id),
        quality_label: "1080P 超清直连".to_string(),
        height: 1080,
        fps: Some(30),
        ext: "m3u8".to_string(),
        vcodec: "h264".to_string(),
        acodec: "aac".to_string(),
        filesize: None,
        video_url: play_url.clone(),
        audio_url: None,
        is_dash: false,
        is_hls: true,
        headers: HashMap::new(),
    };

    Some((
        MediaSource {
            source_id,
            source_name,
            matched_title,
            remarks,
            source_type: "m3u8".to_string(),
            play_url,
            episodes,
            formats: vec![m3u8_fmt],
        },
        pic,
        actor,
    ))
}

async fn fetch_aggregated_sources(
    base_kw: &str,
    full_kw: &str,
    preferred_ep: Option<usize>,
) -> (Vec<MediaSource>, Option<(String, String, String)>) {
    let providers = crate::sources_config::get_active_vod_providers();
    if providers.is_empty() {
        return (vec![], None);
    }
    let tasks = providers
        .into_iter()
        .map(|p| {
            query_single_vod_api(
                p.id,
                p.name,
                p.api_base,
                base_kw.to_string(),
                full_kw.to_string(),
                preferred_ep,
            )
        })
        .collect::<Vec<_>>();

    let results = join_all(tasks).await;
    let mut sources = Vec::new();
    let mut first_meta: Option<(String, String, String)> = None;

    for item in results.into_iter().flatten() {
        let (src, pic, actor) = item;
        if first_meta.is_none() {
            first_meta = Some((src.matched_title.clone(), pic, actor));
        }
        sources.push(src);
    }

    (sources, first_meta)
}

fn build_parse_sources(official_url: &str, title: &str) -> Vec<MediaSource> {
    if !official_url.starts_with("http://") && !official_url.starts_with("https://") {
        return vec![];
    }
    let lines = crate::sources_config::get_active_parse_lines();
    lines
        .into_iter()
        .map(|line| MediaSource {
            source_id: line.id,
            source_name: line.name,
            matched_title: title.to_string(),
            remarks: "解析专线".to_string(),
            source_type: "jx_iframe".to_string(),
            play_url: format!("{}{}", line.url_prefix, official_url),
            episodes: vec![],
            formats: vec![],
        })
        .collect()
}

fn default_platform_showcase_title(_platform: &str) -> (&'static str, &'static str) {
    ("", "")
}

async fn extract_web_meta_title(url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;

    if let Ok(resp) = client.get(url).send().await {
        if let Ok(html) = resp.text().await {
            if let Ok(re) = Regex::new(r#"<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']"#) {
                if let Some(cap) = re.captures(&html) {
                    let t = cap[1].trim();
                    if !t.is_empty() && !is_generic_platform_title(t) {
                        return Some(t.to_string());
                    }
                }
            }
            if let Ok(re) = Regex::new(r#"<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:title["']"#) {
                if let Some(cap) = re.captures(&html) {
                    let t = cap[1].trim();
                    if !t.is_empty() && !is_generic_platform_title(t) {
                        return Some(t.to_string());
                    }
                }
            }
            if let Ok(re) = Regex::new(r#""showName":"([^"]+)""#) {
                if let Some(cap) = re.captures(&html) {
                    let t = cap[1].trim();
                    if !t.is_empty() && !is_generic_platform_title(t) {
                        return Some(t.to_string());
                    }
                }
            }
            if let Ok(re) = Regex::new(r#""videoTitle":"([^"]+)""#) {
                if let Some(cap) = re.captures(&html) {
                    let t = cap[1].trim();
                    if !t.is_empty() && !is_generic_platform_title(t) {
                        return Some(t.to_string());
                    }
                }
            }
            if let Ok(re) = Regex::new(r"<title>([^<]+)</title>") {
                if let Some(cap) = re.captures(&html) {
                    let raw_title = cap[1].trim();
                    if !raw_title.contains("404") && !raw_title.contains("页面不存在") && !is_generic_platform_title(raw_title) {
                        return Some(raw_title.to_string());
                    }
                }
            }
        }
    }

    // Mobile UA attempt
    let mobile_url = if url.contains("//www.") {
        url.replace("//www.", "//m.")
    } else {
        url.to_string()
    };
    let mobile_client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1")
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .ok()?;
    if let Ok(resp) = mobile_client.get(&mobile_url).send().await {
        if let Ok(html) = resp.text().await {
            if let Ok(re) = Regex::new(r#""showName":"([^"]+)""#) {
                if let Some(cap) = re.captures(&html) {
                    let t = cap[1].trim();
                    if !t.is_empty() && !is_generic_platform_title(t) {
                        return Some(t.to_string());
                    }
                }
            }
            if let Ok(re) = Regex::new(r"<title>([^<]+)</title>") {
                if let Some(cap) = re.captures(&html) {
                    let raw_title = cap[1].trim();
                    if !raw_title.contains("404") && !raw_title.contains("页面不存在") && !is_generic_platform_title(raw_title) {
                        return Some(raw_title.to_string());
                    }
                }
            }
        }
    }

    // Dynamic endpoint fallback
    let cid_re = Regex::new(r"/cover/([a-zA-Z0-9]+)").ok()?;
    let vid_re = Regex::new(r"[?&]vid=([a-zA-Z0-9]+)|/([a-zA-Z0-9]{11})\.html").ok()?;
    let cid = cid_re.captures(url).and_then(|c| c.get(1)).map(|m| m.as_str().to_string());
    let vid = vid_re.captures(url).and_then(|c| c.get(1).or_else(|| c.get(2))).map(|m| m.as_str().to_string());
    if cid.is_some() || vid.is_some() {
        let q_param = if let Some(ref c) = cid {
            format!("cid={}", c)
        } else if let Some(ref v) = vid {
            format!("vid={}", v)
        } else {
            String::new()
        };
        if !q_param.is_empty() {
            let api = format!("{}{}", dec(QQ_API), q_param);
            if let Ok(resp) = client.get(&api).header("User-Agent", "Mozilla/5.0").send().await {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(t) = json.pointer("/c/title").and_then(|v| v.as_str()) {
                        if !t.trim().is_empty() {
                            return Some(t.trim().to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

async fn extract_bili_bangumi_title_online(url: &str) -> Option<(String, Option<usize>)> {
    let ep_id = Regex::new(r"ep(\d+)")
        .ok()
        .and_then(|r| r.captures(url))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());
    let ss_id = Regex::new(r"ss(\d+)")
        .ok()
        .and_then(|r| r.captures(url))
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string());

    let pgc_query = if let Some(ep) = ep_id.as_ref() {
        format!("ep_id={}", ep)
    } else if let Some(ss) = ss_id.as_ref() {
        format!("season_id={}", ss)
    } else {
        return None;
    };

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .ok()?;
    let pgc_api = format!("{}{}", dec(BILI_PGC), pgc_query);
    let resp = client
        .get(&pgc_api)
        .header("Referer", &dec(BILI_HOST))
        .send()
        .await
        .ok()?;
    let json: serde_json::Value = resp.json().await.ok()?;
    let res = &json["result"];
    let title = res["season_title"]
        .as_str()
        .or_else(|| res["title"].as_str())?
        .trim()
        .to_string();

    let mut ep_idx: Option<usize> = None;
    if let Some(episodes) = res["episodes"].as_array() {
        if let Some(target_ep) = ep_id.as_ref() {
            if let Some((i, _)) = episodes.iter().enumerate().find(|(_, e)| {
                e["id"].as_i64().map(|id| id.to_string()) == Some(target_ep.clone())
            }) {
                ep_idx = Some(i + 1);
            }
        }
    }

    Some((title, ep_idx))
}

pub fn resolve_official_source(
    raw_url: &str,
    platform: &str,
    _title_hint: &str,
) -> (String, String, String) {
    let trimmed = raw_url.trim();

    if platform == dec(PLAT_BILI) {
        return (
            "native".to_string(),
            trimmed.to_string(),
            "官方原画直连解析".to_string(),
        );
    }

    (
        "official_web".to_string(),
        trimmed.to_string(),
        "官方原网页".to_string(),
    )
}

pub async fn extract_original_only(
    raw_url: &str,
    _proxy_url: Option<&str>,
) -> Result<VideoMetadata, String> {
    let trimmed = raw_url.trim();
    let (platform, platform_name) = detect_platform(trimmed);

    if platform == dec(PLAT_BILI) {
        if let Ok(meta) = extract_bili_native(trimmed).await {
            return Ok(meta);
        }
    }

    if platform == dec(PLAT_FEED) {
        return extract_feed_native(trimmed).await;
    }

    let (official_type, official_play_url, official_remarks) =
        resolve_official_source(trimmed, &platform, "官方原视频");

    let fmt = VideoFormat {
        format_id: "official-stream".to_string(),
        quality_label: "官方原视频".to_string(),
        height: 1080,
        fps: Some(30),
        ext: "mp4".to_string(),
        vcodec: "h264".to_string(),
        acodec: "aac".to_string(),
        filesize: None,
        video_url: official_play_url.clone(),
        audio_url: None,
        is_dash: false,
        is_hls: official_play_url.contains(".m3u8"),
        headers: HashMap::new(),
    };

    let official_src = MediaSource {
        source_id: "official-native".to_string(),
        source_name: format!("官方线路 · {}原视频解析", platform_name),
        matched_title: "官方原视频".to_string(),
        remarks: official_remarks,
        source_type: official_type,
        play_url: official_play_url.clone(),
        episodes: vec![],
        formats: vec![fmt.clone()],
    };

    Ok(VideoMetadata {
        id: "official-stream".to_string(),
        url: trimmed.to_string(),
        title: format!("{} 官方原视频", platform_name),
        uploader: platform_name.to_string(),
        thumbnail: "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=800&auto=format&fit=crop&q=80".to_string(),
        duration: 0,
        view_count: None,
        description: Some("已无缝切换至官方原视频解析线路播放".to_string()),
        platform: platform.to_string(),
        platform_name: platform_name.to_string(),
        cid: None,
        formats: vec![fmt],
        episodes: vec![],
        current_episode_index: 1,
        subtitles: vec![],
        auth_used: "official_login".to_string(),
        sources: vec![official_src],
        active_source_id: "official-native".to_string(),
    })
}

pub async fn parse_url_entry(
    raw_url: &str,
    page_title_hint: Option<&str>,
    _proxy_url: Option<&str>,
) -> Result<VideoMetadata, String> {
    let trimmed = raw_url.trim();
    let (platform, platform_name) = detect_platform(trimmed);

    // 1. Direct m3u8 / mp4 stream URL
    if trimmed.contains(".m3u8") || trimmed.contains(".mp4") {
        let is_hls = trimmed.contains(".m3u8");
        let fmt = VideoFormat {
            format_id: "direct-1080p".to_string(),
            quality_label: "1080P 超清直连".to_string(),
            height: 1080,
            fps: Some(30),
            ext: if is_hls { "m3u8".to_string() } else { "mp4".to_string() },
            vcodec: "h264".to_string(),
            acodec: "aac".to_string(),
            filesize: None,
            video_url: trimmed.to_string(),
            audio_url: None,
            is_dash: false,
            is_hls,
            headers: HashMap::new(),
        };
        let src = MediaSource {
            source_id: "direct-m3u8".to_string(),
            source_name: "超清直连源".to_string(),
            matched_title: "直链超清媒体流".to_string(),
            remarks: "1080P 直连".to_string(),
            source_type: "m3u8".to_string(),
            play_url: trimmed.to_string(),
            episodes: vec![],
            formats: vec![fmt.clone()],
        };
        return Ok(VideoMetadata {
            id: "direct-stream".to_string(),
            url: trimmed.to_string(),
            title: "直链超清媒体流".to_string(),
            uploader: "聚合直链源".to_string(),
            thumbnail: "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=800&auto=format&fit=crop&q=80".to_string(),
            duration: 0,
            view_count: None,
            description: Some("正在通过超清直链通道直接播放".to_string()),
            platform: "generic".to_string(),
            platform_name: "超清直连".to_string(),
            cid: None,
            formats: vec![fmt],
            episodes: vec![],
            current_episode_index: 1,
            subtitles: vec![],
            auth_used: "guest_boost".to_string(),
            sources: vec![src],
            active_source_id: "direct-m3u8".to_string(),
        });
    }

    // 2. Try native channel extraction
    let mut native_meta: Option<VideoMetadata> = None;
    let is_bili_bv = platform == dec(PLAT_BILI) && !trimmed.contains("/bangumi/");

    if is_bili_bv {
        if let Ok(meta) = extract_bili_native(trimmed).await {
            native_meta = Some(meta);
        }
    }

    if platform == dec(PLAT_FEED) {
        return extract_feed_native(trimmed).await;
    }

    // 3. Determine clean movie/drama/anime keyword to search across aggregated VOD sources
    let mut title_source = native_meta
        .as_ref()
        .map(|m| m.title.as_str())
        .or(page_title_hint)
        .unwrap_or("")
        .to_string();

    let mut extracted_kw = extract_clean_vod_query_and_episode(&title_source);

    let is_placeholder = extracted_kw.is_none()
        || title_source.is_empty()
        || title_source.starts_with("http")
        || title_source.contains("video #")
        || is_generic_platform_title(&title_source);

    if is_placeholder && (trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        if let Some(t) = extract_web_meta_title(trimmed).await {
            title_source = t;
            extracted_kw = extract_clean_vod_query_and_episode(&title_source);
        }
        if extracted_kw.is_none() && platform == dec(PLAT_BILI) {
            if let Some((t, ep)) = extract_bili_bangumi_title_online(trimmed).await {
                title_source = t;
                extracted_kw = extract_clean_vod_query_and_episode(&title_source);
                if let Some((b, f, _)) = extracted_kw {
                    extracted_kw = Some((b, f, ep));
                }
            }
        }
    }

    if extracted_kw.is_none() && !trimmed.starts_with("http://") && !trimmed.starts_with("https://")
    {
        extracted_kw = extract_clean_vod_query_and_episode(trimmed);
    }

    let (base_kw, full_kw, preferred_ep) = match extracted_kw {
        Some((b, f, ep)) => (b, f, ep),
        None if native_meta.is_none() && platform != dec(PLAT_FEED) => {
            let (b, f) = default_platform_showcase_title(&platform);
            (b.to_string(), f.to_string(), Some(1))
        }
        None => (String::new(), String::new(), None),
    };

    let (mut aggregated_sources, mut vod_meta) = if !base_kw.is_empty() {
        fetch_aggregated_sources(&base_kw, &full_kw, preferred_ep).await
    } else {
        (vec![], None)
    };

    if let Some(mut meta) = native_meta {
        let has_logged_in_cookie = get_platform_raw_cookie(&platform).is_some();
        let primary_play_url = meta
            .formats
            .first()
            .map(|f| f.video_url.clone())
            .unwrap_or_else(|| meta.url.clone());
        let official_src = MediaSource {
            source_id: "official-native".to_string(),
            source_name: format!("官方线路 · {}原视频解析", meta.platform_name),
            matched_title: meta.title.clone(),
            remarks: if has_logged_in_cookie {
                "原视频直连（已同步官网登录态）".to_string()
            } else {
                "原视频流直连解析".to_string()
            },
            source_type: "native".to_string(),
            play_url: primary_play_url,
            episodes: meta.episodes.clone(),
            formats: meta.formats.clone(),
        };
        let mut all_sources = Vec::new();
        all_sources.push(official_src);
        all_sources.append(&mut aggregated_sources);
        let mut jx_lines = build_parse_sources(trimmed, &meta.title);
        all_sources.append(&mut jx_lines);
        meta.sources = all_sources;
        meta.active_source_id = "official-native".to_string();
        return Ok(meta);
    }

    if aggregated_sources.is_empty() {
        let (fb_base, fb_full) = default_platform_showcase_title(&platform);
        let (fb_sources, fb_meta) = fetch_aggregated_sources(fb_base, fb_full, Some(1)).await;
        if !fb_sources.is_empty() {
            aggregated_sources = fb_sources;
        }
        if let Some(m) = fb_meta {
            let _ = vod_meta.get_or_insert(m);
        }
    }

    let (vod_title, vod_pic, vod_actor) = if let Some(primary_src) = aggregated_sources.first() {
        vod_meta.unwrap_or_else(|| {
            (
                primary_src.matched_title.clone(),
                String::new(),
                primary_src.source_name.clone(),
            )
        })
    } else {
        (
            page_title_hint.unwrap_or("视频播放").to_string(),
            String::new(),
            platform_name.to_string(),
        )
    };

    let mut jx_lines = build_parse_sources(trimmed, &vod_title);

    if !aggregated_sources.is_empty() || !jx_lines.is_empty() {
        let ep_idx = preferred_ep.unwrap_or(1);
        let mut all_sources = Vec::new();

        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            let (official_type, official_play_url, official_remarks) =
                resolve_official_source(trimmed, &platform, &vod_title);
            all_sources.push(MediaSource {
                source_id: "official-native".to_string(),
                source_name: format!("官方线路 · {}原网页", platform_name),
                matched_title: vod_title.clone(),
                remarks: official_remarks,
                source_type: official_type,
                play_url: official_play_url,
                episodes: vec![],
                formats: vec![],
            });
        }

        all_sources.append(&mut aggregated_sources);
        all_sources.append(&mut jx_lines);

        let first_m3u8 = all_sources.iter().find(|s| s.source_type == "m3u8");
        let first_jx = all_sources.iter().find(|s| s.source_type == "jx_iframe");

        let active_src_id = if let Some(m3u8) = first_m3u8 {
            m3u8.source_id.clone()
        } else if let Some(jx) = first_jx {
            jx.source_id.clone()
        } else {
            all_sources.first().map(|s| s.source_id.clone()).unwrap_or_default()
        };

        let primary_m3u8 = all_sources.iter().find(|s| s.source_type == "m3u8");
        let episodes = primary_m3u8.map(|s| s.episodes.clone()).unwrap_or_default();

        let fmt = primary_m3u8
            .and_then(|s| s.formats.first().cloned())
            .unwrap_or_else(|| VideoFormat {
                format_id: format!("{}-1080p", active_src_id),
                quality_label: "1080P 高清".to_string(),
                height: 1080,
                fps: Some(30),
                ext: "m3u8".to_string(),
                vcodec: "h264".to_string(),
                acodec: "aac".to_string(),
                filesize: None,
                video_url: primary_m3u8.map(|s| s.play_url.clone()).unwrap_or_else(|| {
                    all_sources.first().map(|s| s.play_url.clone()).unwrap_or_default()
                }),
                audio_url: None,
                is_dash: false,
                is_hls: true,
                headers: HashMap::new(),
            });

        return Ok(VideoMetadata {
            id: format!("play-{}", vod_title),
            url: if trimmed.starts_with("http") {
                trimmed.to_string()
            } else {
                fmt.video_url.clone()
            },
            title: vod_title,
            uploader: vod_actor,
            thumbnail: if vod_pic.is_empty() {
                "https://images.unsplash.com/photo-1536240478700-b869070f9279?w=800&auto=format&fit=crop&q=80".to_string()
            } else {
                vod_pic
            },
            duration: 0,
            view_count: None,
            description: Some(format!(
                "已检索到 {} 条播放线路",
                all_sources.len()
            )),
            platform: platform.to_string(),
            platform_name: platform_name.to_string(),
            cid: None,
            formats: vec![fmt],
            episodes,
            current_episode_index: ep_idx,
            subtitles: vec![],
            auth_used: "official_login".to_string(),
            sources: all_sources,
            active_source_id: active_src_id,
        });
    }

    Err("无法解析该视频链接，请确认网址有效或输入影视剧名称直接搜索".to_string())
}

pub async fn parse_video(raw_url: &str) -> Result<VideoMetadata, String> {
    parse_url_entry(raw_url, None, None).await
}

fn extract_bvid(url: &str) -> Option<String> {
    if let Ok(re) = Regex::new(r"(BV[a-zA-Z0-9]{10})") {
        if let Some(c) = re.captures(url) {
            return c.get(1).map(|m| m.as_str().to_string());
        }
    }
    if let Ok(re) = Regex::new(r"(?:/video/|/|\b)(av\d+)") {
        if let Some(c) = re.captures(url) {
            return c.get(1).map(|m| m.as_str().to_string());
        }
    }
    None
}

fn extract_page_num(url: &str) -> usize {
    let Ok(re) = Regex::new(r"[?&]p=(\d+)") else {
        return 1;
    };
    re.captures(url)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<usize>().ok())
        .filter(|&p| p >= 1)
        .unwrap_or(1)
}

fn pick_best_bili_cdn_url(node: &serde_json::Value) -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    for key in ["baseUrl", "base_url", "url"] {
        if let Some(s) = node[key].as_str() {
            if !s.is_empty() {
                candidates.push(s.to_string());
            }
        }
    }
    for key in ["backupUrl", "backup_url"] {
        if let Some(arr) = node[key].as_array() {
            for item in arr {
                if let Some(s) = item.as_str() {
                    if !s.is_empty() {
                        candidates.push(s.to_string());
                    }
                }
            }
        }
    }

    if let Some(u) = candidates.iter().find(|u| u.contains("upos-")) {
        return Some(u.clone());
    }

    let bili_cdn_domain = dec(BILIVIDEO_DOMAIN);
    if let Some(u) = candidates.iter().find(|u| {
        u.contains(&bili_cdn_domain)
            && !u.contains(".mcdn.")
            && !u.contains(":8082")
            && !u.contains(":4483")
    }) {
        return Some(u.clone());
    }

    candidates.into_iter().next()
}

fn map_bili_qn_label(qn: u32) -> (&'static str, u32, u32) {
    match qn {
        127 => ("8K 超高清", 4320, 60),
        126 => ("杜比视界", 2160, 60),
        125 => ("真彩 HDR", 2160, 60),
        120 => ("4K 蓝光 (2160P)", 2160, 60),
        116 => ("1080P 60帧", 1080, 60),
        112 => ("1080P+ 高码率", 1080, 30),
        80 => ("1080P 超清", 1080, 30),
        64 => ("720P 高清", 720, 30),
        32 => ("480P 标清", 480, 30),
        16 => ("360P 流畅", 360, 30),
        _ => ("480P 标清", 480, 30),
    }
}

pub async fn extract_bili_native(raw_url: &str) -> Result<VideoMetadata, String> {
    let client = build_ipv4_client(10)?;

    let mut resolved_url = if raw_url.contains(&dec(B23_DOMAIN)) {
        client
            .get(raw_url)
            .send()
            .await
            .map(|r| r.url().to_string())
            .unwrap_or_else(|_| raw_url.to_string())
    } else {
        raw_url.to_string()
    };

    if resolved_url.contains("/bangumi/play/") {
        let ep_id = Regex::new(r"ep(\d+)")
            .ok()
            .and_then(|r| r.captures(&resolved_url))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        let ss_id = Regex::new(r"ss(\d+)")
            .ok()
            .and_then(|r| r.captures(&resolved_url))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());

        let pgc_query = if let Some(ep) = ep_id.as_ref() {
            format!("ep_id={}", ep)
        } else if let Some(ss) = ss_id.as_ref() {
            format!("season_id={}", ss)
        } else {
            String::new()
        };

        if !pgc_query.is_empty() {
            let pgc_api = format!("{}{}", dec(BILI_PGC), pgc_query);
            if let Ok(pgc_resp) = client.get(&pgc_api).header("Referer", &dec(BILI_HOST)).send().await {
                if let Ok(pgc_json) = pgc_resp.json::<serde_json::Value>().await {
                    if let Some(episodes) = pgc_json["result"]["episodes"].as_array() {
                        let target_ep = if let Some(ep) = ep_id {
                            episodes.iter().find(|e| e["id"].as_i64().map(|id| id.to_string()) == Some(ep.clone()))
                        } else {
                            episodes.first()
                        };
                        if let Some(ep_node) = target_ep.or_else(|| episodes.first()) {
                            if let Some(ep_bvid) = ep_node["bvid"].as_str() {
                                resolved_url = format!("{}{}", dec(BILI_VIDEO_PREFIX), ep_bvid);
                            }
                        }
                    }
                }
            }
        }
    }

    let bvid = extract_bvid(&resolved_url).ok_or("未找到有效的 BV 号或视频 ID")?;
    let target_page = extract_page_num(&resolved_url);

    let plat_key = dec(PLAT_BILI);
    let saved_cookie = get_platform_raw_cookie(&plat_key);
    let has_official_login = saved_cookie.is_some();
    let cookie_header = saved_cookie
        .unwrap_or_else(|| "buvid3=VEXA-GUEST-CLIENT-8899-INFOC; b_nut=1710000000".to_string());

    let view_api = if bvid.starts_with("BV") {
        format!("{}bvid={}", dec(BILI_VIEW), bvid)
    } else {
        let aid = bvid.trim_start_matches("av");
        format!("{}aid={}", dec(BILI_VIEW), aid)
    };
    let view_json: serde_json::Value = client
        .get(&view_api)
        .header("Referer", &dec(BILI_HOST))
        .header("Cookie", &cookie_header)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if view_json["code"].as_i64().unwrap_or(-1) != 0 {
        return Err(view_json["message"]
            .as_str()
            .unwrap_or("视频解析接口返回错误")
            .to_string());
    }

    let data = &view_json["data"];
    let title = data["title"].as_str().unwrap_or("原画视频").to_string();
    let uploader = data["owner"]["name"].as_str().unwrap_or("UP主").to_string();
    let pic = data["pic"]
        .as_str()
        .unwrap_or("")
        .replace("http://", "https://");
    let mut duration = data["duration"].as_u64().unwrap_or(0);
    let mut cid = data["cid"].as_u64().unwrap_or(0);
    let view_count = data["stat"]["view"].as_u64();
    let desc = data["desc"].as_str().map(|s| s.to_string());

    let mut episodes = Vec::new();
    let mut active_ep_index = 1;
    if let Some(pages) = data["pages"].as_array() {
        for (i, p) in pages.iter().enumerate() {
            let p_cid = p["cid"].as_u64().unwrap_or(cid);
            let p_part = p["part"].as_str().unwrap_or(&title).to_string();
            let p_dur = p["duration"].as_u64().unwrap_or(duration);
            let page_num = i + 1;
            if page_num == target_page {
                cid = p_cid;
                duration = p_dur;
                active_ep_index = page_num;
            }
            episodes.push(EpisodeItem {
                index: page_num,
                id: format!("{}-p{}", bvid, page_num),
                cid: Some(p_cid),
                title: p_part,
                duration: p_dur,
                url: format!("{}{}?p={}", dec(BILI_VIDEO_PREFIX), bvid, page_num),
            });
        }
    }

    let mut req_headers = HashMap::new();
    req_headers.insert("Referer".to_string(), dec(BILI_HOST));

    let mut formats = Vec::new();
    let mut covered_heights = HashSet::new();

    let bili_param = if bvid.starts_with("BV") {
        format!("bvid={}&cid={}", bvid, cid)
    } else {
        let aid = bvid.trim_start_matches("av");
        format!("aid={}&cid={}", aid, cid)
    };

    // 1. Fetch progressive MP4 stream
    let html5_api = format!(
        "{}{}qn=64&fnval=1&platform=html5&high_quality=1",
        dec(BILI_PLAY),
        format!("{}&", bili_param)
    );
    if let Ok(h5_resp) = client
        .get(&html5_api)
        .header("Referer", &dec(BILI_HOST))
        .header("Cookie", &cookie_header)
        .send()
        .await
    {
        if let Ok(h5_json) = h5_resp.json::<serde_json::Value>().await {
            if let Some(durl) = h5_json["data"]["durl"].as_array() {
                if let Some(first) = durl.first() {
                    if let Some(u) = pick_best_bili_cdn_url(first) {
                        covered_heights.insert(480);
                        formats.push(VideoFormat {
                            format_id: "stream-mp4-480p".to_string(),
                            quality_label: "480P 标清".to_string(),
                            height: 480,
                            fps: Some(30),
                            ext: "mp4".to_string(),
                            vcodec: "avc1".to_string(),
                            acodec: "mp4a.40.2".to_string(),
                            filesize: first["size"].as_u64(),
                            video_url: u.clone(),
                            audio_url: None,
                            is_dash: false,
                            is_hls: false,
                            headers: req_headers.clone(),
                        });
                    }
                }
            }
        }
    }

    // 2. Fetch DASH streams
    let play_api = format!(
        "{}{}qn=120&fnval=4048&fourk=1",
        dec(BILI_PLAY),
        format!("{}&", bili_param)
    );
    if let Ok(play_resp) = client
        .get(&play_api)
        .header("Referer", &dec(BILI_HOST))
        .header("Cookie", &cookie_header)
        .send()
        .await
    {
        if let Ok(play_json) = play_resp.json::<serde_json::Value>().await {
            let play_data = &play_json["data"];
            let best_audio_url = play_data["dash"]["audio"]
                .as_array()
                .and_then(|arr| arr.first())
                .and_then(pick_best_bili_cdn_url);

            let mut seen_qn = HashSet::new();
            if let Some(videos) = play_data["dash"]["video"].as_array() {
                for v in videos {
                    let qn = v["id"].as_u64().unwrap_or(80) as u32;
                    let codecs = v["codecs"].as_str().unwrap_or("");
                    if !codecs.starts_with("avc") || seen_qn.contains(&qn) {
                        continue;
                    }
                    let (q_label, height, fps) = map_bili_qn_label(qn);
                    if covered_heights.contains(&height) && qn <= 32 {
                        continue;
                    }
                    if let Some(v_url) = pick_best_bili_cdn_url(v) {
                        seen_qn.insert(qn);
                        formats.push(VideoFormat {
                            format_id: format!("stream-dash-{}", qn),
                            quality_label: q_label.to_string(),
                            height,
                            fps: Some(fps),
                            ext: "mp4".to_string(),
                            vcodec: codecs.to_string(),
                            acodec: "mp4a.40.2".to_string(),
                            filesize: None,
                            video_url: v_url,
                            audio_url: best_audio_url.clone(),
                            is_dash: best_audio_url.is_some(),
                            is_hls: false,
                            headers: req_headers.clone(),
                        });
                    }
                }
            }
        }
    }

    formats.sort_by(|a, b| b.height.cmp(&a.height));

    Ok(VideoMetadata {
        id: bvid.clone(),
        url: if active_ep_index > 1 {
            format!(
                "{}{}?p={}",
                dec(BILI_VIDEO_PREFIX), bvid, active_ep_index
            )
        } else {
            format!("{}{}", dec(BILI_VIDEO_PREFIX), bvid)
        },
        title,
        uploader,
        thumbnail: pic,
        duration,
        view_count,
        description: desc,
        platform: plat_key,
        platform_name: "原画直连".to_string(),
        cid: Some(cid),
        formats,
        episodes,
        current_episode_index: active_ep_index,
        subtitles: vec![],
        auth_used: if has_official_login {
            "official_login".to_string()
        } else {
            "guest_boost".to_string()
        },
        sources: vec![],
        active_source_id: "official-native".to_string(),
    })
}

pub fn extract_feed_id_and_clean_url(raw: &str) -> (Option<String>, Option<String>) {
    let trimmed = raw.trim();
    let escaped_domain = dec(FEED_DOMAIN).replace('.', r"\.");
    let pattern1 = format!(r"https?://v\.{}/[a-zA-Z0-9]+/?", escaped_domain);
    if let Ok(re) = Regex::new(&pattern1) {
        if let Some(m) = re.find(trimmed) {
            return (None, Some(m.as_str().to_string()));
        }
    }
    let pattern2 = format!(r"v\.{}/[a-zA-Z0-9]+/?", escaped_domain);
    if let Ok(re) = Regex::new(&pattern2) {
        if let Some(m) = re.find(trimmed) {
            return (None, Some(format!("https://{}", m.as_str())));
        }
    }
    if let Ok(re) = Regex::new(r"/(?:video|note|share/video)/(\d+)") {
        if let Some(caps) = re.captures(trimmed) {
            return (Some(caps[1].to_string()), None);
        }
    }
    if let Ok(re) = Regex::new(r"\b(\d{18,20})\b") {
        if let Some(caps) = re.captures(trimmed) {
            return (Some(caps[1].to_string()), None);
        }
    }
    (None, None)
}

fn build_feed_metadata(
    id: &str,
    title: &str,
    uploader: &str,
    thumbnail: &str,
    duration: u64,
    play_url: String,
) -> VideoMetadata {
    let mut req_headers = HashMap::new();
    req_headers.insert("Referer".to_string(), dec(FEED_HOST));
    req_headers.insert(
        "User-Agent".to_string(),
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36".to_string(),
    );

    let is_hls = play_url.contains(".m3u8");
    let ext = if is_hls { "m3u8".to_string() } else { "mp4".to_string() };

    let fmt = VideoFormat {
        format_id: "feed-1080p".to_string(),
        quality_label: "1080P 超清".to_string(),
        height: 1080,
        fps: Some(60),
        ext,
        vcodec: "h264".to_string(),
        acodec: "aac".to_string(),
        filesize: None,
        video_url: play_url.clone(),
        audio_url: None,
        is_dash: false,
        is_hls,
        headers: req_headers,
    };

    let src = MediaSource {
        source_id: "feed-native".to_string(),
        source_name: "官方标准直连".to_string(),
        matched_title: title.to_string(),
        remarks: "1080P 高清直连".to_string(),
        source_type: if is_hls { "m3u8".to_string() } else { "mp4".to_string() },
        play_url: play_url.clone(),
        episodes: vec![],
        formats: vec![fmt.clone()],
    };

    let plat_key = dec(PLAT_FEED);
    VideoMetadata {
        id: id.to_string(),
        url: if id.starts_with("http") {
            id.to_string()
        } else {
            format!("{}{}", dec(FEED_VIDEO_PREFIX), id)
        },
        title: title.to_string(),
        uploader: uploader.to_string(),
        thumbnail: if thumbnail.is_empty() {
            "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80".to_string()
        } else {
            thumbnail.to_string()
        },
        duration,
        view_count: None,
        description: Some(format!("创作者 @{} 的视频作品", uploader)),
        platform: plat_key,
        platform_name: "媒体视频".to_string(),
        cid: None,
        formats: vec![fmt],
        episodes: vec![],
        current_episode_index: 1,
        subtitles: vec![],
        auth_used: "standard_direct".to_string(),
        sources: vec![src],
        active_source_id: "feed-native".to_string(),
    }
}

pub async fn extract_feed_native(raw_input: &str) -> Result<VideoMetadata, String> {
    let (mut aweme_id_opt, short_url_opt) = extract_feed_id_and_clean_url(raw_input);

    let mobile_ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

    if aweme_id_opt.is_none() {
        if let Some(short_url) = short_url_opt {
            let no_redirect_client = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(mobile_ua)
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .ok();

            if let Some(c) = no_redirect_client {
                if let Ok(resp) = c.get(&short_url).send().await {
                    let loc = resp
                        .headers()
                        .get(reqwest::header::LOCATION)
                        .and_then(|h| h.to_str().ok())
                        .unwrap_or("");
                    if let Ok(re) = Regex::new(r"/(?:video|note|share/video)/(\d+)") {
                        if let Some(caps) = re.captures(loc) {
                            aweme_id_opt = Some(caps[1].to_string());
                        }
                    }
                }
            }
        }
    }

    if aweme_id_opt.is_none() {
        let cached_url = crate::browser::get_cached_url();
        let (cached_id, _) = extract_feed_id_and_clean_url(&cached_url);
        if cached_id.is_some() {
            aweme_id_opt = cached_id;
        }
    }

    let client = reqwest::Client::builder()
        .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
        .user_agent(mobile_ua)
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    if let Some(ref aweme_id) = aweme_id_opt {
        let api_url = format!("{}{}", dec(FEED_API), aweme_id);
        let req = client
            .get(&api_url)
            .header("User-Agent", mobile_ua);

        if let Ok(resp) = req.send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let items = json["aweme_list"].as_array();
                let item = items
                    .and_then(|arr| arr.iter().find(|it| it["aweme_id"].as_str() == Some(aweme_id.as_str())))
                    .or_else(|| items.and_then(|arr| arr.first()))
                    .unwrap_or(&json["aweme_detail"]);

                if !item.is_null() {
                    let desc = item["desc"].as_str().unwrap_or("精选视频").to_string();
                    let nickname = item
                        .pointer("/author/nickname")
                        .and_then(|v| v.as_str())
                        .unwrap_or("创作者")
                        .to_string();
                    let duration = item
                        .pointer("/video/duration")
                        .and_then(|v| v.as_u64())
                        .map(|d| d / 1000)
                        .unwrap_or(0);
                    let cover = item
                        .pointer("/video/cover/url_list/0")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();

                    let mut play_url = None;
                    if let Some(list) = item.pointer("/video/play_addr/url_list").and_then(|v| v.as_array()) {
                        for u in list {
                            if let Some(s) = u.as_str() {
                                play_url = Some(s.replace("playwm", "play"));
                                break;
                            }
                        }
                    }
                    if play_url.is_none() {
                        if let Some(list) = item.pointer("/video/download_addr/url_list").and_then(|v| v.as_array()) {
                            for u in list {
                                if let Some(s) = u.as_str() {
                                    play_url = Some(s.to_string());
                                    break;
                                }
                            }
                        }
                    }

                    if let Some(pu) = play_url {
                        return Ok(build_feed_metadata(
                            aweme_id, &desc, &nickname, &cover, duration, pu,
                        ));
                    }
                }
            }
        }
    }

    let cached_media_src = crate::browser::get_cached_media_src();
    if !cached_media_src.is_empty()
        && (cached_media_src.contains("vod")
            || cached_media_src.contains("cloudcdn")
            || cached_media_src.contains(".mp4")
            || cached_media_src.contains(".m3u8"))
    {
        let cached_title = crate::browser::get_cached_title();
        let title = if !cached_title.is_empty() {
            cached_title.split("|||").next().unwrap_or(&cached_title).trim().to_string()
        } else {
            "精选视频".to_string()
        };
        let fallback_id = aweme_id_opt.unwrap_or_else(|| "feed-live".to_string());
        return Ok(build_feed_metadata(
            &fallback_id,
            &title,
            "创作者",
            "",
            0,
            cached_media_src,
        ));
    }

    Err("未能成功提取原视频播放地址，请在“官方网站”中打开该视频，或检查链接是否正确有效".to_string())
}

pub async fn fetch_danmaku(cid: u64) -> Result<Vec<DanmakuItem>, String> {
    let client = build_ipv4_client(6)?;

    let url = format!("{}{}", dec(BILI_DM), cid);
    let bytes = client
        .get(&url)
        .header("Referer", &dec(BILI_HOST))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let xml_text = {
        let mut decoder = DeflateDecoder::new(&bytes[..]);
        let mut s = String::new();
        if decoder.read_to_string(&mut s).is_ok() && s.contains("<d ") {
            s
        } else {
            String::from_utf8_lossy(&bytes).to_string()
        }
    };

    let re = Regex::new(r#"<d p="([^"]+)">([^<]+)</d>"#).map_err(|e| e.to_string())?;
    let mut list = Vec::new();

    for cap in re.captures_iter(&xml_text) {
        let p_attr = &cap[1];
        let text = cap[2].trim().to_string();
        if text.is_empty() {
            continue;
        }
        let parts: Vec<&str> = p_attr.split(',').collect();
        if parts.len() >= 4 {
            let time = parts[0].parse::<f64>().unwrap_or(0.0);
            let mode = parts[1].parse::<u8>().unwrap_or(1);
            let color_int = parts[3].parse::<u32>().unwrap_or(16777215);
            let color_hex = format!("#{:06x}", color_int & 0xFFFFFF);
            list.push(DanmakuItem {
                time,
                text,
                color: color_hex,
                mode: if mode == 4 || mode == 5 { mode } else { 1 },
            });
        }
        if list.len() >= 400 {
            break;
        }
    }

    list.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));
    Ok(list)
}

pub async fn search_media_sources(
    query: &str,
    platform: &str,
    custom_vod_api: Option<&str>,
) -> Result<Vec<SearchResultItem>, String> {
    let client = build_ipv4_client(8)?;
    let mut results = Vec::new();
    let tag_re = Regex::new(r"<[^>]+>").unwrap();
    let bili_key = dec(PLAT_BILI);
    let cookie = get_platform_raw_cookie(&bili_key)
        .unwrap_or_else(|| "buvid3=VEXA-SEARCH-8899-INFOC".to_string());

    let trimmed_q = query.trim();

    if trimmed_q.is_empty() && (platform == "all" || platform == bili_key) {
        let pop_url = dec(BILI_POP);
        if let Ok(resp) = client
            .get(&pop_url)
            .header("Referer", &dec(BILI_HOST))
            .header("Cookie", &cookie)
            .send()
            .await
        {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(arr) = json["data"]["list"].as_array() {
                    for item in arr.iter().take(16) {
                        let bvid = item["bvid"].as_str().unwrap_or("").to_string();
                        if bvid.is_empty() {
                            continue;
                        }
                        let title = item["title"].as_str().unwrap_or("热门视频").to_string();
                        let author = item["owner"]["name"].as_str().unwrap_or("UP主").to_string();
                        let pic = item["pic"]
                            .as_str()
                            .unwrap_or("")
                            .replace("http://", "https://");
                        let dur_secs = item["duration"].as_u64().unwrap_or(0);
                        let play_cnt = item["stat"]["view"].as_u64().unwrap_or(0);

                        results.push(SearchResultItem {
                            id: bvid.clone(),
                            url: format!("{}{}", dec(BILI_VIDEO_PREFIX), bvid),
                            title,
                            uploader: author,
                            thumbnail: pic,
                            duration: dur_secs,
                            view_count: Some(format_view_count(play_cnt)),
                            platform: bili_key.clone(),
                            platform_name: "原画直连".to_string(),
                            badge: Some("热门推荐".to_string()),
                        });
                    }
                }
            }
        }
        if !results.is_empty() {
            return Ok(results);
        }
    }

    let effective_query = if trimmed_q.is_empty() {
        String::new()
    } else if platform != "all" && platform != bili_key {
        format!("{} {}", platform, trimmed_q)
    } else {
        trimmed_q.to_string()
    };

    if !effective_query.is_empty() {
        let bili_search_url = dec(BILI_SEARCH).replace("{}", &urlencoding::encode(&effective_query));

        if let Ok(resp) = client
            .get(&bili_search_url)
            .header("Referer", &dec(BILI_HOST))
            .header("Cookie", &cookie)
            .send()
            .await
        {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(arr) = json["data"]["result"].as_array() {
                    for item in arr.iter().take(16) {
                        let bvid = item["bvid"].as_str().unwrap_or("").to_string();
                        if bvid.is_empty() {
                            continue;
                        }
                        let raw_title = item["title"].as_str().unwrap_or("视频");
                        let clean_title = tag_re
                            .replace_all(raw_title, "")
                            .replace("&quot;", "\"")
                            .replace("&#x27;", "'")
                            .replace("&amp;", "&");
                        let author = item["author"].as_str().unwrap_or("UP主").to_string();
                        let mut pic = item["pic"].as_str().unwrap_or("").to_string();
                        if pic.starts_with("//") {
                            pic = format!("https:{}", pic);
                        } else if pic.starts_with("http://") {
                            pic = pic.replace("http://", "https://");
                        }
                        let dur_str = item["duration"].as_str().unwrap_or("0:0");
                        let dur_secs = parse_colon_duration(dur_str);
                        let play_cnt = item["play"].as_u64().unwrap_or(0);

                        results.push(SearchResultItem {
                            id: bvid.clone(),
                            url: format!("{}{}", dec(BILI_VIDEO_PREFIX), bvid),
                            title: clean_title,
                            uploader: author,
                            thumbnail: pic,
                            duration: dur_secs,
                            view_count: Some(format_view_count(play_cnt)),
                            platform: platform.to_string(),
                            platform_name: "高清直连".to_string(),
                            badge: Some("高清直连".to_string()),
                        });
                    }
                }
            }
        }
    }

    if let Some(vod_api) = custom_vod_api {
        if !vod_api.trim().is_empty() && !trimmed_q.is_empty() {
            let vod_url = format!(
                "{}?ac=detail&wd={}",
                vod_api.trim().trim_end_matches('?'),
                urlencoding::encode(trimmed_q)
            );
            if let Ok(resp) = client.get(&vod_url).send().await {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(list) = json["list"].as_array() {
                        for item in list.iter().take(8) {
                            let name = item["vod_name"].as_str().unwrap_or("影视剧集").to_string();
                            let pic = item["vod_pic"].as_str().unwrap_or("").to_string();
                            let remarks = item["vod_remarks"]
                                .as_str()
                                .unwrap_or("超清正片")
                                .to_string();
                            let play_url = item["vod_play_url"].as_str().unwrap_or("");
                            if let Some(m3u8) = extract_first_m3u8(play_url) {
                                results.push(SearchResultItem {
                                    id: format!("vod-{}", name),
                                    url: m3u8,
                                    title: name,
                                    uploader: "影视聚合源".to_string(),
                                    thumbnail: pic,
                                    duration: 0,
                                    view_count: Some(remarks.clone()),
                                    platform: platform.to_string(),
                                    platform_name: "影视正片".to_string(),
                                    badge: Some(remarks),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

fn format_view_count(cnt: u64) -> String {
    if cnt >= 10_000 {
        format!("{:.1}万播放", cnt as f64 / 10_000.0)
    } else {
        format!("{}次播放", cnt)
    }
}

fn parse_colon_duration(s: &str) -> u64 {
    let parts: Vec<u64> = s.split(':').filter_map(|p| p.parse::<u64>().ok()).collect();
    if parts.len() == 2 {
        parts[0] * 60 + parts[1]
    } else if parts.len() == 3 {
        parts[0] * 3600 + parts[1] * 60 + parts[2]
    } else {
        0
    }
}

fn extract_first_m3u8(play_url: &str) -> Option<String> {
    let re = Regex::new(r"https?://[^\s#$]+\.m3u8").ok()?;
    re.find(play_url).map(|m| m.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_platform_encoding() {
        assert_eq!(dec(PLAT_BILI).len(), 8);
        assert_eq!(dec(PLAT_FEED).len(), 6);
        assert_eq!(dec(BILI_HOST).starts_with("http"), true);
        assert_eq!(dec(FEED_HOST).starts_with("http"), true);
    }

    #[test]
    fn test_extract_feed_id_and_clean_url() {
        let url = format!("https://v.{}/i9R1q7Y/", dec(FEED_DOMAIN));
        let (id, u) = extract_feed_id_and_clean_url(&url);
        assert_eq!(id, None);
        assert_eq!(u, Some(url));

        let full_url = format!("https://www.{}/video/7395012345678901234", dec(FEED_DOMAIN));
        let (id3, _) = extract_feed_id_and_clean_url(&full_url);
        assert_eq!(id3, Some("7395012345678901234".to_string()));

        let (id5, _) = extract_feed_id_and_clean_url("7395012345678901234");
        assert_eq!(id5, Some("7395012345678901234".to_string()));
    }

    #[test]
    fn test_clean_single_title_candidate() {
        let raw = "《繁花》第05集 - 1080P 在线观看";
        let res = clean_single_title_candidate(raw);
        assert!(res.is_some());
        let (base, full, ep) = res.unwrap();
        assert_eq!(base, "繁花");
        assert_eq!(full, "繁花");
        assert_eq!(ep, Some(5));
    }
}
