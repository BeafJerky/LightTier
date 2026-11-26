//! Mirror prefix normalization and server-side speed probing.
//!
//! The browser cannot HEAD/GET release mirrors directly (CORS), so the agent
//! probes on its behalf. Only normalized prefixes are accepted and they are
//! joined onto the manifest's own official URL — a client never supplies the
//! URL that gets fetched.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::stream::{self, StreamExt};
use serde::Serialize;

use super::manifest::official_url;

/// Wire value of the official source, verbatim from the frontend constant
/// `GITHUB_EASYTIER` so probe results match the UI list by string equality.
pub const OFFICIAL_SOURCE: &str = "https://github.com/EasyTier/EasyTier";

/// Cap on one probe request, so a client cannot fan out unbounded work.
pub const MAX_PROBE_SOURCES: usize = 10;

const MAX_PREFIX_LENGTH: usize = 2048;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// HEAD budget, same magnitude as the desktop probe (DNS/TLS + redirects).
const HEAD_TIMEOUT: Duration = Duration::from_secs(8);
/// GET sampling: response-header budget, window and byte cap mirror the
/// desktop `SPEED_SAMPLE_*` constants.
const SAMPLE_RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);
const SAMPLE_WINDOW: Duration = Duration::from_millis(1800);
const SAMPLE_MAX_BYTES: u64 = 256 * 1024;
/// Whole per-source budget (HEAD + GET), and the request-wide ceiling.
const SOURCE_TIMEOUT: Duration = Duration::from_secs(15);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(50);
const CONCURRENCY: usize = 4;

/// Same rules as the frontend `normalizeMirrorPrefix`: optional scheme defaults
/// to https, http(s) only, no whitespace/query/fragment/credentials, exactly one
/// trailing slash. Returns `None` for anything else.
pub fn normalize_mirror_prefix(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() || value.len() > MAX_PREFIX_LENGTH || value.chars().any(char::is_whitespace)
    {
        return None;
    }
    let value = if has_scheme(value) {
        value.to_owned()
    } else {
        format!("https://{value}")
    };
    let url = reqwest::Url::parse(&value).ok()?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return None;
    }
    if url.host_str().is_none_or(str::is_empty)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let path = url.path().trim_end_matches('/');
    Some(format!("{}{path}/", url.origin().ascii_serialization()))
}

/// `^[a-zA-Z][a-zA-Z\d+.-]*://`, the frontend scheme test.
fn has_scheme(value: &str) -> bool {
    let Some((scheme, _)) = value.split_once("://") else {
        return false;
    };
    let mut chars = scheme.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

/// One resolved probe target: what the response echoes and what gets fetched.
pub struct ProbeTarget {
    pub echo: String,
    pub url: String,
}

/// Resolves a client-supplied source into a fetchable URL. Empty and the
/// official constant mean "GitHub direct"; anything else must normalize to a
/// mirror prefix. GitHub itself is never a mirror, which also rejects a full
/// release URL pasted as a source (it would double-join the official URL).
pub fn resolve_probe_source(raw: &str, version: &str) -> Option<ProbeTarget> {
    let official = official_url(version);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Some(ProbeTarget {
            echo: OFFICIAL_SOURCE.to_owned(),
            url: official,
        });
    }
    let normalized = normalize_mirror_prefix(trimmed)?;
    if normalized == normalize_mirror_prefix(OFFICIAL_SOURCE)? {
        return Some(ProbeTarget {
            echo: OFFICIAL_SOURCE.to_owned(),
            url: official,
        });
    }
    let host = reqwest::Url::parse(&normalized).ok()?;
    if host.host_str() == Some("github.com") {
        return None;
    }
    Some(ProbeTarget {
        url: format!("{}/{official}", normalized.trim_end_matches('/')),
        echo: normalized,
    })
}

/// One probe outcome, camelCase for the web UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorProbeResult {
    pub source: String,
    pub latency_ms: Option<u64>,
    pub speed_bytes_per_sec: Option<u64>,
    pub ok: bool,
}

impl MirrorProbeResult {
    fn failed(source: String) -> Self {
        Self {
            source,
            latency_ms: None,
            speed_bytes_per_sec: None,
            ok: false,
        }
    }
}

/// Probes every source (HEAD latency + GET throughput sample) with bounded
/// concurrency and timeouts. One bad source never fails the others; results
/// come back in input order, unfinished ones reported `ok=false`.
pub async fn probe_mirrors(sources: &[String], version: &str) -> Vec<MirrorProbeResult> {
    let client = probe_client();
    let done: Arc<Mutex<Vec<MirrorProbeResult>>> = Arc::new(Mutex::new(Vec::new()));
    // Owned iterator on purpose: a closure over `&String` returning an async
    // block trips the "FnOnce is not general enough" HRTB limitation.
    let jobs = sources.iter().cloned().map(|raw| {
        let client = client.clone();
        let done = done.clone();
        let version = version.to_owned();
        async move {
            let result = match resolve_probe_source(&raw, &version) {
                Some(target) => {
                    let (latency_ms, speed) =
                        tokio::time::timeout(SOURCE_TIMEOUT, probe_one(&client, &target.url))
                            .await
                            .unwrap_or_default();
                    MirrorProbeResult {
                        source: target.echo,
                        latency_ms,
                        speed_bytes_per_sec: speed,
                        ok: latency_ms.is_some() || speed.unwrap_or(0) > 0,
                    }
                }
                None => MirrorProbeResult::failed(raw.trim().to_owned()),
            };
            done.lock().unwrap_or_else(|err| err.into_inner()).push(result);
        }
    });
    let _ = tokio::time::timeout(
        TOTAL_TIMEOUT,
        stream::iter(jobs).buffer_unordered(CONCURRENCY).collect::<()>(),
    )
    .await;
    let done = done.lock().unwrap_or_else(|err| err.into_inner());
    sources
        .iter()
        .map(|raw| {
            let echo = resolve_probe_source(raw, version)
                .map(|target| target.echo)
                .unwrap_or_else(|| raw.trim().to_owned());
            done.iter()
                .find(|result| result.source == echo)
                .cloned()
                .unwrap_or_else(|| MirrorProbeResult::failed(echo))
        })
        .collect()
}

/// No credentials, bounded redirects; every phase carries its own timeout so a
/// mirror that accepts the connection and then stalls cannot pin the request.
fn probe_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .expect("the probe HTTP client must be buildable")
}

async fn probe_one(client: &reqwest::Client, url: &str) -> (Option<u64>, Option<u64>) {
    let latency = head_latency(client, url).await;
    let speed = sample_speed(client, url).await;
    (latency, speed)
}

async fn head_latency(client: &reqwest::Client, url: &str) -> Option<u64> {
    let start = Instant::now();
    let response = tokio::time::timeout(HEAD_TIMEOUT, client.head(url).send())
        .await
        .ok()?
        .ok()?;
    response
        .status()
        .is_success()
        .then(|| start.elapsed().as_millis() as u64)
}

/// GET sample: bytes received within the window over elapsed time. A reachable
/// mirror that sends nothing reports `Some(0)` (the desktop "fake alive" case);
/// a failed request reports `None`.
async fn sample_speed(client: &reqwest::Client, url: &str) -> Option<u64> {
    let mut response = tokio::time::timeout(SAMPLE_RESPONSE_TIMEOUT, client.get(url).send())
        .await
        .ok()?
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let start = Instant::now();
    let mut received: u64 = 0;
    while received < SAMPLE_MAX_BYTES && start.elapsed() < SAMPLE_WINDOW {
        let remaining = SAMPLE_WINDOW.saturating_sub(start.elapsed());
        match tokio::time::timeout(remaining, response.chunk()).await {
            Ok(Ok(Some(chunk))) => received += chunk.len() as u64,
            _ => break,
        }
    }
    let elapsed = start.elapsed().as_secs_f64();
    Some(if elapsed > 0.0 {
        (received as f64 / elapsed) as u64
    } else {
        0
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn normalization_matches_the_frontend_rules() {
        assert_eq!(
            normalize_mirror_prefix(" ghproxy.com ").as_deref(),
            Some("https://ghproxy.com/")
        );
        assert_eq!(
            normalize_mirror_prefix("https://ghproxy.com///").as_deref(),
            Some("https://ghproxy.com/")
        );
        assert_eq!(
            normalize_mirror_prefix("HTTP://Example.COM/gh/").as_deref(),
            Some("http://example.com/gh/")
        );
        assert_eq!(
            normalize_mirror_prefix("http://127.0.0.1:8080").as_deref(),
            Some("http://127.0.0.1:8080/")
        );
    }

    #[test]
    fn normalization_rejects_invalid_prefixes() {
        for raw in [
            "",
            "   ",
            "not a url",
            "ftp://example.com/",
            "javascript:alert(1)",
            "https://example.com/?a=1",
            "https://example.com/#x",
            "https://user:pass@example.com/",
        ] {
            assert!(normalize_mirror_prefix(raw).is_none(), "{raw} must fail");
        }
        assert!(normalize_mirror_prefix(&format!(
            "https://example.com/{}",
            "a".repeat(MAX_PREFIX_LENGTH)
        ))
        .is_none());
    }

    #[test]
    fn official_direct_join_is_the_manifest_url() {
        for raw in ["", "   ", OFFICIAL_SOURCE, "https://github.com/EasyTier/EasyTier/"] {
            let target = resolve_probe_source(raw, "v2.6.4").unwrap();
            assert_eq!(target.echo, OFFICIAL_SOURCE);
            assert_eq!(target.url, official_url("v2.6.4"));
        }
    }

    #[test]
    fn mirror_prefix_joins_onto_the_official_url() {
        let target = resolve_probe_source("https://ghfast.top", "v2.6.4").unwrap();
        assert_eq!(target.echo, "https://ghfast.top/");
        assert_eq!(
            target.url,
            format!("https://ghfast.top/{}", official_url("v2.6.4"))
        );
    }

    #[test]
    fn full_urls_and_bad_schemes_are_rejected_per_source() {
        // A complete release URL is not a prefix: joining it would fetch
        // `<release-url>/<release-url>`, so it must never reach the network.
        assert!(resolve_probe_source(&official_url("v2.6.4"), "v2.6.4").is_none());
        assert!(resolve_probe_source("https://github.com/some/path", "v2.6.4").is_none());
        assert!(resolve_probe_source("ftp://example.com/", "v2.6.4").is_none());
        assert!(resolve_probe_source("https://example.com/?a=1", "v2.6.4").is_none());
    }

    /// Minimal loopback HTTP fixture (same trick as the install tests): one
    /// response per connection, no external network.
    async fn serve(status: u16, body: Vec<u8>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let methods = Arc::new(Mutex::new(Vec::new()));
        let seen = methods.clone();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let body = body.clone();
                let seen = seen.clone();
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut buffer = [0u8; 512];
                    loop {
                        match stream.read(&mut buffer).await {
                            Ok(0) | Err(_) => return,
                            Ok(read) => head.extend_from_slice(&buffer[..read]),
                        }
                        if head.windows(4).any(|window| window == b"\r\n\r\n") {
                            break;
                        }
                        if head.len() > 8192 {
                            return;
                        }
                    }
                    let request = String::from_utf8_lossy(&head).into_owned();
                    let method = request.split_whitespace().next().unwrap_or("").to_owned();
                    let head_only = method == "HEAD";
                    seen.lock().unwrap().push(method);
                    let reply = format!(
                        "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    if stream.write_all(reply.as_bytes()).await.is_err() {
                        return;
                    }
                    if !head_only {
                        let _ = stream.write_all(&body).await;
                    }
                    let _ = stream.shutdown().await;
                });
            }
        });
        (base, methods)
    }

    #[tokio::test]
    async fn probe_reports_latency_and_speed_from_a_live_fixture() {
        let (base, methods) = serve(200, vec![7u8; 64 * 1024]).await;
        let results = probe_mirrors(std::slice::from_ref(&base), "v2.6.4").await;
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].source, format!("{base}/"));
        assert!(results[0].ok);
        assert!(results[0].latency_ms.is_some());
        assert!(results[0].speed_bytes_per_sec.unwrap() > 0);
        let methods = methods.lock().unwrap().clone();
        assert!(methods.contains(&"HEAD".to_owned()));
        assert!(methods.contains(&"GET".to_owned()));
    }

    #[tokio::test]
    async fn one_bad_source_does_not_fail_the_others() {
        let (base, _) = serve(200, vec![1u8; 1024]).await;
        let closed_port = {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        let sources = vec![
            "ftp://bad.example/".to_owned(),
            base.clone(),
            format!("http://127.0.0.1:{closed_port}"),
        ];
        let results = probe_mirrors(&sources, "v2.6.4").await;
        assert_eq!(results.len(), 3);
        assert!(!results[0].ok, "invalid prefix stays a per-source failure");
        assert!(results[1].ok);
        assert!(!results[2].ok, "unreachable mirror stays a per-source failure");
        assert_eq!(results[1].source, format!("{base}/"));
    }

    #[tokio::test]
    async fn error_status_is_not_ok() {
        let (base, _) = serve(503, b"nope".to_vec()).await;
        let results = probe_mirrors(&[base], "v2.6.4").await;
        assert!(!results[0].ok);
        assert!(results[0].latency_ms.is_none());
    }
}