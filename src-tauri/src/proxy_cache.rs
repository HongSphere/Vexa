use once_cell::sync::Lazy;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(any(target_os = "android", target_os = "ios"))]
const SEGMENT_CACHE_MAX_BYTES: usize = 16 * 1024 * 1024;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
const SEGMENT_CACHE_MAX_BYTES: usize = 48 * 1024 * 1024;

const MAX_SINGLE_SEGMENT_BYTES: usize = 8 * 1024 * 1024;
const M3U8_CACHE_MAX_ENTRIES: usize = 64;
const M3U8_CACHE_TTL_SECS: u64 = 90;

pub static SHARED_STREAM_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .pool_max_idle_per_host(16)
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_nodelay(true)
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(45))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

pub static SHARED_M3U8_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .pool_max_idle_per_host(12)
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_nodelay(true)
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

#[derive(Clone)]
pub struct CachedSegment {
    pub bytes: Vec<u8>,
    pub content_type: String,
}

struct SegmentLruState {
    entries: HashMap<String, CachedSegment>,
    order: VecDeque<String>,
    total_bytes: usize,
}

static SEGMENT_CACHE: Lazy<Mutex<SegmentLruState>> = Lazy::new(|| {
    Mutex::new(SegmentLruState {
        entries: HashMap::new(),
        order: VecDeque::new(),
        total_bytes: 0,
    })
});

pub fn get_cached_segment(key: &str) -> Option<CachedSegment> {
    let mut guard = SEGMENT_CACHE.lock().ok()?;
    if let Some(val) = guard.entries.get(key).cloned() {
        guard.order.retain(|k| k != key);
        guard.order.push_back(key.to_string());
        return Some(val);
    }
    None
}

pub fn put_cached_segment(key: String, bytes: Vec<u8>, content_type: String) {
    let size = bytes.len();
    if size == 0 || size > MAX_SINGLE_SEGMENT_BYTES {
        return;
    }
    let Ok(mut guard) = SEGMENT_CACHE.lock() else {
        return;
    };
    if let Some(old) = guard.entries.remove(&key) {
        guard.total_bytes = guard.total_bytes.saturating_sub(old.bytes.len());
        guard.order.retain(|k| k != &key);
    }
    while guard.total_bytes + size > SEGMENT_CACHE_MAX_BYTES {
        if let Some(oldest_key) = guard.order.pop_front() {
            if let Some(removed) = guard.entries.remove(&oldest_key) {
                guard.total_bytes = guard.total_bytes.saturating_sub(removed.bytes.len());
            }
        } else {
            break;
        }
    }
    guard.total_bytes += size;
    guard.order.push_back(key.clone());
    guard.entries.insert(
        key,
        CachedSegment {
            bytes,
            content_type,
        },
    );
}

#[derive(Clone)]
struct CachedM3u8 {
    body: String,
    final_url: String,
    inserted_at: Instant,
}

struct M3u8CacheState {
    entries: HashMap<String, CachedM3u8>,
    order: VecDeque<String>,
}

static M3U8_CACHE: Lazy<Mutex<M3u8CacheState>> = Lazy::new(|| {
    Mutex::new(M3u8CacheState {
        entries: HashMap::new(),
        order: VecDeque::new(),
    })
});

pub fn get_cached_m3u8(url: &str) -> Option<(String, String)> {
    let mut guard = M3U8_CACHE.lock().ok()?;
    if let Some(entry) = guard.entries.get(url) {
        if entry.inserted_at.elapsed().as_secs() <= M3U8_CACHE_TTL_SECS {
            return Some((entry.body.clone(), entry.final_url.clone()));
        }
    }
    guard.entries.remove(url);
    guard.order.retain(|k| k != url);
    None
}

pub fn put_cached_m3u8(url: String, body: String, final_url: String) {
    if body.is_empty() || body.len() > 1024 * 1024 {
        return;
    }
    let Ok(mut guard) = M3U8_CACHE.lock() else {
        return;
    };
    if guard.entries.contains_key(&url) {
        guard.order.retain(|k| k != &url);
    }
    while guard.entries.len() >= M3U8_CACHE_MAX_ENTRIES {
        if let Some(oldest) = guard.order.pop_front() {
            guard.entries.remove(&oldest);
        } else {
            break;
        }
    }
    guard.order.push_back(url.clone());
    guard.entries.insert(
        url,
        CachedM3u8 {
            body,
            final_url,
            inserted_at: Instant::now(),
        },
    );
}

pub async fn prefetch_m3u8_index(url: &str, headers: Option<HashMap<String, String>>) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() || get_cached_m3u8(trimmed).is_some() {
        return true;
    }
    let mut req = SHARED_M3U8_CLIENT
        .get(trimmed)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            if !k.is_empty() && !v.is_empty() {
                req = req.header(k, v);
            }
        }
    }
    if let Ok(resp) = req.send().await {
        if resp.status().is_success() {
            let final_url = resp.url().to_string();
            if let Ok(text) = resp.text().await {
                if text.contains("#EXTM3U") {
                    put_cached_m3u8(trimmed.to_string(), text, final_url);
                    return true;
                }
            }
        }
    }
    false
}
