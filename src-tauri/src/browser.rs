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
    const awemeId = item.aweme_id || (item.video && item.video.play_addr && item.video.play_addr.uri);
    if (!awemeId) return;
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
      window.__VEXA_FEED_MAP__[awemeId] = {
        awemeId,
        title: desc,
        nickname,
        playUrl
      };
    }
  };

  const scanFeedMediaData = (jsonObj) => {
    if (!jsonObj || typeof jsonObj !== 'object') return;
    if (Array.isArray(jsonObj.aweme_list)) {
      jsonObj.aweme_list.forEach(parseFeedMediaItem);
    }
    if (Array.isArray(jsonObj.item_list)) {
      jsonObj.item_list.forEach(parseFeedMediaItem);
    }
    if (jsonObj.aweme_detail) {
      parseFeedMediaItem(jsonObj.aweme_detail);
    }
  };

  // Intercept fetch
  try {
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = async function(...args) {
        const u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        const resp = await origFetch.apply(this, args);
        try {
          if (u && (u.includes('/aweme/v1/') || u.includes('/feed/') || u.includes('/detail/') || u.includes('/web/tab/'))) {
            const clone = resp.clone();
            clone.json().then(data => scanFeedMediaData(data)).catch(() => {});
          }
        } catch(_) {}
        return resp;
      };
    }
  } catch(_) {}

  // Intercept XMLHttpRequest
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
          if (typeof u === 'string' && (u.includes('/aweme/v1/') || u.includes('/feed/') || u.includes('/detail/') || u.includes('/web/tab/'))) {
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

  const syncPageMetaCookie = () => {
    try {
      const href = window.location.href || '';
      if (href.startsWith('http')) {
        document.cookie = '__vexa_url=' + encodeURIComponent(href) + '; path=/; max-age=7200';
      }

      // Active video & ID detection: strictly tracks the currently playing / centered video
      if (document.querySelector('video')) {
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

        let awemeId = '';
        const mUrl = window.location.pathname.match(/\/video\/(\d+)/)
          || window.location.search.match(/modal_id=(\d+)/)
          || window.location.search.match(/aweme_id=(\d+)/);
        if (mUrl && mUrl[1]) {
          awemeId = mUrl[1];
        }

        if (!awemeId && activeCard) {
          let curr = activeCard;
          while (curr && curr !== document.body) {
            for (const attr of ['data-e2e-vid', 'data-e2e-aweme-id', 'data-aweme-id', 'aweme-id']) {
              const val = curr.getAttribute && curr.getAttribute(attr);
              if (val && /^\d+$/.test(val)) {
                awemeId = val;
                break;
              }
            }
            if (awemeId) break;
            const a = curr.querySelector && curr.querySelector('a[href*="/video/"], a[href*="modal_id="], a[href*="aweme_id="]');
            if (a && a.href) {
              const m = a.href.match(/\/video\/(\d+)/) || a.href.match(/modal_id=(\d+)/) || a.href.match(/aweme_id=(\d+)/);
              if (m && m[1]) {
                awemeId = m[1];
                break;
              }
            }
            curr = curr.parentElement;
          }
        }

        if (!awemeId && activeCard && window.__VEXA_FEED_MAP__) {
          const descEl = activeCard.querySelector('[data-e2e="video-desc"], .title, h1');
          const descText = descEl ? descEl.textContent.trim() : '';
          if (descText) {
            for (const [id, item] of Object.entries(window.__VEXA_FEED_MAP__)) {
              if (item.title && (descText.includes(item.title) || item.title.includes(descText))) {
                awemeId = id;
                break;
              }
            }
          }
        }

        if (awemeId) {
          const videoUrl = window.location.origin + '/video/' + awemeId;
          document.cookie = '__vexa_url=' + encodeURIComponent(videoUrl) + '; path=/; max-age=7200';
          if (window.__VEXA_FEED_MAP__ && window.__VEXA_FEED_MAP__[awemeId]) {
            const item = window.__VEXA_FEED_MAP__[awemeId];
            if (item.playUrl) {
              document.cookie = '__vexa_media_src=' + encodeURIComponent(item.playUrl) + '; path=/; max-age=7200';
            }
            if (item.title) {
              document.cookie = '__vexa_title=' + encodeURIComponent(item.title) + '; path=/; max-age=7200';
            }
          }
        }
        return; // Early return for feed media: never run generic HTML5 video sniffing that can grab prefetch buffers!
      }

      const domHeading = document.querySelector(
        'h1.video-title, .video-title, .player-title, .vod-title, .title-txt, [data-e2e="video-desc"], [data-player-hook="video-title"], .play-title, .v-panel-title, [class*="video-title"], [class*="video_title"], [class*="videoName"], [class*="albumName"], h1'
      );
      const hText = domHeading && domHeading.textContent ? domHeading.textContent.trim() : '';
      // Check active social video descriptions
      const activeDescEl = document.querySelector('[data-e2e="video-desc"], .account-card-desc, .video-info-title');
      const activeDesc = activeDescEl && activeDescEl.textContent ? activeDescEl.textContent.trim() : '';

      const docTitle = document.title ? document.title.trim() : '';
      const combined = [activeDesc, hText, docTitle, lastClickedTitle].filter(Boolean).join(' ||| ');
      if (combined) {
        document.cookie = '__vexa_title=' + encodeURIComponent(combined.slice(0, 300)) + '; path=/; max-age=7200';
      }

      // Sniff active HTML5 video tag currentSrc or src (prioritize currently playing or visible)
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

  // Helper to test if a URL is a custom app deep link scheme
  const isDisallowedScheme = function(u) {
    if (!u || typeof u !== 'string') return false;
    const trimmed = u.trim().toLowerCase();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('about:') || trimmed.startsWith('data:') || trimmed.startsWith('#')) return false;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return false;
    return true;
  };

  // Keep target="_blank" and window.open links inside the embedded official webview & block scheme jumps
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

  // Block hidden iframe deep links
  try {
    const origSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {
      if (this.tagName === 'IFRAME' && typeof name === 'string' && name.toLowerCase() === 'src' && isDisallowedScheme(val)) {
        return;
      }
      return origSetAttribute.call(this, name, val);
    };
  } catch(_) {}

  // Universal protocol guard: intercept programmatic navigation attempts to non-web schemes
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

  // Automatically dismiss / auto-confirm "继续使用浏览器" and hide app drawers
  const dismissAppPopups = function() {
    try {
      // 1. Auto click "继续使用浏览器", "留在网页", "网页播放", "取消"
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

      // 2. Hide any fixed/sticky bottom container promoting APP downloads
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

  // Hide intrusive ad banners & persistent app open floating bars on video sites
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
      /* Generic mobile app download, callout & promo drawers */
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

  // Auto-skip pre-roll video ads if present & keep page meta synced & dismiss popups
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

fn set_cached_url(u: &str) {
    if !u.is_empty() && (u.starts_with("http://") || u.starts_with("https://")) {
        if let Ok(mut g) = LAST_WEBVIEW_URL.lock() {
            *g = u.to_string();
        }
    }
}

fn set_cached_title(t: &str) {
    if !t.trim().is_empty() {
        if let Ok(mut g) = LAST_WEBVIEW_TITLE.lock() {
            *g = t.trim().to_string();
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

/// Syncs cookies from the embedded official website Webview to Vexa's local extractor/downloader cookie store.
/// IMPORTANT: Must only be called from a background thread (never from main-thread WKNavigationDelegate callbacks).
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn sync_webview_cookies(app: &AppHandle) {
    let Some(wv) = get_active_child_webview(app) else {
        return;
    };
    let url_str = get_cached_url();
    let Ok(parsed_url) = tauri::Url::parse(&url_str) else {
        return;
    };
    let (platform, domain) = detect_platform_from_url(&url_str);

    if let Ok(cookies) = wv.cookies_for_url(parsed_url) {
        if !cookies.is_empty() {
            let mut pairs: Vec<String> = Vec::new();
            for c in &cookies {
                let name = c.name();
                let val = c.value();
                if name == "__vexa_title" {
                    if let Ok(decoded) = urlencoding::decode(val) {
                        set_cached_title(&decoded);
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

/// Computes exact logical bounds inside the window's content NSView.
/// On macOS, `window.inner_size()` (`ns_view.frame().size.height`, e.g. 760) includes the native titlebar
/// height (e.g. 32pt), whereas the main Webview's CSS viewport (`y + height`, e.g. 56 + 672 = 728) sits
/// below the titlebar. Since `DiscoverView` extends to the bottom of the window (`origin.y = 0` in AppKit),
/// its `wry` top-down Y coordinate inside `ns_view` is `win_h - ch` (e.g. 760 - 672 = 88 = 56 + 32).
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

            // When in desktop workbench mode (cx >= 100):
            // Exactly preserves the original desktop anchoring logic
            if cx >= 100.0 {
                let aligned_w = (win_w - cx).max(cw).max(10.0).round();
                let aligned_y = (win_h - ch).max(y.round());
                return (cx, aligned_y, aligned_w, ch);
            }

            // When in mobile mode (cx < 100):
            // On macOS, the window frame origin (0, 0) is at the top of the window frame,
            // which includes the 28px native titlebar. In the DOM, getBoundingClientRect().top
            // is measured relative to the webview document, which sits below the native titlebar.
            // Therefore, we must add the titlebar height offset so that the child webview's top
            // starts flush below the search & pill header instead of cutting into the pills.
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

    if let Some(wv) = get_active_child_webview(app) {
        let current_mode_is_mobile = CURRENT_WEBVIEW_IS_MOBILE.load(std::sync::atomic::Ordering::Relaxed);
        if current_mode_is_mobile != is_mobile {
            // Mode switched between mobile and desktop!
            // Close existing webview so that a new one is created with the matching User-Agent.
            let _ = wv.close();
            if let Ok(mut label_guard) = CURRENT_WEBVIEW_LABEL.lock() {
                label_guard.clear();
            }
        } else {
            if !visible || cw <= 10.0 || ch <= 10.0 {
                let _ = wv.eval(
                    "document.querySelectorAll('video, audio').forEach(el => { try { el.pause(); } catch(_){} });",
                );
                let _ = wv.hide();
                return Ok(get_cached_url());
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
                    if let Ok(parsed) = trimmed.parse::<tauri::Url>() {
                        let current_str = get_cached_url();
                        if current_str != trimmed {
                            set_cached_url(trimmed);
                            let _ = wv.navigate(parsed);
                        }
                    }
                }
            }

            return Ok(get_cached_url());
        }
    }

    if !visible || cw <= 10.0 || ch <= 10.0 {
        return Ok(String::new());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let initial_url_str = url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "about:blank".to_string());
    let trimmed_initial = initial_url_str.trim().to_string();
    set_cached_url(&trimmed_initial);
    let parsed_url = tauri::Url::parse(&trimmed_initial).map_err(|e| e.to_string())?;

    let gen = WEBVIEW_GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let label = format!("platform-webview-{}", gen);

    let app_handle_nav = app.clone();
    let app_handle_load = app.clone();
    let app_handle_new_win = app.clone();

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed_url))
        .user_agent(target_ua)
        .initialization_script(WEBVIEW_BRIDGE_SCRIPT)
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
        if let Ok(live) = wv.url() {
            let s = live.to_string();
            if !s.is_empty() {
                set_cached_url(&s);
            }
        }
        sync_webview_cookies(app);
    }
    Ok(get_cached_url())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn get_platform_webview_url(_app: &AppHandle) -> Result<String, String> {
    Ok(get_cached_url())
}
