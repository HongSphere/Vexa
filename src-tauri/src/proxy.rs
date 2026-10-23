use axum::{
    body::Body,
    extract::Query,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::OnceLock;

pub static PROXY_PORT: AtomicU16 = AtomicU16::new(19527);
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn shared_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .local_address(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
            .danger_accept_invalid_certs(true)
            .connect_timeout(std::time::Duration::from_secs(6))
            .pool_max_idle_per_host(16)
            .build()
            .expect("Failed to initialize proxy HTTP client")
    })
}

#[derive(Deserialize)]
pub struct StreamQuery {
    pub url: String,
    pub headers: Option<String>,
    pub media_type: Option<String>,
}

#[derive(Deserialize)]
pub struct WebQuery {
    pub url: String,
}

pub async fn start_local_stream_proxy() -> u16 {
    let app = Router::new()
        .route("/stream", get(proxy_stream_handler))
        .route("/m3u8", get(proxy_m3u8_handler))
        .route("/web", get(proxy_web_handler));

    let listener = match tokio::net::TcpListener::bind("127.0.0.1:19527").await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("Failed to bind local stream proxy"),
    };

    let port = listener
        .local_addr()
        .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], 19527)))
        .port();
    PROXY_PORT.store(port, Ordering::Relaxed);

    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    port
}

async fn proxy_stream_handler(
    Query(query): Query<StreamQuery>,
    req_headers: HeaderMap,
) -> impl IntoResponse {
    let client = shared_client();

    let mut merged_headers: HashMap<String, String> = HashMap::new();
    merged_headers.insert(
        "User-Agent".to_string(),
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36".to_string(),
    );

    if let Ok(parsed) = reqwest::Url::parse(&query.url) {
        if let Some(host) = parsed.host_str() {
            let parts: Vec<&str> = host.split('.').collect();
            let base_domain = if parts.len() >= 2 {
                format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
            } else {
                host.to_string()
            };
            merged_headers.insert("Referer".to_string(), format!("{}://www.{}/", parsed.scheme(), base_domain));
            merged_headers.insert("Origin".to_string(), format!("{}://www.{}", parsed.scheme(), base_domain));
        }
    }

    if let Some(ref h_json) = query.headers {
        if let Ok(custom_map) = serde_json::from_str::<HashMap<String, String>>(h_json) {
            for (k, v) in custom_map {
                merged_headers.insert(k, v);
            }
        }
    }

    let mut req = client.get(&query.url);
    for (k, v) in merged_headers {
        req = req.header(k, v);
    }

    if let Some(range_val) = req_headers.get(header::RANGE) {
        if let Ok(r_str) = range_val.to_str() {
            req = req.header("Range", r_str);
        }
    }

    match req.send().await {
        Ok(upstream) => {
            let status =
                StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::OK);
            let mut resp_builder = Response::builder()
                .status(status)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Headers", "*")
                .header(
                    "Access-Control-Expose-Headers",
                    "Content-Length, Content-Range, Accept-Ranges",
                );

            let upstream_ct = upstream
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_lowercase();

            let is_audio = query.media_type.as_deref() == Some("audio")
                || query.url.contains("-30280.")
                || query.url.contains("-30232.")
                || query.url.contains("-30216.");

            let final_content_type = if upstream_ct.is_empty()
                || upstream_ct.contains("octet-stream")
                || upstream_ct.contains("iso.segment")
            {
                if is_audio {
                    "audio/mp4".to_string()
                } else {
                    "video/mp4".to_string()
                }
            } else {
                upstream_ct
            };

            resp_builder = resp_builder.header(header::CONTENT_TYPE, final_content_type);

            for key in [
                header::CONTENT_LENGTH,
                header::CONTENT_RANGE,
                header::ACCEPT_RANGES,
            ] {
                if let Some(val) = upstream.headers().get(&key) {
                    resp_builder = resp_builder.header(key, val);
                }
            }

            if upstream.headers().get(header::ACCEPT_RANGES).is_none() {
                resp_builder = resp_builder.header(header::ACCEPT_RANGES, "bytes");
            }

            let stream = upstream.bytes_stream();
            let body = Body::from_stream(stream);
            resp_builder.body(body).unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Stream error").into_response()
            })
        }
        Err(e) => (StatusCode::BAD_GATEWAY, format!("Upstream error: {}", e)).into_response(),
    }
}

fn is_ad_segment_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("/ad/")
        || lower.contains("adv.ts")
        || lower.contains("guanggao")
        || lower.contains("union-")
        || lower.contains("adjump")
        || lower.contains("p2p_ad")
        || lower.contains("_ad.ts")
        || lower.contains("-ad.ts")
        || lower.contains("ad.mp4")
}

async fn proxy_m3u8_handler(Query(query): Query<StreamQuery>) -> impl IntoResponse {
    let client = shared_client();

    let mut req = client
        .get(&query.url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        );
    if let Ok(parsed) = reqwest::Url::parse(&query.url) {
        if let Some(host) = parsed.host_str() {
            let parts: Vec<&str> = host.split('.').collect();
            let base_domain = if parts.len() >= 2 {
                format!("{}.{}", parts[parts.len() - 2], parts[parts.len() - 1])
            } else {
                host.to_string()
            };
            req = req.header("Referer", format!("{}://www.{}/", parsed.scheme(), base_domain));
        }
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    };

    let content = match resp.text().await {
        Ok(t) => t,
        Err(e) => return (StatusCode::BAD_GATEWAY, e.to_string()).into_response(),
    };

    let port = PROXY_PORT.load(Ordering::Relaxed);
    let base_url = query
        .url
        .rfind('/')
        .map(|idx| &query.url[..=idx])
        .unwrap_or("");
    let origin = if let Ok(u) = reqwest::Url::parse(&query.url) {
        let port_str = u.port().map(|p| format!(":{}", p)).unwrap_or_default();
        format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or(""), port_str)
    } else {
        String::new()
    };
    let headers_encoded = urlencoding::encode(query.headers.as_deref().unwrap_or("{}"));

    let key_re = match regex::Regex::new(r#"URI="([^"]+)""#) {
        Ok(r) => Some(r),
        Err(_) => None,
    };

    let mut out_lines = Vec::new();
    let mut pending_extinf: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "#EXT-X-DISCONTINUITY" {
            continue;
        }

        if trimmed.starts_with("#EXTINF:") {
            pending_extinf = Some(line.to_string());
            continue;
        }

        // Rewrite AES-128 / MAP keys and init segments so encrypted HLS streams decrypt smoothly
        if (trimmed.starts_with("#EXT-X-KEY:") || trimmed.starts_with("#EXT-X-MAP:")) && key_re.is_some() {
            if let Some(extinf) = pending_extinf.take() {
                out_lines.push(extinf);
            }
            let re = key_re.as_ref().unwrap();
            if let Some(caps) = re.captures(trimmed) {
                let raw_uri = &caps[1];
                let abs_key = if raw_uri.starts_with("http://") || raw_uri.starts_with("https://") {
                    raw_uri.to_string()
                } else if raw_uri.starts_with('/') {
                    format!("{}{}", origin, raw_uri)
                } else {
                    format!("{}{}", base_url, raw_uri)
                };
                let proxied_key = format!(
                    "http://127.0.0.1:{}/stream?url={}&headers={}",
                    port,
                    urlencoding::encode(&abs_key),
                    headers_encoded
                );
                let rewritten_tag = re.replace(trimmed, format!(r#"URI="{}""#, proxied_key)).to_string();
                out_lines.push(rewritten_tag);
                continue;
            }
        }

        if trimmed.is_empty() || trimmed.starts_with('#') {
            if let Some(extinf) = pending_extinf.take() {
                out_lines.push(extinf);
            }
            out_lines.push(line.to_string());
        } else {
            // This is a media segment URL
            if is_ad_segment_url(trimmed) {
                // Drop this ad segment and its pending #EXTINF
                pending_extinf = None;
                continue;
            }

            if let Some(extinf) = pending_extinf.take() {
                out_lines.push(extinf);
            }

            let abs_url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                trimmed.to_string()
            } else if trimmed.starts_with('/') {
                format!("{}{}", origin, trimmed)
            } else {
                format!("{}{}", base_url, trimmed)
            };
            let is_sub_m3u8 = abs_url.contains(".m3u8");
            let route = if is_sub_m3u8 { "m3u8" } else { "stream" };
            let proxied = format!(
                "http://127.0.0.1:{}/{}?url={}&headers={}",
                port,
                route,
                urlencoding::encode(&abs_url),
                headers_encoded
            );
            out_lines.push(proxied);
        }
    }

    if let Some(extinf) = pending_extinf {
        out_lines.push(extinf);
    }

    let rewritten = out_lines.join("\n");
    Response::builder()
        .status(StatusCode::OK)
        .header("Access-Control-Allow-Origin", "*")
        .header("Content-Type", "application/vnd.apple.mpegurl")
        .body(Body::from(rewritten))
        .unwrap()
}

async fn proxy_web_handler(
    Query(query): Query<WebQuery>,
) -> impl IntoResponse {
    let raw_url = query.url.trim();
    if !raw_url.starts_with("http://") && !raw_url.starts_with("https://") {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Invalid web URL".to_string(),
        )
            .into_response();
    }

    let port = PROXY_PORT.load(Ordering::Relaxed);
    // Prevent self-referential infinite proxy loops
    if raw_url.contains(&format!("127.0.0.1:{}/web", port))
        || raw_url.contains(&format!("localhost:{}/web", port))
    {
        return (
            StatusCode::BAD_REQUEST,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            "Recursive proxy loop prevented".to_string(),
        )
            .into_response();
    }

    let client = shared_client();
    let mobile_ua =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

    let resp = match client
        .get(raw_url)
        .header("User-Agent", mobile_ua)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                format!("Failed to load page: {}", e),
            )
                .into_response();
        }
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
    let final_url = resp.url().to_string();
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/html; charset=utf-8")
        .to_string();

    let html_bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                format!("Failed to read page body: {}", e),
            )
                .into_response();
        }
    };

    if !content_type.contains("text/html") {
        return Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, content_type)
            .header("Access-Control-Allow-Origin", "*")
            .body(Body::from(html_bytes))
            .unwrap_or_else(|_| Response::new(Body::empty()))
            .into_response();
    }

    let html_str = String::from_utf8_lossy(&html_bytes).to_string();
    let port = PROXY_PORT.load(Ordering::Relaxed);

    let injection = format!(
        r#"
<base href="{final_url}">
<style>
/* 通用移动端应用引导跳转与悬浮弹窗屏蔽（中立通用规则） */
[class*="open-app"], [class*="openApp"], [class*="open_app"],
[class*="download-app"], [class*="downloadApp"], [class*="download_app"],
[class*="launch-app"], [class*="launchApp"],
[class*="callup"], [class*="call-app"],
[id*="open-app"], [id*="openApp"], [id*="download-app"],
[data-e2e*="open-app"], [data-act*="open-app"],
a[href*="itms-apps:"], a[href*="market:"], a[href*="intent:"] {{
  display: none !important;
  pointer-events: none !important;
  visibility: hidden !important;
}}
</style>
<script>
(function() {{
  if (window.__VEXA_MOBILE_SHIELD__) return;
  window.__VEXA_MOBILE_SHIELD__ = true;

  var currentTargetUrl = "{final_url}";
  function notifyParentUrl(u) {{
    if (!u) return;
    try {{
      if (window.parent && window.parent !== window) {{
        window.parent.postMessage({{ type: 'VEXA_NAV_URL', url: u }}, '*');
      }}
    }} catch(e) {{}}
  }}

  notifyParentUrl(currentTargetUrl);

  var origPushState = history.pushState;
  if (origPushState) {{
    history.pushState = function() {{
      origPushState.apply(this, arguments);
      setTimeout(function() {{ notifyParentUrl(window.location.href); }}, 100);
    }};
  }}
  var origReplaceState = history.replaceState;
  if (origReplaceState) {{
    history.replaceState = function() {{
      origReplaceState.apply(this, arguments);
      setTimeout(function() {{ notifyParentUrl(window.location.href); }}, 100);
    }};
  }}
  window.addEventListener('popstate', function() {{
    notifyParentUrl(window.location.href);
  }});
  window.addEventListener('hashchange', function() {{
    notifyParentUrl(window.location.href);
  }});

  function isDisallowedScheme(u) {{
    if (!u || typeof u !== 'string') return false;
    var trimmed = u.trim().toLowerCase();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('about:') || trimmed.startsWith('data:') || trimmed.startsWith('#')) return false;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return false;
    return true;
  }}

  window.open = function(url) {{
    if (isDisallowedScheme(url)) return null;
    if (url && typeof url === 'string' && !url.startsWith('javascript:')) {{
      window.location.href = "http://127.0.0.1:{port}/web?url=" + encodeURIComponent(url);
    }}
    return window;
  }};

  document.addEventListener('click', function(e) {{
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (a) {{
      var rawHref = a.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) {{
        return;
      }}
      if (isDisallowedScheme(a.href || rawHref)) {{
        e.preventDefault();
        e.stopPropagation();
        return;
      }}
      var targetUrl = a.href;
      if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {{
        if (!targetUrl.includes('/web?url=')) {{
          e.preventDefault();
          e.stopPropagation();
          notifyParentUrl(targetUrl);
          window.location.href = "http://127.0.0.1:{port}/web?url=" + encodeURIComponent(targetUrl);
        }}
      }}
    }}
  }}, true);
}})();
</script>
"#
    );

    let final_html = if html_str.contains("<head>") {
        html_str.replacen("<head>", &format!("<head>{}", injection), 1)
    } else if html_str.contains("<html>") {
        html_str.replacen("<html>", &format!("<html><head>{}</head>", injection), 1)
    } else {
        format!("{}{}", injection, html_str)
    };

    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .body(Body::from(final_html))
        .unwrap_or_else(|_| Response::new(Body::empty()))
        .into_response()
}
