use axum::{
    body::Body,
    extract::Query,
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::OnceLock;
use std::sync::RwLock;

pub static PROXY_PORT: AtomicU16 = AtomicU16::new(19527);
static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static ACTIVE_UPSTREAM_ORIGIN: OnceLock<RwLock<String>> = OnceLock::new();
static ACTIVE_ASSET_BASE: OnceLock<RwLock<String>> = OnceLock::new();

fn active_upstream_lock() -> &'static RwLock<String> {
    ACTIVE_UPSTREAM_ORIGIN.get_or_init(|| RwLock::new(String::new()))
}

fn active_asset_base_lock() -> &'static RwLock<String> {
    ACTIVE_ASSET_BASE.get_or_init(|| RwLock::new(String::new()))
}

pub fn set_active_upstream(url: &str) {
    if let Ok(parsed) = reqwest::Url::parse(url) {
        if let Some(host) = parsed.host_str() {
            let origin = format!("{}://{}", parsed.scheme(), host);
            if let Ok(mut lock) = active_upstream_lock().write() {
                *lock = origin;
            }
        }
    }
}

pub fn get_active_upstream() -> String {
    if let Ok(lock) = active_upstream_lock().read() {
        return lock.clone();
    }
    String::new()
}

pub fn set_active_asset_base(base: &str) {
    if let Ok(mut lock) = active_asset_base_lock().write() {
        *lock = base.to_string();
    }
}

pub fn get_active_asset_base() -> String {
    if let Ok(lock) = active_asset_base_lock().read() {
        return lock.clone();
    }
    String::new()
}

fn shared_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .cookie_store(true)
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
    pub ua: Option<String>,
    pub mode: Option<String>,
    pub shield: Option<bool>,
    pub block: Option<String>,
}

#[derive(Deserialize)]
pub struct ApiProxyQuery {
    pub url: String,
}

pub async fn start_local_stream_proxy() -> u16 {
    let app = Router::new()
        .route("/stream", get(proxy_stream_handler))
        .route("/m3u8", get(proxy_m3u8_handler))
        .route("/web", get(proxy_web_handler))
        .route("/api_proxy", axum::routing::any(proxy_api_handler))
        .fallback(proxy_fallback_handler);

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

async fn proxy_fallback_handler(
    uri: Uri,
    method: Method,
    req_headers: HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    let upstream = get_active_upstream();
    if upstream.is_empty() {
        return (StatusCode::NOT_FOUND, "Not found").into_response();
    }

    let p_and_q = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("");
    let asset_base = get_active_asset_base();
    let full_url = if uri.path().starts_with("/assets/") && !asset_base.is_empty() {
        format!("{}{}", asset_base, p_and_q)
    } else {
        format!("{}{}", upstream, p_and_q)
    };
    let client = shared_client();

    let mut req = client.request(method, &full_url);
    if let Ok(parsed) = reqwest::Url::parse(&full_url) {
        if let Some(host) = parsed.host_str() {
            req = req.header("Referer", format!("{}://{}/", parsed.scheme(), host));
            req = req.header("Origin", format!("{}://{}", parsed.scheme(), host));
        }
    }

    if let Some(ct) = req_headers.get(header::CONTENT_TYPE) {
        req = req.header(header::CONTENT_TYPE, ct);
    }
    if let Some(c) = req_headers.get(header::COOKIE) {
        req = req.header(header::COOKIE, c);
    }
    if let Some(ua) = req_headers.get(header::USER_AGENT) {
        req = req.header(header::USER_AGENT, ua);
    }

    if !body.is_empty() {
        req = req.body(body);
    }

    match req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let content_type = resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();

            let bytes = resp.bytes().await.unwrap_or_default();
            Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, content_type)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Headers", "*")
                .header("Access-Control-Allow-Methods", "*")
                .body(Body::from(bytes))
                .unwrap_or_else(|_| Response::new(Body::empty()))
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            format!("Fallback proxy error: {}", e),
        )
            .into_response(),
    }
}

async fn proxy_api_handler(
    query: Option<Query<ApiProxyQuery>>,
    method: Method,
    req_headers: HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    if method == Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Headers", "*")
            .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            .header("Access-Control-Max-Age", "86400")
            .body(Body::empty())
            .unwrap_or_else(|_| Response::new(Body::empty()))
            .into_response();
    }

    let target_url = match query {
        Some(Query(q)) => {
            let u = q.url.trim();
            if u.starts_with("//") {
                format!("https:{}", u)
            } else {
                u.to_string()
            }
        }
        None => String::new(),
    };

    if !target_url.starts_with("http://") && !target_url.starts_with("https://") {
        return (StatusCode::BAD_REQUEST, "Invalid target API URL").into_response();
    }

    let client = shared_client();
    let mut req = client.request(method, &target_url);

    if let Ok(parsed) = reqwest::Url::parse(&target_url) {
        let upstream = get_active_upstream();
        if !upstream.is_empty() {
            req = req.header("Origin", &upstream);
            req = req.header("Referer", format!("{}/", upstream.trim_end_matches('/')));
        } else if let Some(host) = parsed.host_str() {
            req = req.header("Origin", format!("{}://{}", parsed.scheme(), host));
            req = req.header("Referer", format!("{}://{}/", parsed.scheme(), host));
        }
    }

    if let Some(ct) = req_headers.get(header::CONTENT_TYPE) {
        req = req.header(header::CONTENT_TYPE, ct);
    }
    if let Some(accept) = req_headers.get(header::ACCEPT) {
        req = req.header(header::ACCEPT, accept);
    }
    if let Some(cookie) = req_headers.get(header::COOKIE) {
        req = req.header(header::COOKIE, cookie);
    }
    if let Some(ua) = req_headers.get(header::USER_AGENT) {
        req = req.header(header::USER_AGENT, ua);
    }

    if !body.is_empty() {
        req = req.body(body);
    }

    match req.send().await {
        Ok(resp) => {
            let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
            let content_type = resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json; charset=utf-8")
                .to_string();

            let bytes = resp.bytes().await.unwrap_or_default();
            Response::builder()
                .status(status)
                .header(header::CONTENT_TYPE, content_type)
                .header("Access-Control-Allow-Origin", "*")
                .header("Access-Control-Allow-Headers", "*")
                .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
                .body(Body::from(bytes))
                .unwrap_or_else(|_| Response::new(Body::empty()))
                .into_response()
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            [(header::CONTENT_TYPE, "application/json")],
            format!(r#"{{"ret":-1,"msg":"API proxy error: {}"}}"#, e),
        )
            .into_response(),
    }
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
    req_headers: HeaderMap,
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
    let is_desktop_ua = query.ua.as_deref() == Some("desktop")
        || query.mode.as_deref() == Some("pc_spoof");

    let upstream_ua = if is_desktop_ua {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    } else {
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    };

    let mut req = client
        .get(raw_url)
        .header("User-Agent", upstream_ua)
        .header(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");

    if let Ok(parsed) = reqwest::Url::parse(raw_url) {
        if let Some(host) = parsed.host_str() {
            req = req.header("Referer", format!("{}://{}/", parsed.scheme(), host));
            req = req.header("Origin", format!("{}://{}", parsed.scheme(), host));
        }
    }

    if let Some(cookie_val) = req_headers.get(header::COOKIE) {
        if let Ok(c_str) = cookie_val.to_str() {
            req = req.header(header::COOKIE, c_str);
        }
    }

    let resp = match req.send().await {
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
    set_active_upstream(&final_url);
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/html; charset=utf-8")
        .to_string();
    let upstream_headers = resp.headers().clone();

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
        let resp_builder = Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, content_type)
            .header("Access-Control-Allow-Origin", "*");
        return resp_builder
            .body(Body::from(html_bytes))
            .unwrap_or_else(|_| Response::new(Body::empty()))
            .into_response();
    }

    let html_str = String::from_utf8_lossy(&html_bytes).to_string();
    let port = PROXY_PORT.load(Ordering::Relaxed);

    let target_path_and_query = match reqwest::Url::parse(&final_url) {
        Ok(u) => {
            let p = u.path();
            let pq = match u.query() {
                Some(q) => format!("{}?{}", p, q),
                None => p.to_string(),
            };
            if pq.is_empty() { "/".to_string() } else { pq }
        }
        Err(_) => "/".to_string(),
    };

    // Strip any upstream referrer meta so our no-referrer policy takes full effect
    let clean_html = if let Ok(re) = regex::Regex::new(r#"(?i)<meta[^>]*name=["']referrer["'][^>]*>"#) {
        re.replace_all(&html_str, "").to_string()
    } else {
        html_str
    };

    // Rewrite protocol-relative URLs (//...) and insecure image endpoints to HTTPS
    let clean_html = clean_html
        .replace("=\"//", "=\"https://")
        .replace("='//", "='https://")
        .replace("src=\"//", "src=\"https://")
        .replace("href=\"//", "href=\"https://")
        .replace("data-src=\"//", "data-src=\"https://")
        .replace("data-original=\"//", "data-original=\"https://")
        .replace("data-lazy-src=\"//", "data-lazy-src=\"https://")
        .replace("poster=\"//", "poster=\"https://")
        .replace("url(//", "url(https://")
        .replace("url('//", "url('https://")
        .replace("url(\"//", "url(\"https://")
        .replace("\"//", "\"https://")
        .replace("'//", "'https://");

    // Generic auto-discovery of asset CDN base path from HTML script/link tags
    if let Ok(re) = regex::Regex::new(r#"(?:src|href)=['"](https?://[^'"\s]+?)/assets/"#) {
        if let Some(caps) = re.captures(&clean_html) {
            if let Some(m) = caps.get(1) {
                set_active_asset_base(m.as_str());
            }
        }
    }

    let clean_html = clean_html
        .replace(r#"http:\/\/"#, r#"https:\/\/"#)
        .replace(r#"http:\\/\\/"#, r#"https:\\/\\/"#)
        .replace(r#"http:\u002F\u002F"#, r#"https:\u002F\u002F"#);

    let clean_html = clean_html
        .replace("https://https://", "https://")
        .replace("https:https://", "https://")
        .replace("https://https//", "https://");

    let clean_html = if let Ok(re) = regex::Regex::new(r#"http://([^"'\s<>]+\.(?:jpg|jpeg|png|webp|gif|avif))"#) {
        re.replace_all(&clean_html, "https://$1").to_string()
    } else {
        clean_html
    };

    // Neutralize any scripts that redirect http: to https: or desktop redirects
    let clean_html = clean_html
        .replace(r#"0===window.location.href.indexOf("http:")"#, "false")
        .replace(r#"0 === window.location.href.indexOf("http:")"#, "false")
        .replace(r#"0===location.href.indexOf("http:")"#, "false")
        .replace(r#"0 === location.href.indexOf("http:")"#, "false")
        .replace(r#"window.location.href=s"#, "/* no-redirect */ false")
        .replace(r#"window.location.href.replace("http:","https:")"#, r#"/* no-ssl */ window.location.href"#)
        .replace(r#"location.href.replace("http:","https:")"#, r#"/* no-ssl */ location.href"#)
        .replace(r#"window.location.href.replace('http:','https:')"#, r#"/* no-ssl */ window.location.href"#)
        .replace(r#"location.href.replace('http:','https:')"#, r#"/* no-ssl */ location.href"#);

    let mut clean_html = clean_html;
    let mut block_keywords: Vec<String> = Vec::new();
    if let Some(ref block_param) = query.block {
        for pattern in block_param.split(',') {
            let p = pattern.trim().to_lowercase();
            if !p.is_empty() {
                block_keywords.push(p.clone());
                let regex_str = format!(r#"(?i)<script[^>]*src=["'][^"']*{}["'][^>]*>\s*</script>"#, regex::escape(&p));
                if let Ok(re) = regex::Regex::new(&regex_str) {
                    clean_html = re.replace_all(&clean_html, "").to_string();
                }
            }
        }
    }

    if let Ok(re) = regex::Regex::new(r#"(?i)<script[^>]*src=["'][^"']*(?:/o\.js|adbyunion|union[-_]ad|popunder|pagead|trafficmanager)[^"']*["'][^>]*>\s*</script>"#) {
        clean_html = re.replace_all(&clean_html, "").to_string();
    }

    if let Ok(re) = regex::Regex::new(r#"(?is)<script[^>]*>(?:(?!</script>).)*?(?:adbyunion|1607593455|trafficmanager|cJump|autoJump|touchJump)(?:(?!</script>).)*?</script>"#) {
        clean_html = re.replace_all(&clean_html, "").to_string();
    }

    if let Ok(re) = regex::Regex::new(r#"(?is)<ins[^>]*>.*?</ins>|<ins[^>]*/>"#) {
        clean_html = re.replace_all(&clean_html, "").to_string();
    }

    if let Ok(re) = regex::Regex::new(r#"(?is)<div[^>]*id=["']show-[^"']*["'][^>]*>.*?</div>"#) {
        clean_html = re.replace_all(&clean_html, "").to_string();
    }

    if let Ok(re) = regex::Regex::new(r#"(?i)(<iframe[^>]*\ssrc=["'])(https?://[^"']+)(["'])"#) {
        clean_html = re.replace_all(&clean_html, |caps: &regex::Captures| {
            let prefix = &caps[1];
            let raw_src = &caps[2];
            let suffix = &caps[3];
            if raw_src.contains("127.0.0.1") || raw_src.contains("localhost") {
                format!("{}{}{}", prefix, raw_src, suffix)
            } else {
                let proxied = format!(
                    "http://127.0.0.1:{}/web?url={}&ua={}&shield=true",
                    port,
                    urlencoding::encode(raw_src),
                    urlencoding::encode(if is_desktop_ua { "desktop" } else { "mobile" })
                );
                format!("{}{}{}", prefix, proxied, suffix)
            }
        }).to_string();
    }

    let block_keywords_json = serde_json::to_string(&block_keywords).unwrap_or_else(|_| "[]".to_string());

    let injection = format!(
        r#"
<meta name="referrer" content="no-referrer">
<style>
/* 通用移动端应用引导跳转与悬浮弹窗屏蔽（中立通用规则） */
.callEnd_box,
.callEnd_fixed_box,
.callEnd_title,
.callEnd_content,
.callGuide_box,
.callGuide_button,
[class*="callEnd"], [class*="call-end"], [class*="call_end"],
[class*="callGuide"], [class*="call-guide"], [class*="call_guide"],
[class*="h5-detail-guide"], [class*="detail-guide"],
[class*="PopCallApp"], [class*="popCallApp"],
[class*="bottomCallApp"], [class*="bottom-call-app"],
[class*="headerCallApp"],
.OpenAppPendant_btn__CrVc7,
.ReactModalPortal,
[class*="SecretDialog"],
[class*="secretDialog"],
[class*="secret-dialog"],
[class*="privacy-dialog"],
[class*="PrivacyDialog"],
[class*="LaunchButton"],
[class*="launchWrapper"],
[class*="OpenApp"],
[class*="openApp"],
[class*="open_app"],
[class*="Pendant"],
[class*="download-app"], [class*="downloadApp"], [class*="download_app"],
[class*="launch-app"], [class*="launchApp"],
[class*="callup"], [class*="call-app"], [class*="callUp"], [class*="call_up"],
[class*="openbox"], [class*="open-box"], [class*="openBox"],
[class*="app-banner"], [class*="appBanner"], [class*="app_banner"],
[class*="download-bar"], [class*="downloadBar"], [class*="download_bar"],
[class*="guide-banner"], [class*="guideBanner"],
[class*="app-prompt"], [class*="appPrompt"],
[class*="wake-up"], [class*="wakeup"], [class*="wakeUp"],
[class*="h5-download"], [class*="h5-app"],
[class*="m-open-app"], [class*="m_open_app"],
[class*="open-client"], [class*="openClient"],
[class*="open-in-app"], [class*="openInApp"],
[id*="open-app"], [id*="openApp"], [id*="download-app"], [id*="app-banner"], [id*="callup"],
[data-e2e*="open-app"], [data-act*="open-app"],
ins,
[id^="show-"],
[class*="webInterstitial"],
[class*="web-interstitial"],
[class*="adbyunion"],
[class*="union-ad"],
[id*="adbyunion"],
div[style*="2147483647"],
div[style*="214748364"],
div[style*="z-index: 214748364"],
div[style*="z-index:214748364"],
div[style*="z-index: 9999999"],
div[style*="z-index:9999999"],
a[href*="itms-apps:"], a[href*="market:"], a[href*="intent:"] {{
  display: none !important;
  pointer-events: none !important;
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  width: 0 !important;
  max-width: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  clip: rect(0, 0, 0, 0) !important;
}}
</style>
<script>
(function() {{
  if (window.__VEXA_MOBILE_SHIELD__) return;
  window.__VEXA_MOBILE_SHIELD__ = true;

  try {{
    var isDesktopMode = {is_desktop_ua};
    if (isDesktopMode) {{
      var pcUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
      try {{
        Object.defineProperty(navigator, 'userAgent', {{ get: function() {{ return pcUA; }}, configurable: true }});
        Object.defineProperty(navigator, 'appVersion', {{ get: function() {{ return pcUA; }}, configurable: true }});
        Object.defineProperty(navigator, 'platform', {{ get: function() {{ return "Win32"; }}, configurable: true }});
      }} catch(e) {{}}
    }}

    try {{
      window.adbyunion = {{ push: function() {{}} }};
      Object.defineProperty(window, 'adbyunion', {{
        get: function() {{ return {{ push: function() {{}} }}; }},
        set: function() {{}},
        configurable: true
      }});
    }} catch(e) {{}}

    var blockedKeywords = {block_keywords_json};
    var isSuspiciousRedirect = function(u) {{
      if (!u) return false;
      var s = String(u).toLowerCase();
      if (s.startsWith('intent:') || s.startsWith('market:') || s.startsWith('itms-apps:')) return true;
      if (s.indexOf('cjump') !== -1 || s.indexOf('touchjump') !== -1 || s.indexOf('autojump') !== -1 || s.indexOf('tack=1') !== -1 || s.indexOf('adbyunion') !== -1) return true;
      for (var i = 0; i < blockedKeywords.length; i++) {{
        if (s.indexOf(blockedKeywords[i]) !== -1) return true;
      }}
      return false;
    }};

    var origAssign = window.location.assign;
    if (origAssign) {{
      window.location.assign = function(u) {{
        if (isSuspiciousRedirect(u)) {{ console.warn('[Vexa Shield] Blocked unprompted redirect:', u); return; }}
        return origAssign.apply(window.location, arguments);
      }};
    }}
    var origReplace = window.location.replace;
    if (origReplace) {{
      window.location.replace = function(u) {{
        if (isSuspiciousRedirect(u)) {{ console.warn('[Vexa Shield] Blocked unprompted replace:', u); return; }}
        return origReplace.apply(window.location, arguments);
      }};
    }}
  }} catch(e) {{}}

  try {{
    var purgeAdOverlays = function(root) {{
      var r = root || document;
      if (!r || !r.querySelectorAll) return;
      var targets = r.querySelectorAll('div, ins, a');
      for (var i = 0; i < targets.length; i++) {{
        var el = targets[i];
        if (el.tagName === 'INS' || (el.id && el.id.indexOf('show-') === 0)) {{
          el.remove();
          continue;
        }}
        var s = el.getAttribute('style') || '';
        if (s.indexOf('214748364') !== -1 || (el.style && parseInt(el.style.zIndex, 10) >= 2147483640)) {{
          if (!el.classList.contains('artplayer-app') && el.id !== 'loading') {{
            el.remove();
          }}
        }}
      }}
    }};
    var adObs = new MutationObserver(function() {{
      purgeAdOverlays(document);
    }});
    adObs.observe(document.documentElement || document.body, {{
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'id', 'class']
    }});
    window.addEventListener('DOMContentLoaded', function() {{ purgeAdOverlays(document); }});
    setInterval(function() {{ purgeAdOverlays(document); }}, 100);
  }} catch(e) {{}}

  // Universal mobile video callup shield to suppress native app jump prompts
  try {{
    window.noCallUp = true;
    Object.defineProperty(window, 'noCallUp', {{
      get: function() {{ return true; }},
      set: function() {{}},
      configurable: true
    }});
  }} catch(e) {{}}

  try {{
    var removeAppCallups = function(root) {{
      var r = root || document;
      if (!r || !r.querySelectorAll) return;
      var popups = r.querySelectorAll('.callEnd_box, .callGuide_box, [class*="callEnd"], [class*="callGuide"], [class*="h5-detail-guide"]');
      for (var i = 0; i < popups.length; i++) {{
        popups[i].remove();
      }}
    }};
    var callupObs = new MutationObserver(function() {{
      removeAppCallups(document);
    }});
    callupObs.observe(document.documentElement || document.body, {{ childList: true, subtree: true }});
    window.addEventListener('DOMContentLoaded', function() {{ removeAppCallups(document); }});
  }} catch(e) {{}}

  // Synchronize SPA router pathname so initial load matches upstream route instead of /web
  try {{
    var targetPath = "{target_path_and_query}";
    if (window.location.pathname.startsWith('/web') && targetPath) {{
      window.history.replaceState(window.history.state, '', targetPath);
    }}
  }} catch(e) {{}}

  var realParent = null;
  try {{
    realParent = window.parent;
  }} catch(e) {{}}

  // Mock window.top and window.parent so iframe-intolerant SDKs (like midas.js) believe they are top-level
  try {{
    Object.defineProperty(window, 'top', {{
      get: function() {{ return window; }},
      configurable: true
    }});
  }} catch(e) {{}}
  try {{
    Object.defineProperty(window, 'parent', {{
      get: function() {{ return window; }},
      configurable: true
    }});
  }} catch(e) {{}}

  // Stub document.domain setter to prevent SecurityError in sandboxed contexts
  try {{
    var origDomain = document.domain;
    Object.defineProperty(Document.prototype, 'domain', {{
      get: function() {{ return origDomain || (upstreamOrigin ? (new URL(upstreamOrigin)).hostname : window.location.hostname); }},
      set: function(val) {{ /* silently ignore without throwing SecurityError in sandbox */ }},
      configurable: true
    }});
  }} catch(e) {{}}

  // Neutralize service worker on local container origin to prevent 404 registration failures
  try {{
    if (navigator.serviceWorker) {{
      navigator.serviceWorker.register = function() {{
        return Promise.reject(new Error("ServiceWorker registration disabled in sandbox"));
      }};
    }}
  }} catch(e) {{}}

  // Safe image attribute observer to upgrade http to https and apply no-referrer without breaking prototype chain
  try {{
    var fixImg = function(img) {{
      if (!img) return;
      img.referrerPolicy = 'no-referrer';
      if (img.src && img.src.startsWith('http://') && img.src.indexOf('127.0.0.1') === -1) {{
        img.src = 'https://' + img.src.slice(7);
      }}
    }};
    var obs = new MutationObserver(function(muts) {{
      for (var i = 0; i < muts.length; i++) {{
        var nodes = muts[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {{
          var n = nodes[j];
          if (n.tagName === 'IMG') {{
            fixImg(n);
          }} else if (n.querySelectorAll) {{
            var imgs = n.querySelectorAll('img');
            for (var k = 0; k < imgs.length; k++) fixImg(imgs[k]);
          }}
        }}
      }}
    }});
    obs.observe(document.documentElement || document.body, {{ childList: true, subtree: true }});
    window.addEventListener('DOMContentLoaded', function() {{
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) fixImg(imgs[i]);
    }});
  }} catch(e) {{}}

  // Fix CSS background-image referrer 403 on third-party CDNs with anti-hotlinking
  try {{
    var fixBgEl = function(el) {{
      if (!el || el._vxBgFixed) return;
      var style = el.getAttribute('style') || '';
      if (!style || (style.indexOf('url(') === -1 && style.indexOf('url (') === -1)) return;
      var m = style.match(/background(?:-image)?\s*:\s*url\s*\(\s*['"]?(https?:\/\/[^'"\)]+)['"]?\s*\)/i);
      if (m && m[1]) {{
        el._vxBgFixed = true;
        var imgUrl = m[1];
        if (imgUrl.indexOf('127.0.0.1') === -1) {{
          var img = document.createElement('img');
          img.referrerPolicy = 'no-referrer';
          img.setAttribute('referrerpolicy', 'no-referrer');
          img.src = 'http://127.0.0.1:{port}/stream?url=' + encodeURIComponent(imgUrl);
          img.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:2;pointer-events:none;border-radius:inherit;';
          var compPos = window.getComputedStyle(el).position;
          if (compPos === 'static') {{
            el.style.position = 'relative';
          }}
          el.insertBefore(img, el.firstChild);
        }}
      }}
    }};

    var scanBgEls = function(root) {{
      var r = root || document;
      if (!r) return;
      if (r.nodeType === 1 && r.getAttribute && r.getAttribute('style')) {{
        fixBgEl(r);
      }}
      if (r.querySelectorAll) {{
        var list = r.querySelectorAll('[style*="url("], [style*="url ("]');
        for (var i = 0; i < list.length; i++) fixBgEl(list[i]);
      }}
    }};

    var bgObs = new MutationObserver(function(muts) {{
      for (var i = 0; i < muts.length; i++) {{
        var m = muts[i];
        if (m.type === 'childList') {{
          for (var j = 0; j < m.addedNodes.length; j++) {{
            scanBgEls(m.addedNodes[j]);
          }}
        }} else if (m.type === 'attributes') {{
          fixBgEl(m.target);
        }}
      }}
    }});

    bgObs.observe(document.documentElement || document.body, {{
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'data-src', 'data-original']
    }});

    window.addEventListener('DOMContentLoaded', function() {{ scanBgEls(document); }});
    setInterval(function() {{ scanBgEls(document); }}, 600);
  }} catch(e) {{}}

  var upstreamBase = "{final_url}";
  var upstreamOrigin = "";
  try {{
    var uObj = new URL(upstreamBase);
    upstreamOrigin = uObj.origin;
  }} catch(e) {{}}

  // Disable service worker in proxy context
  try {{
    if (navigator.serviceWorker) {{
      navigator.serviceWorker.register = function() {{
        return Promise.reject(new Error("ServiceWorker bypassed"));
      }};
    }}
  }} catch(e) {{}}

  function toFullApiUrl(u) {{
    if (!u || typeof u !== 'string') return '';
    if (u.startsWith('//')) return 'https:' + u;
    return u;
  }}

  function isStaticMediaResource(u) {{
    if (!u) return false;
    var clean = u.split('?')[0].split('#')[0].toLowerCase();
    return clean.endsWith('.js') || clean.endsWith('.css') || clean.endsWith('.png') ||
           clean.endsWith('.jpg') || clean.endsWith('.jpeg') || clean.endsWith('.webp') ||
           clean.endsWith('.gif') || clean.endsWith('.svg') || clean.endsWith('.ico') ||
           clean.endsWith('.woff') || clean.endsWith('.woff2') || clean.endsWith('.ttf') ||
           clean.endsWith('.mp4') || clean.endsWith('.m3u8') || clean.endsWith('.ts');
  }}

  function shouldRouteToApiProxy(u) {{
    if (!u || typeof u !== 'string') return false;
    if (u.indexOf('127.0.0.1') !== -1 || u.indexOf('localhost') !== -1) return false;
    if (u.startsWith('http://') || u.startsWith('https://')) {{
      return !isStaticMediaResource(u);
    }}
    return false;
  }}

  // Safe fetch hook to route relative API calls and cross-origin endpoints to local proxy
  try {{
    var origFetch = window.fetch;
    if (origFetch) {{
      window.fetch = function(input, init) {{
        var rawUrl = (typeof input === 'string') ? input : (input && input.url ? input.url : '');
        var urlStr = toFullApiUrl(rawUrl);
        if (shouldRouteToApiProxy(urlStr)) {{
          var proxied = 'http://127.0.0.1:{port}/api_proxy?url=' + encodeURIComponent(urlStr);
          if (typeof input === 'string') {{
            input = proxied;
          }} else {{
            input = new Request(proxied, input);
          }}
        }} else if (typeof input === 'string') {{
          if (input.startsWith('/') && !input.startsWith('//')) {{
            input = 'http://127.0.0.1:{port}' + input;
          }} else if (input.startsWith('//')) {{
            input = 'https:' + input;
          }}
        }} else if (input && input.url) {{
          if (input.url.startsWith('/') && !input.url.startsWith('//')) {{
            input = new Request('http://127.0.0.1:{port}' + input.url, input);
          }} else if (input.url.startsWith('//')) {{
            input = new Request('https:' + input.url, input);
          }}
        }}
        return origFetch.call(this, input, init);
      }};
    }}
  }} catch(e) {{}}

  // Safe XHR hook for relative and cross-origin API endpoints
  try {{
    var origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {{
      var newUrl = url;
      if (typeof url === 'string') {{
        var full = toFullApiUrl(url);
        if (shouldRouteToApiProxy(full)) {{
          newUrl = 'http://127.0.0.1:{port}/api_proxy?url=' + encodeURIComponent(full);
        }} else if (url.startsWith('/') && !url.startsWith('//')) {{
          newUrl = 'http://127.0.0.1:{port}' + url;
        }} else if (url.startsWith('//')) {{
          newUrl = 'https:' + url;
        }}
      }}
      var args = Array.prototype.slice.call(arguments);
      args[1] = newUrl;
      return origXhrOpen.apply(this, args);
    }};
  }} catch(e) {{}}

  function toRealUrl(u) {{
    if (!u || typeof u !== 'string') return '';
    var trimmed = u.trim();
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('about:') || trimmed.startsWith('data:') || trimmed.startsWith('#')) return '';

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {{
      if (trimmed.indexOf('/web?url=') !== -1) {{
        try {{
          var inner = decodeURIComponent(trimmed.split('/web?url=')[1].split('&')[0]);
          return inner;
        }} catch(e) {{}}
      }}
      if (trimmed.indexOf('127.0.0.1') !== -1 || trimmed.indexOf('localhost') !== -1) {{
        try {{
          var p = new URL(trimmed);
          return upstreamOrigin + p.pathname + p.search + p.hash;
        }} catch(e) {{}}
      }}
      return trimmed;
    }}

    if (trimmed.startsWith('//')) {{
      return 'https:' + trimmed;
    }}

    if (trimmed.startsWith('/')) {{
      return upstreamOrigin + trimmed;
    }}

    try {{
      return new URL(trimmed, upstreamBase).href;
    }} catch(e) {{
      return upstreamOrigin + '/' + trimmed;
    }}
  }}

  var lastReported = "";
  function notifyParentUrl(u) {{
    var real = toRealUrl(u);
    if (!real || real.indexOf('127.0.0.1') !== -1 || real === lastReported) return;
    lastReported = real;
    try {{
      if (realParent && realParent !== window) {{
        realParent.postMessage({{ type: 'VEXA_NAV_URL', url: real }}, '*');
      }}
    }} catch(e) {{}}
  }}

  notifyParentUrl(upstreamBase);

  // Hook History API & hash/popstate for single-page application router sync
  var origPushState = history.pushState;
  if (origPushState) {{
    history.pushState = function() {{
      origPushState.apply(this, arguments);
      setTimeout(function() {{ notifyParentUrl(window.location.href); }}, 60);
    }};
  }}
  var origReplaceState = history.replaceState;
  if (origReplaceState) {{
    history.replaceState = function() {{
      origReplaceState.apply(this, arguments);
      setTimeout(function() {{ notifyParentUrl(window.location.href); }}, 60);
    }};
  }}
  window.addEventListener('popstate', function() {{
    notifyParentUrl(window.location.href);
  }});
  window.addEventListener('hashchange', function() {{
    notifyParentUrl(window.location.href);
  }});

  // Periodic fallback check to sync SPA route changes without delay
  setInterval(function() {{
    notifyParentUrl(window.location.href);
  }}, 1000);

  // Listen for navigation messages from the host app (e.g. Android Back button)
  window.addEventListener('message', function(e) {{
    if (e.data && e.data.type === 'VEXA_NAV_BACK') {{
      try {{
        window.history.back();
      }} catch(err) {{}}
    }}
  }});

  function isDisallowedScheme(u) {{
    if (!u || typeof u !== 'string') return false;
    var trimmed = u.trim().toLowerCase();
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') ||
        trimmed.startsWith('?') || trimmed.startsWith('#') ||
        trimmed.startsWith('//') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {{
      return false;
    }}
    if (trimmed.startsWith('javascript:') || trimmed.startsWith('about:') || trimmed.startsWith('data:')) {{
      return false;
    }}
    // Block app callup protocols like intent:, market:, and non-http schemes
    if (trimmed.indexOf(':') !== -1) {{
      return true;
    }}
    return false;
  }}

  window.open = function(url) {{
    if (isDisallowedScheme(url)) return null;
    var real = toRealUrl(url);
    if (real && !real.startsWith('javascript:')) {{
      window.location.href = "http://127.0.0.1:{port}/web?url=" + encodeURIComponent(real);
    }}
    return window;
  }};

  document.addEventListener('click', function(e) {{
    var target = e.target;
    var a = target && target.closest ? target.closest('a[href], [data-href], [data-url]') : null;
    if (a) {{
      var rawHref = a.getAttribute('href') || a.getAttribute('data-href') || a.getAttribute('data-url') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) {{
        return;
      }}
      if (isDisallowedScheme(rawHref) || isDisallowedScheme(a.href)) {{
        e.preventDefault();
        e.stopPropagation();
        return;
      }}
      var targetUrl = a.href || rawHref;
      var realUrl = toRealUrl(targetUrl);
      if (realUrl && (realUrl.startsWith('http://') || realUrl.startsWith('https://'))) {{
        var isCrossDomain = false;
        try {{
          var uParsed = new URL(realUrl);
          if (upstreamOrigin && uParsed.origin !== upstreamOrigin) {{
            isCrossDomain = true;
          }}
        }} catch(e) {{}}

        // If target is external or target="_blank", route through local proxy
        if (isCrossDomain || a.target === '_blank') {{
          e.preventDefault();
          e.stopPropagation();
          notifyParentUrl(realUrl);
          window.location.href = "http://127.0.0.1:{port}/web?url=" + encodeURIComponent(realUrl);
        }} else {{
          // Internal link or in-page SPA navigation: allow event to bubble so SPA routers can switch tabs
          notifyParentUrl(realUrl);
        }}
      }}
    }}
  }}, true);
}})();
</script>
"#
    );

    let final_html = if clean_html.contains("<head>") {
        clean_html.replacen("<head>", &format!("<head>{}", injection), 1)
    } else if let Some(pos) = clean_html.find("<head") {
        if let Some(end_pos) = clean_html[pos..].find('>') {
            let actual_end = pos + end_pos + 1;
            format!("{}{}{}", &clean_html[..actual_end], injection, &clean_html[actual_end..])
        } else {
            format!("{}{}", injection, clean_html)
        }
    } else if clean_html.contains("<html>") {
        clean_html.replacen("<html>", &format!("<html><head>{}</head>", injection), 1)
    } else {
        format!("{}{}", injection, clean_html)
    };

    let mut resp_builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .header("Referrer-Policy", "no-referrer")
        .header("Cross-Origin-Resource-Policy", "cross-origin");

    for (k, v) in upstream_headers.iter() {
        if k == header::SET_COOKIE {
            if let Ok(v_str) = v.to_str() {
                let sanitized_cookie = v_str
                    .split(';')
                    .filter(|part| {
                        let trimmed = part.trim().to_lowercase();
                        !trimmed.starts_with("domain=") && trimmed != "secure"
                    })
                    .collect::<Vec<&str>>()
                    .join("; ");
                if let Ok(hdr_val) = header::HeaderValue::from_str(&sanitized_cookie) {
                    resp_builder = resp_builder.header(header::SET_COOKIE, hdr_val);
                }
            }
        }
    }

    resp_builder
        .body(Body::from(final_html))
        .unwrap_or_else(|_| Response::new(Body::empty()))
        .into_response()
}
