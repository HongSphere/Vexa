use crate::auth::persist_platform_cookie;
use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, WebviewUrl,
};

const CHILD_WEBVIEW_LABEL: &str = "platform-official-webview";

const DESKTOP_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MOBILE_USER_AGENT: &str =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

static CURRENT_WEBVIEW_LABEL: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
static CURRENT_WEBVIEW_IS_MOBILE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static WEBVIEW_GENERATION: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

static PLATFORM_WEBVIEW_POOL: Lazy<Mutex<std::collections::HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));
static PLATFORM_LRU: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));
const MAX_POOL_SIZE: usize = 3;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn get_active_child_webview(app: &AppHandle) -> Option<tauri::Webview> {
    let label = CURRENT_WEBVIEW_LABEL.lock().ok()?.clone();
    if label.is_empty() {
        app.get_webview(CHILD_WEBVIEW_LABEL)
    } else {
        app.get_webview(&label).or_else(|| app.get_webview(CHILD_WEBVIEW_LABEL))
    }
}
static WEBVIEW_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static LAST_WEBVIEW_URL: Lazy<Mutex<String>> =
    Lazy::new(|| Mutex::new("about:blank".to_string()));
static LAST_WEBVIEW_TITLE: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
static LAST_WEBVIEW_MEDIA_SRC: Lazy<Mutex<String>> = Lazy::new(|| Mutex::new(String::new()));
static PLATFORM_CACHED_URLS: Lazy<Mutex<std::collections::HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));
static PLATFORM_CACHED_TITLES: Lazy<Mutex<std::collections::HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(std::collections::HashMap::new()));

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatePayload {
    pub url: String,
    pub platform: String,
}

const WEBVIEW_BRIDGE_SCRIPT: &str = r#"
(function() {
  if (window.__VEXA_INJECTED__) return;
  window.__VEXA_INJECTED__ = true;

  let lastClickedTitle = '';
  window.__VEXA_FEED_MAP__ = window.__VEXA_FEED_MAP__ || {};

  const parseFeedMediaItem = (item) => {
    if (!item || typeof item !== 'object') return;
    const mediaId = (item.video && item.video.play_addr && item.video.play_addr.uri)
      || item.item_id || item.id || item.video_id
      || (typeof item === 'object' && Object.entries(item).find(([k, v]) => k.endsWith('_id') && typeof v === 'string' && /^\d{16,21}$/.test(v))?.[1]);
    if (!mediaId) return;
    const desc = item.desc || '';
    const nickname = (item.author && item.author.nickname) || '视频创作者';
    const videoObj = item.video || {};
    let playUrl = '';
    const playList = (videoObj.play_addr && videoObj.play_addr.url_list) ||
      (videoObj.play_addr_h264 && videoObj.play_addr_h264.url_list) ||
      (videoObj.download_addr && videoObj.download_addr.url_list) || [];
    for (const u of playList) {
      if (u && (u.startsWith('http://') || u.startsWith('https://'))) {
        playUrl = u.replace('playwm', 'play');
        break;
      }
    }
    if (playUrl) {
      window.__VEXA_FEED_MAP__[mediaId] = {
        mediaId,
        title: desc,
        nickname,
        playUrl
      };
    }
  };

  const scanFeedMediaData = (jsonObj) => {
    if (!jsonObj || typeof jsonObj !== 'object') return;
    for (const [k, v] of Object.entries(jsonObj)) {
      if (Array.isArray(v) && (k.endsWith('_list') || k === 'items' || k === 'data' || k === 'list')) {
        v.forEach(parseFeedMediaItem);
      } else if (v && typeof v === 'object' && (k.endsWith('_detail') || k === 'detail' || k === 'data')) {
        parseFeedMediaItem(v);
      }
    }
  };

  try {
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = async function(...args) {
        const u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        const resp = await origFetch.apply(this, args);
        try {
          if (u && (u.includes('/feed/') || u.includes('/detail/') || u.includes('/web/tab/') || u.includes('/video/'))) {
            const clone = resp.clone();
            clone.json().then(data => scanFeedMediaData(data)).catch(() => {});
          }
        } catch(_) {}
        return resp;
      };
    }
  } catch(_) {}

  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this.__vexa_url = url;
      return origOpen.apply(this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.send = function(...args) {
      this.addEventListener('load', function() {
        try {
          const u = this.__vexa_url;
          if (typeof u === 'string' && (u.includes('/feed/') || u.includes('/detail/') || u.includes('/web/tab/') || u.includes('/video/'))) {
            const text = this.responseText;
            if (text && (text.startsWith('{') || text.startsWith('['))) {
              scanFeedMediaData(JSON.parse(text));
            }
          }
        } catch(_) {}
      });
      return origSend.apply(this, args);
    };
  } catch(_) {}

  const reportSyncToVexa = (forceUrl, forceTitle) => {
    try {
      const liveHref = forceUrl || window.location.href || '';
      if (!liveHref || !liveHref.startsWith('http')) return;
      const docTitle = forceTitle || (document.title ? document.title.trim() : '');
      fetch('https://vexa.internal/sync?url=' + encodeURIComponent(liveHref) + '&title=' + encodeURIComponent(docTitle)).catch(() => {});
    } catch(_) {}
  };

  try {
    const origPushState = history.pushState;
    if (origPushState) {
      history.pushState = function(...args) {
        const ret = origPushState.apply(this, args);
        setTimeout(() => { try { syncPageMetaCookie(); } catch(_) {} }, 20);
        return ret;
      };
    }
    const origReplaceState = history.replaceState;
    if (origReplaceState) {
      history.replaceState = function(...args) {
        const ret = origReplaceState.apply(this, args);
        setTimeout(() => { try { syncPageMetaCookie(); } catch(_) {} }, 20);
        return ret;
      };
    }
    window.addEventListener('popstate', () => { setTimeout(() => { try { syncPageMetaCookie(); } catch(_) {} }, 20); }, true);
    window.addEventListener('hashchange', () => { setTimeout(() => { try { syncPageMetaCookie(); } catch(_) {} }, 20); }, true);
  } catch(_) {}

  const syncPageMetaCookie = () => {
    try {
      const href = window.location.href || '';
      if (!href || !href.startsWith('http')) return;

      document.cookie = '__vexa_url=' + encodeURIComponent(href) + '; path=/; max-age=7200';

      let domHeadingText = '';
      const titleSelectors = [
        '.video-detail-intro-new h1',
        '.video-detail-intro-new [class*="_titleBar_"]',
        '[class*="introDetailWrap"] h1',
        '[class*="introMain"] h1',
        '[class*="video-detail-intro"] h1',
        '[class*="_titleBar_"]',
        'h1.video-title',
        '.video-title',
        '.player-title',
        '.vod-title',
        '.title-txt',
        '[data-e2e="video-desc"]',
        '[data-player-hook="video-title"]',
        '.play-title',
        '.v-panel-title',
        '[class*="video-title"]',
        '[class*="video_title"]',
        '[class*="videoName"]',
        '[class*="albumName"]',
        'h1'
      ];
      for (const sel of titleSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent) {
          const t = el.textContent.trim();
          if (t && t.length >= 2 && !t.includes('首页') && !t.includes('官网') && !t.includes('VIP') && !t.includes('会员') && !t.includes('频道')) {
            domHeadingText = t;
            break;
          }
        }
      }

      const activeDescEl = document.querySelector('[data-e2e="video-desc"], .account-card-desc, .video-info-title');
      const activeDesc = activeDescEl && activeDescEl.textContent ? activeDescEl.textContent.trim() : '';
      const docTitle = document.title ? document.title.trim() : '';

      const combined = [domHeadingText, activeDesc, docTitle, lastClickedTitle].filter(Boolean).join(' ||| ');
      if (combined) {
        document.cookie = '__vexa_title=' + encodeURIComponent(combined.slice(0, 300)) + '; path=/; max-age=7200';
      }
      reportSyncToVexa(href, combined);

      const isFeedPlatform = Boolean(window.__VEXA_FEED_MAP__ && Object.keys(window.__VEXA_FEED_MAP__).length > 0)
        || Boolean(window.location.search.includes('modal_id=') || window.location.pathname.includes('/video/'));
      if (isFeedPlatform && document.querySelector('video')) {
        const vids = Array.from(document.querySelectorAll('video'));
        let activeVideo = vids.find(v => !v.paused && v.currentTime > 0);
        if (!activeVideo) {
          const mid = window.innerHeight / 2;
          activeVideo = vids.find(v => {
            const r = v.getBoundingClientRect();
            return r.top <= mid && r.bottom >= mid && r.width > 80 && r.height > 80;
          });
        }
        if (!activeVideo && vids.length > 0) {
          activeVideo = vids.find(v => {
            const r = v.getBoundingClientRect();
            return r.width > 80 && r.height > 80;
          }) || vids[0];
        }

        let activeCard = null;
        if (activeVideo) {
          activeCard = activeVideo.closest('[data-e2e*="video"], .swiper-slide, [class*="slider-video"], [class*="item-container"]') || activeVideo.parentElement;
        }
        if (!activeCard) {
          activeCard = document.querySelector('[data-e2e="feed-active-video"]')
            || document.querySelector('.swiper-slide-active')
            || document.querySelector('[data-e2e="feed-video"]')
            || document.querySelector('[data-e2e="video-item"]');
        }

        let mediaId = '';
        const mUrl = window.location.pathname.match(/\/video\/(\d+)/)
          || window.location.search.match(/modal_id=(\d+)/)
          || window.location.search.match(/[?&][^=]*_?id=(\d{16,21})/);
        if (mUrl && mUrl[1]) {
          mediaId = mUrl[1];
        }

        if (!mediaId && activeCard) {
          let curr = activeCard;
          while (curr && curr !== document.body) {
            for (const attr of ['data-e2e-vid', 'data-video-id', 'data-item-id', 'data-id', 'data-vid']) {
              const val = curr.getAttribute && curr.getAttribute(attr);
              if (val && /^\d+$/.test(val)) {
                mediaId = val;
                break;
              }
            }
            if (mediaId) break;
            const a = curr.querySelector && curr.querySelector('a[href*="/video/"], a[href*="modal_id="], a[href*="id="]');
            if (a && a.href) {
              const m = a.href.match(/\/video\/(\d+)/) || a.href.match(/modal_id=(\d+)/) || a.href.match(/[?&][^=]*_?id=(\d{16,21})/);
              if (m && m[1]) {
                mediaId = m[1];
                break;
              }
            }
            curr = curr.parentElement;
          }
        }

        if (!mediaId && activeCard && window.__VEXA_FEED_MAP__) {
          const descEl = activeCard.querySelector('[data-e2e="video-desc"], .title, h1');
          const descText = descEl ? descEl.textContent.trim() : '';
          if (descText) {
            for (const [id, item] of Object.entries(window.__VEXA_FEED_MAP__)) {
              if (item.title && (descText.includes(item.title) || item.title.includes(descText))) {
                mediaId = id;
                break;
              }
            }
          }
        }

        if (mediaId) {
          const videoUrl = window.location.origin + '/video/' + mediaId;
          document.cookie = '__vexa_url=' + encodeURIComponent(videoUrl) + '; path=/; max-age=7200';
          reportSyncToVexa(videoUrl);
          if (window.__VEXA_FEED_MAP__ && window.__VEXA_FEED_MAP__[mediaId]) {
            const item = window.__VEXA_FEED_MAP__[mediaId];
            if (item.playUrl) {
              document.cookie = '__vexa_media_src=' + encodeURIComponent(item.playUrl) + '; path=/; max-age=7200';
            }
            if (item.title) {
              document.cookie = '__vexa_title=' + encodeURIComponent(item.title) + '; path=/; max-age=7200';
            }
          }
        }
        return;
      }

      const vids = Array.from(document.querySelectorAll('video'));
      let targetVid = vids.find(v => !v.paused && v.currentTime > 0);
      if (!targetVid) {
        targetVid = vids.find(v => {
          const r = v.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight && r.width > 100;
        });
      }
      if (!targetVid) {
        targetVid = vids.find(v => {
          const s = v.currentSrc || v.src || '';
          return s && !s.startsWith('blob:') && (s.startsWith('http://') || s.startsWith('https://'));
        });
      }

      let vSrc = '';
      if (targetVid) {
        const s = targetVid.currentSrc || targetVid.src || '';
        if (s && !s.startsWith('blob:') && (s.startsWith('http://') || s.startsWith('https://'))) {
          vSrc = s;
        }
      }
      if (vSrc) {
        document.cookie = '__vexa_media_src=' + encodeURIComponent(vSrc) + '; path=/; max-age=7200';
      }
    } catch (_) {}
  };

  const isDisallowedScheme = function(u) {
    if (!u || typeof u !== 'string') return false;
    const trimmed = u.trim().toLowerCase();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('about:') || trimmed.startsWith('data:') || trimmed.startsWith('#')) return false;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return false;
    return true;
  };

  window.open = function(url) {
    if (isDisallowedScheme(url)) {
      return null;
    }
    if (url && typeof url === 'string' && !url.startsWith('javascript:')) {
      window.location.href = url;
    }
    return window;
  };

  const keepLinkInSameView = function(e) {
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a && a.href) {
      if (isDisallowedScheme(a.href)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!a.href.startsWith('javascript:')) {
        const linkTitle = (a.getAttribute('title') || a.textContent || '').trim();
        if (linkTitle && linkTitle.length >= 2 && linkTitle.length <= 80) {
          lastClickedTitle = linkTitle;
        }
        if (a.target === '_blank') {
          a.target = '_self';
          a.removeAttribute('target');
        }
        syncPageMetaCookie();
      }
    }
  };

  document.addEventListener('mousedown', keepLinkInSameView, true);
  document.addEventListener('click', keepLinkInSameView, true);

  try {
    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {
      if (this.tagName === 'IFRAME' && typeof name === 'string' && name.toLowerCase() === 'src' && isDisallowedScheme(val)) {
        return;
      }
      return origSetAttribute.call(this, name, val);
    };
  } catch(_) {}

  try {
    const origAssign = window.location.assign;
    if (origAssign) {
      window.location.assign = function(url) {
        if (isDisallowedScheme(url)) return;
        return origAssign.call(window.location, url);
      };
    }
    const origReplace = window.location.replace;
    if (origReplace) {
      window.location.replace = function(url) {
        if (isDisallowedScheme(url)) return;
        return origReplace.call(window.location, url);
      };
    }
  } catch(_) {}

  const dismissAppPopups = function() {
    try {
      const STAY_ON_WEB_LABELS = [
        '继续使用浏览器', '继续浏览', '留在网页', '留在浏览器', '网页播放', '网页版播放', '不用了', '暂不打开'
      ];
      const allTargets = document.querySelectorAll('button, a, span, p, div');
      for (const el of allTargets) {
        if (!el || el.children.length > 2) continue;
        const txt = (el.innerText || el.textContent || '').trim();
        if (STAY_ON_WEB_LABELS.includes(txt)) {
          try { el.click(); } catch(_) {}
        }
      }

      const candidates = document.querySelectorAll('div, section, footer, aside');
      for (const d of candidates) {
        const t = (d.innerText || '').trim();
        if (t.length > 0 && t.length < 50 && (
          t.includes('打开APP') || t.includes('打开小程序') || t.includes('打开方式') ||
          t.includes('看海量高清视频') || t.includes('在APP中看') || t.includes('APP内打开') ||
          t.includes('下载客户端') || t.includes('APP看')
        )) {
          const pos = window.getComputedStyle(d).position;
          if (pos === 'fixed' || pos === 'sticky') {
            d.style.setProperty('display', 'none', 'important');
            d.style.setProperty('pointer-events', 'none', 'important');
          }
        }
      }
    } catch(_) {}
  };

  const injectCleanStyle = () => {
    if (document.getElementById('vexa-clean-style')) return;
    const style = document.createElement('style');
    style.id = 'vexa-clean-style';
    style.textContent = `
      html, body {
        overflow-x: hidden !important;
      }
      .ytp-ad-overlay-container, .ytp-ad-message-container,
      .cupid-extend-bar, .ad-report, .v-p-ad {
        display: none !important;
      }
      [class*="open-app" i], [class*="open_app" i], [class*="openapp" i],
      [class*="launch-app" i], [class*="launch-box" i], [class*="launch_box" i],
      [class*="download-app" i], [class*="download-bar" i], [class*="download_bar" i],
      [class*="app-guide" i], [class*="app-banner" i], [class*="app-download" i],
      [class*="callapp" i], [class*="call-app" i], [class*="call_app" i],
      [class*="bottom-modal" i], [class*="guide-box" i], [class*="layer-open" i] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };
  injectCleanStyle();
  document.addEventListener('DOMContentLoaded', () => {
    injectCleanStyle();
    syncPageMetaCookie();
    dismissAppPopups();
  });

  try {
    const mo = new MutationObserver(() => {
      dismissAppPopups();
    });
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  } catch(_) {}

  window.__VEXA_SYNC_ACTIVE__ = syncPageMetaCookie;
  ['play', 'playing', 'timeupdate', 'scroll', 'wheel', 'keydown'].forEach(evt => {
    window.addEventListener(evt, syncPageMetaCookie, { passive: true, capture: true });
  });

  setInterval(() => {
    try {
      syncPageMetaCookie();
      dismissAppPopups();
      const skipSelectors = [
        '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern', '.ytp-skip-ad-button',
        '.txp_ad_skip_text', '.cupid-skip-button', '.bpx-player-electric-jump'
      ];
      for (const sel of skipSelectors) {
        const btn = document.querySelector(sel);
        if (btn && typeof btn.click === 'function') {
          btn.click();
        }
      }
    } catch (_) {}
  }, 500);
})();
"#;

pub fn detect_platform_from_url(url: &str) -> (String, String) {
    if let Ok(parsed) = reqwest::Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            let parts: Vec<&str> = host.split('.').collect();
            let base_domain = if parts.len() >= 2 {
                format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
            } else {
                host.to_string()
            };
            let platform_id = parts.get(parts.len().saturating_sub(2)).unwrap_or(&"generic").to_string();
            let cookie_domain = format!(".{}", base_domain);
            return (platform_id, cookie_domain);
        }
    }
    ("generic".to_string(), "".to_string())
}

pub fn get_cached_url() -> String {
    LAST_WEBVIEW_URL
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default()
}

pub fn get_cached_title() -> String {
    LAST_WEBVIEW_TITLE
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default()
}

pub fn get_cached_media_src() -> String {
    LAST_WEBVIEW_MEDIA_SRC
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default()
}

pub fn get_cached_title_for_platform(platform: &str) -> Option<String> {
    if let Ok(map) = PLATFORM_CACHED_TITLES.lock() {
        if let Some(t) = map.get(platform) {
            let tr = t.trim();
            if !tr.is_empty() {
                return Some(tr.to_string());
            }
        }
    }
    None
}

pub fn set_cached_title_for_platform(platform: &str, t: &str) {
    let tr = t.trim();
    if !tr.is_empty() {
        if let Ok(mut map) = PLATFORM_CACHED_TITLES.lock() {
            map.insert(platform.to_string(), tr.to_string());
        }
        if let Ok(mut g) = LAST_WEBVIEW_TITLE.lock() {
            *g = tr.to_string();
        }
    }
}

fn set_cached_url(u: &str) {
    if !u.is_empty() && (u.starts_with("http://") || u.starts_with("https://")) {
        if let Ok(mut g) = LAST_WEBVIEW_URL.lock() {
            *g = u.to_string();
        }
        let (plat, _) = detect_platform_from_url(u);
        if let Ok(mut map) = PLATFORM_CACHED_URLS.lock() {
            map.insert(plat, u.to_string());
        }
    }
}

fn set_cached_title(t: &str) {
    let tr = t.trim();
    if !tr.is_empty() {
        if let Ok(mut g) = LAST_WEBVIEW_TITLE.lock() {
            *g = tr.to_string();
        }
        let cur_url = get_cached_url();
        let (plat, _) = detect_platform_from_url(&cur_url);
        if !plat.is_empty() {
            if let Ok(mut map) = PLATFORM_CACHED_TITLES.lock() {
                map.insert(plat, tr.to_string());
            }
        }
    }
}

pub fn set_cached_media_src(s: &str) {
    if !s.trim().is_empty() && (s.starts_with("http://") || s.starts_with("https://")) {
        if let Ok(mut g) = LAST_WEBVIEW_MEDIA_SRC.lock() {
            *g = s.trim().to_string();
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn sync_webview_cookies(app: &AppHandle) {
    let Some(wv) = get_active_child_webview(app) else {
        return;
    };
    let parsed_url = if let Ok(u) = wv.url() {
        if u.as_str().starts_with("http") && !u.as_str().contains("about:blank") {
            u
        } else {
            let url_str = get_cached_url();
            let Ok(p) = tauri::Url::parse(&url_str) else { return; };
            p
        }
    } else {
        let url_str = get_cached_url();
        let Ok(p) = tauri::Url::parse(&url_str) else { return; };
        p
    };
    let (platform, domain) = detect_platform_from_url(parsed_url.as_str());

    if let Ok(cookies) = wv.cookies_for_url(parsed_url) {
        if !cookies.is_empty() {
            let mut pairs: Vec<String> = Vec::new();
            for c in &cookies {
                let name = c.name();
                let val = c.value();
                if name == "__vexa_title" {
                    if let Ok(decoded) = urlencoding::decode(val) {
                        set_cached_title_for_platform(&platform, &decoded);
                    }
                    continue;
                }
                if name == "__vexa_url" {
                    if let Ok(decoded) = urlencoding::decode(val) {
                        let d_str = decoded.to_string();
                        let (d_plat, _) = detect_platform_from_url(&d_str);
                        if d_plat == platform {
                            set_cached_url(&d_str);
                        }
                    }
                    continue;
                }
                if name == "__vexa_media_src" {
                    if let Ok(decoded) = urlencoding::decode(val) {
                        set_cached_media_src(&decoded);
                    }
                    continue;
                }
                pairs.push(format!("{}={}", name, val));
            }
            let raw_header = pairs.join("; ");
            let is_logged_in = raw_header.contains("SESSDATA=") || raw_header.contains("sessionid=") || pairs.len() > 4;
            if is_logged_in {
                persist_platform_cookie(
                    &platform,
                    &domain,
                    &raw_header,
                    Some("会话已同步".to_string()),
                );
            }
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn sync_webview_cookies(_app: &AppHandle) {}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn resolve_aligned_bounds(
    app: &AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    window_height: Option<f64>,
) -> (f64, f64, f64, f64) {
    let cx = x.round();
    let cw = width.round().max(10.0);
    let ch = height.round().max(10.0);

    if let Some(window) = app.get_window("main") {
        let scale = window.scale_factor().unwrap_or(1.0);
        if let Ok(inner_phys) = window.inner_size() {
            let inner_logical = inner_phys.to_logical::<f64>(scale);
            let win_w = inner_logical.width.round();
            let win_h = inner_logical.height.round();

            if cx >= 100.0 {
                let aligned_w = (win_w - cx).max(cw).max(10.0).round();
                let aligned_y = (win_h - ch).max(y.round());
                return (cx, aligned_y, aligned_w, ch);
            }

            let titlebar_h = if let Some(css_h) = window_height {
                let diff = win_h - css_h;
                if diff > 10.0 && diff < 60.0 {
                    diff
                } else {
                    #[cfg(target_os = "macos")]
                    { 28.0 }
                    #[cfg(not(target_os = "macos"))]
                    { 0.0 }
                }
            } else {
                #[cfg(target_os = "macos")]
                { 28.0 }
                #[cfg(not(target_os = "macos"))]
                { 0.0 }
            };

            let aligned_y = (y + titlebar_h).round().max(0.0);
            let aligned_w = win_w.min(cw).max(10.0).round();
            return (cx, aligned_y, aligned_w, ch);
        }
    }

    (cx, y.round(), cw, ch)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn mount_or_update_platform_webview(
    app: &AppHandle,
    url: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    window_height: Option<f64>,
    visible: bool,
) -> Result<String, String> {
    let _guard = WEBVIEW_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let (cx, cy, cw, ch) = resolve_aligned_bounds(app, x, y, width, height, window_height);
    let target_zoom = if cw < 768.0 { 1.0 } else { (cw / 1240.0).clamp(0.75, 1.0) };
    let is_mobile_os = cfg!(any(target_os = "android", target_os = "ios"));
    let is_mobile = is_mobile_os || (cx < 50.0 && cw < 500.0);
    let target_ua = if is_mobile {
        MOBILE_USER_AGENT
    } else {
        DESKTOP_USER_AGENT
    };

    let current_mode_is_mobile = CURRENT_WEBVIEW_IS_MOBILE.load(std::sync::atomic::Ordering::Relaxed);
    if current_mode_is_mobile != is_mobile {
        CURRENT_WEBVIEW_IS_MOBILE.store(is_mobile, std::sync::atomic::Ordering::Relaxed);
        if let Ok(mut pool) = PLATFORM_WEBVIEW_POOL.lock() {
            for (_, label) in pool.drain() {
                if let Some(wv) = app.get_webview(&label) {
                    let _ = wv.close();
                }
            }
        }
        if let Ok(mut lru) = PLATFORM_LRU.lock() {
            lru.clear();
        }
        if let Ok(mut label_guard) = CURRENT_WEBVIEW_LABEL.lock() {
            label_guard.clear();
        }
    }

    if !visible || cw <= 10.0 || ch <= 10.0 {
        if let Ok(pool) = PLATFORM_WEBVIEW_POOL.lock() {
            for (_, label) in pool.iter() {
                if let Some(wv) = app.get_webview(label) {
                    let _ = wv.eval(
                        "document.querySelectorAll('video, audio').forEach(el => { try { el.pause(); } catch(_){} });",
                    );
                    let _ = wv.hide();
                }
            }
        }
        return Ok(get_cached_url());
    }

    let initial_url_str = url
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(get_cached_url);
    let trimmed_initial = initial_url_str.trim().to_string();
    let (platform_id, _) = detect_platform_from_url(&trimmed_initial);

    if let Ok(pool) = PLATFORM_WEBVIEW_POOL.lock() {
        for (plat, label) in pool.iter() {
            if plat != &platform_id {
                if let Some(wv) = app.get_webview(label) {
                    let _ = wv.eval("document.querySelectorAll('video, audio').forEach(el => { try { el.pause(); } catch(_){} });");
                    let _ = wv.hide();
                }
            }
        }
    }

    let existing_label = {
        let pool = PLATFORM_WEBVIEW_POOL.lock().unwrap_or_else(|e| e.into_inner());
        pool.get(&platform_id).cloned()
    };

    if let Some(ref label) = existing_label {
        if let Some(wv) = app.get_webview(label) {
            if let Ok(mut lru) = PLATFORM_LRU.lock() {
                lru.retain(|p| p != &platform_id);
                lru.insert(0, platform_id.clone());
            }
            if let Ok(mut label_guard) = CURRENT_WEBVIEW_LABEL.lock() {
                *label_guard = label.clone();
            }

            let _ = wv.set_bounds(Rect {
                position: LogicalPosition::new(cx, cy).into(),
                size: LogicalSize::new(cw, ch).into(),
            });
            let _ = wv.set_zoom(target_zoom);
            let _ = wv.show();

            if let Some(target_url) = url {
                let trimmed = target_url.trim();
                if !trimmed.is_empty() {
                    let cached = get_cached_url();
                    let (cached_plat, _) = detect_platform_from_url(&cached);
                    if cached_plat != platform_id {
                        if let Ok(parsed) = trimmed.parse::<tauri::Url>() {
                            set_cached_url(trimmed);
                            let _ = wv.navigate(parsed);
                        }
                    }
                }
            }

            return Ok(get_cached_url());
        }
    }

    let to_evict = {
        let mut lru = PLATFORM_LRU.lock().unwrap_or_else(|e| e.into_inner());
        let mut pool = PLATFORM_WEBVIEW_POOL.lock().unwrap_or_else(|e| e.into_inner());
        let mut evict_label = None;
        if pool.len() >= MAX_POOL_SIZE {
            if let Some(oldest_plat) = lru.pop() {
                if let Some(lbl) = pool.remove(&oldest_plat) {
                    evict_label = Some(lbl);
                }
            }
        }
        evict_label
    };
    if let Some(lbl) = to_evict {
        if let Some(wv) = app.get_webview(&lbl) {
            let _ = wv.close();
        }
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    set_cached_url(&trimmed_initial);
    let parsed_url = tauri::Url::parse(&trimmed_initial).map_err(|e| e.to_string())?;

    let gen = WEBVIEW_GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let label = format!("platform-webview-{}-{}", platform_id, gen);

    let app_handle_nav = app.clone();
    let app_handle_load = app.clone();
    let app_handle_new_win = app.clone();
    let app_handle_res = app.clone();

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed_url))
        .user_agent(target_ua)
        .initialization_script(WEBVIEW_BRIDGE_SCRIPT)
        .on_web_resource_request(move |req, res| {
            if req.uri().host() == Some("vexa.internal") && req.uri().path() == "/sync" {
                if let Some(query) = req.uri().query() {
                    for param in query.split('&') {
                        if let Some((k, v)) = param.split_once('=') {
                            if let Ok(decoded) = urlencoding::decode(v) {
                                if k == "url" {
                                    let u_str = decoded.to_string();
                                    set_cached_url(&u_str);
                                    let (plat, _) = detect_platform_from_url(&u_str);
                                    let _ = app_handle_res.emit(
                                        "platform-webview-url",
                                        BrowserStatePayload {
                                            url: u_str,
                                            platform: plat,
                                        },
                                    );
                                } else if k == "title" {
                                    set_cached_title(&decoded);
                                } else if k == "media_src" {
                                    set_cached_media_src(&decoded);
                                }
                            }
                        }
                    }
                }
                *res.status_mut() = tauri::http::StatusCode::OK;
                res.headers_mut().insert(
                    tauri::http::header::CONTENT_TYPE,
                    tauri::http::HeaderValue::from_static("application/json"),
                );
                res.headers_mut().insert(
                    tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
                    tauri::http::HeaderValue::from_static("*"),
                );
                *res.body_mut() = std::borrow::Cow::Borrowed(b"{\"ok\":true}");
            }
        })
        .on_new_window(move |new_url, _features| {
            let u_str = new_url.to_string();
            if u_str.starts_with("http://") || u_str.starts_with("https://") {
                set_cached_url(&u_str);
                let app_clone = app_handle_new_win.clone();
                let target_url = new_url.clone();
                std::thread::spawn(move || {
                    if let Some(wv) = get_active_child_webview(&app_clone) {
                        let _ = wv.navigate(target_url);
                    }
                    let (plat, _) = detect_platform_from_url(&u_str);
                    let _ = app_clone.emit(
                        "platform-webview-url",
                        BrowserStatePayload {
                            url: u_str,
                            platform: plat.to_string(),
                        },
                    );
                });
            }
            NewWindowResponse::Deny
        })
        .on_navigation(move |nav_url| {
            let u_str = nav_url.to_string();
            if u_str.starts_with("http://") || u_str.starts_with("https://") {
                set_cached_url(&u_str);
                let (plat, _) = detect_platform_from_url(&u_str);
                let _ = app_handle_nav.emit(
                    "platform-webview-url",
                    BrowserStatePayload {
                        url: u_str,
                        platform: plat.to_string(),
                    },
                );
                true
            } else {
                false
            }
        })
        .on_page_load(move |wv, payload| {
            let u_str = payload.url().to_string();
            if u_str.starts_with("http://") || u_str.starts_with("https://") {
                set_cached_url(&u_str);
                let (plat, _) = detect_platform_from_url(&u_str);
                let _ = app_handle_load.emit(
                    "platform-webview-url",
                    BrowserStatePayload {
                        url: u_str,
                        platform: plat.to_string(),
                    },
                );
            }
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = wv.eval(WEBVIEW_BRIDGE_SCRIPT);
                let app_bg = app_handle_load.clone();
                std::thread::spawn(move || {
                    sync_webview_cookies(&app_bg);
                });
            }
        });

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(cx, cy),
            LogicalSize::new(cw, ch),
        )
        .map_err(|e| e.to_string())?;

    if let Ok(mut pool) = PLATFORM_WEBVIEW_POOL.lock() {
        pool.insert(platform_id.clone(), label.clone());
    }
    if let Ok(mut lru) = PLATFORM_LRU.lock() {
        lru.retain(|p| p != &platform_id);
        lru.insert(0, platform_id);
    }
    if let Ok(mut label_guard) = CURRENT_WEBVIEW_LABEL.lock() {
        *label_guard = label;
    }
    CURRENT_WEBVIEW_IS_MOBILE.store(is_mobile, std::sync::atomic::Ordering::Relaxed);

    let _ = webview.set_bounds(Rect {
        position: LogicalPosition::new(cx, cy).into(),
        size: LogicalSize::new(cw, ch).into(),
    });
    let _ = webview.set_zoom(target_zoom);
    let _ = webview.show();
    Ok(initial_url_str)
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn mount_or_update_platform_webview(
    _app: &AppHandle,
    url: Option<String>,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
    _window_height: Option<f64>,
    _visible: bool,
) -> Result<String, String> {
    if let Some(ref u) = url {
        set_cached_url(u);
    }
    Ok(url.unwrap_or_else(get_cached_url))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn control_platform_webview(app: &AppHandle, action: &str) -> Result<String, String> {
    let Some(wv) = get_active_child_webview(app) else {
        return Ok(String::new());
    };

    match action {
        "back" => {
            let _ = wv.eval("window.history.back();");
        }
        "forward" => {
            let _ = wv.eval("window.history.forward();");
        }
        "reload" => {
            let _ = wv.eval("window.location.reload();");
        }
        "pause_media" => {
            let _ = wv.eval("document.querySelectorAll('video, audio').forEach(el => { try { el.pause(); } catch(_){} });");
        }
        "hide" => {
            let _ = wv.eval("document.querySelectorAll('video, audio').forEach(el => { try { el.pause(); } catch(_){} });");
            let _ = wv.hide();
        }
        "show" => {
            let _ = wv.show();
        }
        _ => {}
    }

    Ok(get_cached_url())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn control_platform_webview(_app: &AppHandle, _action: &str) -> Result<String, String> {
    Ok(get_cached_url())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn get_platform_webview_url(app: &AppHandle) -> Result<String, String> {
    if let Some(wv) = get_active_child_webview(app) {
        let _ = wv.eval("if (window.__VEXA_SYNC_ACTIVE__) window.__VEXA_SYNC_ACTIVE__();");
        std::thread::sleep(std::time::Duration::from_millis(60));
        sync_webview_cookies(app);

        let cached = get_cached_url();
        let wv_url_str = wv.url().ok().map(|u| u.to_string()).unwrap_or_default();

        eprintln!("[VEXA_DEBUG] get_platform_webview_url: wv.url='{}', cached='{}'", wv_url_str, cached);

        let is_concrete_page = |u: &str| -> bool {
            if let Ok(parsed) = tauri::Url::parse(u) {
                let p = parsed.path();
                p.len() > 1 && p != "/index.html" && p != "/index.htm"
            } else {
                false
            }
        };

        if is_concrete_page(&wv_url_str) {
            set_cached_url(&wv_url_str);
            return Ok(wv_url_str);
        }

        if is_concrete_page(&cached) {
            return Ok(cached);
        }

        if !wv_url_str.is_empty() && (wv_url_str.starts_with("http://") || wv_url_str.starts_with("https://")) {
            return Ok(wv_url_str);
        }
    }
    Ok(get_cached_url())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn get_platform_webview_url(_app: &AppHandle) -> Result<String, String> {
    Ok(get_cached_url())
}
