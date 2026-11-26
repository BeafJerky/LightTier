use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{any, delete, get, post};
use axum::{Json, Router};
use rand::RngCore;
use serde::Serialize;
use serde_json::json;
use tower_http::services::ServeDir;

use crate::audit::Audit;
use crate::auth::AuthStore;
use crate::auth_routes;
use crate::cli::CliQuery;
use crate::config::AgentConfig;
use crate::config_routes;
use crate::configs::Configs;
use crate::error::ApiError;
use crate::instance_routes;
use crate::log_routes;
use crate::logs::Logs;
use crate::package_routes;
use crate::packages::Packages;
use crate::settings::SettingsStore;
use crate::settings_routes;
use crate::storage;
use crate::supervisor::Supervisor;
use crate::theme_routes;
use crate::themes::Themes;
use crate::tun;

#[derive(Clone)]
pub struct RequestId(pub String);

pub struct AppState {
    pub cfg: AgentConfig,
    pub auth: AuthStore,
    pub configs: Arc<Configs>,
    pub audit: Arc<Audit>,
    pub settings: Arc<SettingsStore>,
    pub supervisor: Arc<Supervisor>,
    pub cli: Arc<CliQuery>,
    pub packages: Arc<Packages>,
    pub logs: Arc<Logs>,
    pub themes: Arc<Themes>,
}

impl AppState {
    pub fn new(
        cfg: AgentConfig,
        auth: AuthStore,
        configs: Arc<Configs>,
        audit: Arc<Audit>,
        settings: Arc<SettingsStore>,
        supervisor: Arc<Supervisor>,
        cli: Arc<CliQuery>,
        packages: Arc<Packages>,
        logs: Arc<Logs>,
    ) -> Self {
        Self {
            themes: Arc::new(Themes::new(&cfg.data_dir)),
            cfg,
            auth,
            configs,
            audit,
            settings,
            supervisor,
            cli,
            packages,
            logs,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    api_version: &'static str,
    agent_version: &'static str,
    setup_required: bool,
    tun_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    tun_reason: Option<&'static str>,
    features: Features,
    /// The release table the agent installs from, public so the login page can
    /// show what will be offered before a session exists.
    core_versions: Vec<CoreVersion>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Features {
    routes: bool,
    services: bool,
    metrics: bool,
    tray: bool,
    themes: bool,
    update: bool,
    login: bool,
    kernel: bool,
    logs: bool,
    default_route_change: bool,
}

/// One selectable kernel release. `channel` is the lowercase wire name
/// (`stable` / `prerelease`), not a display label.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreVersion {
    version: &'static str,
    channel: &'static str,
}

pub fn build_router(state: Arc<AppState>) -> Router {
    let public = Router::new()
        .route("/api/v1/healthz", get(healthz))
        .route("/api/v1/readyz", get(readyz))
        .route("/api/v1/meta", get(meta))
        .route("/api/v1/auth/setup", post(auth_routes::setup))
        .route("/api/v1/auth/login", post(auth_routes::login));

    let protected = Router::new()
        .route("/api/v1/auth/logout", post(auth_routes::logout))
        .route("/api/v1/auth/session", get(auth_routes::session))
        .route("/api/v1/auth/password", post(auth_routes::change_password))
        .route("/api/v1/configs", get(config_routes::list))
        .route("/api/v1/configs/import", post(config_routes::import))
        .route(
            "/api/v1/configs/{id}",
            get(config_routes::get)
                .put(config_routes::put)
                .delete(config_routes::delete),
        )
        .route("/api/v1/configs/{id}/rename", post(config_routes::rename))
        .route("/api/v1/configs/{id}/export", get(config_routes::export))
        .route(
            "/api/v1/settings",
            get(settings_routes::get).put(settings_routes::put),
        )
        .route("/api/v1/instances", get(instance_routes::list))
        .route("/api/v1/instances/health", get(instance_routes::health))
        .route("/api/v1/instances/{id}/start", post(instance_routes::start))
        .route("/api/v1/instances/{id}/stop", post(instance_routes::stop))
        .route(
            "/api/v1/instances/{id}/restart",
            post(instance_routes::restart),
        )
        .route("/api/v1/instances/{id}/node", get(instance_routes::node))
        .route("/api/v1/instances/{id}/peers", get(instance_routes::peers))
        .route(
            "/api/v1/instances/{id}/monitor",
            get(instance_routes::monitor),
        )
        // `tasks` is a literal segment, so it wins over `{version}` for the same
        // prefix and cannot be mistaken for a version named "tasks".
        .route("/api/v1/packages", get(package_routes::list))
        .route(
            "/api/v1/packages/mirror-probe",
            post(package_routes::mirror_probe),
        )
        .route(
            "/api/v1/packages/{version}/install",
            post(package_routes::install),
        )
        .route("/api/v1/packages/tasks/{id}", get(package_routes::task))
        .route(
            "/api/v1/packages/tasks/{id}/cancel",
            post(package_routes::cancel),
        )
        .route("/api/v1/packages/{version}", delete(package_routes::delete))
        // The literal `/logs` route is registered in the same table as the
        // wildcard below; axum prefers the exact match, so listing can never be
        // swallowed by `{*name}` (the `http_logs` tests pin this).
        .route(
            "/api/v1/themes",
            get(theme_routes::list).post(theme_routes::save),
        )
        .route(
            "/api/v1/themes/{name}",
            get(theme_routes::get).delete(theme_routes::delete),
        )
        .route(
            "/api/v1/logs",
            get(log_routes::list).delete(log_routes::clear),
        )
        .route("/api/v1/logs/{*name}", get(log_routes::read))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_routes::require_auth,
        ));

    let mut router = Router::new()
        .merge(public)
        .merge(protected)
        // Unknown API paths must return the JSON error contract, not the
        // diagnostic page or the SPA shell. The wildcard sits below every real
        // `/api/...` route, so only unmatched paths reach it (the `http_health`
        // tests pin this ordering). `/api/` needs its own entry: the catch-all
        // does not match the bare prefix with a trailing slash, so without it
        // that path would fall through to the static fallback.
        .route("/api", any(api_not_found))
        .route("/api/", any(api_not_found))
        .route("/api/{*rest}", any(api_not_found))
        .route("/status", get(status_page));

    let index = state.cfg.web_dir.join("index.html");
    if index.exists() {
        // `ServeDir` resolves real files; `web_static` turns its 404s into the
        // SPA shell for navigations and stamps the cache policy.
        router = router.fallback_service(
            ServeDir::new(state.cfg.web_dir.clone()).append_index_html_on_directories(true),
        );
    } else {
        router = router
            .route("/", get(status_page))
            .fallback(get(status_page));
    }

    router
        // 2 MiB leaves room for a valid 1 MiB TOML inside the JSON envelope;
        // the stricter 1 MiB guard lives in `Configs::validate_text`.
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(middleware::from_fn(enforce_same_origin))
        .layer(middleware::from_fn(request_id))
        .layer(middleware::from_fn_with_state(state.clone(), web_static))
        // Outermost: extractor rejections raised inside every other layer
        // (including `DefaultBodyLimit`) are reshaped into the API error JSON.
        .layer(middleware::from_fn(jsonify_api_errors))
        .with_state(state)
}

/// Replaces plain-text rejections from extractors (`Json`, `DefaultBodyLimit`)
/// with the standard `{"error":{"code","message"}}` body so API clients only
/// ever parse one error shape.
pub async fn jsonify_api_errors(request: Request, next: Next) -> Response {
    let is_api = request.uri().path().starts_with("/api/");
    let response = next.run(request).await;
    if !is_api {
        return response;
    }
    let status = response.status();
    let code = match status {
        StatusCode::PAYLOAD_TOO_LARGE => "payload_too_large",
        // 422 here only comes from extractor rejections (wrong JSON shape); a
        // real `ApiError` 422 carries `application/json` and passes through.
        StatusCode::BAD_REQUEST
        | StatusCode::UNSUPPORTED_MEDIA_TYPE
        | StatusCode::UNPROCESSABLE_ENTITY => "bad_request",
        _ => return response,
    };
    let is_json = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.starts_with("application/json"))
        .unwrap_or(false);
    if is_json {
        return response;
    }
    let message = status.canonical_reason().unwrap_or("request rejected");
    let request_id = response
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let mut shaped = (
        status,
        Json(json!({ "error": { "code": code, "message": message } })),
    )
        .into_response();
    if let Some(id) = request_id {
        if let Ok(value) = HeaderValue::from_str(&id) {
            shaped.headers_mut().insert("x-request-id", value);
        }
    }
    shaped
}

pub async fn enforce_same_origin(request: Request, next: Next) -> Response {
    if matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) {
        return next.run(request).await;
    }
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    let allowed = match (host, origin) {
        (Some(host), Some(origin)) => origin_authority(origin)
            .map(|authority| authority.eq_ignore_ascii_case(host))
            .unwrap_or(false),
        _ => false,
    };
    if allowed {
        next.run(request).await
    } else {
        ApiError::ForbiddenOrigin.into_response()
    }
}

fn origin_authority(origin: &str) -> Option<&str> {
    let without_scheme = origin.split_once("://").map(|(_, rest)| rest)?;
    Some(without_scheme.split('/').next().unwrap_or(without_scheme))
}

async fn healthz() -> Json<serde_json::Value> {
    Json(json!({ "ok": true }))
}

async fn api_not_found() -> ApiError {
    ApiError::NotFound
}

async fn readyz(State(state): State<Arc<AppState>>) -> Response {
    let writable = storage::dir_writable(&state.cfg.data_dir).await;
    let tun = std::path::Path::new("/dev/net/tun").exists();
    let versions: Vec<String> = state
        .packages
        .list_installed()
        .into_iter()
        .map(|package| package.version)
        .collect();
    let status = if writable {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(json!({
            "ready": writable,
            "tun": tun,
            "coreVersions": versions,
        })),
    )
        .into_response()
}

async fn meta(State(state): State<Arc<AppState>>) -> Json<Meta> {
    let settings = state.settings.get().await;
    let (tun_available, mut tun_reason) = tun::probe();
    if settings.no_tun {
        tun_reason = Some("disabled_by_settings");
    }
    let core_versions = state
        .packages
        .manifest()
        .iter()
        .map(|item| CoreVersion {
            version: item.version,
            channel: item.channel.as_str(),
        })
        .collect();
    Json(Meta {
        api_version: "1",
        agent_version: env!("CARGO_PKG_VERSION"),
        setup_required: state.auth.setup_required().await,
        tun_available: tun_available && !settings.no_tun,
        tun_reason,
        features: Features {
            // Every capability the agent implements today. The web UI keys off
            // these flags, so they track reality instead of the roadmap.
            // Route mutation stays off: the only desktop consumer is the
            // exit-node flow, which rewrites the default gateway — explicitly
            // forbidden on a NAS (a wrong gateway takes the box off the LAN).
            routes: false,
            services: false,
            metrics: false,
            tray: false,
            themes: true,
            update: false,
            login: true,
            kernel: true,
            logs: true,
            default_route_change: false,
        },
        core_versions,
    })
}

async fn status_page() -> Html<String> {
    Html(format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <title>LightTier Agent</title></head><body style=\"font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem\">\
         <h1>LightTier Agent</h1>\
         <p>LightTier agent 运行中 / LightTier agent is running</p>\
         <p>版本 / Version: {}</p>\
         <p>管理界面 / Management UI: <a href=\"/\">/</a><br>\
         登录 / Sign in: <a href=\"/login\">/login</a></p>\
         <ul><li><a href=\"/api/v1/meta\">/api/v1/meta</a></li>\
         <li><a href=\"/api/v1/healthz\">/api/v1/healthz</a></li>\
         <li><a href=\"/api/v1/readyz\">/api/v1/readyz</a></li></ul>\
         </body></html>",
        env!("CARGO_PKG_VERSION")
    ))
}

/// Cache policy for hashed Vite bundles, safe to keep forever.
const ASSET_CACHE: &str = "public, max-age=31536000, immutable";

/// Serves the SPA shell where the static file server found nothing and stamps
/// the cache policy.
///
/// A request is a navigation when it is extension-less (`/instances`) or asks
/// for HTML (`Accept: text/html`); only those fall back to `index.html`. Any
/// other miss (a missing bundle, `GET /assets/missing.js`) stays a real 404,
/// `/api/*` is never rewritten, and a path with `.`/`..` segments keeps its
/// 404, so the JSON error contract and the web root survive.
async fn web_static(State(state): State<Arc<AppState>>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let is_api = path == "/api" || path.starts_with("/api/");
    let head_only = request.method() == Method::HEAD;
    let method_serves_body = matches!(*request.method(), Method::GET | Method::HEAD);
    // Decide on the path itself instead of trusting the file server to fail:
    // `ServeDir` may reject a traversal for reasons unrelated to the rewrite
    // (or stop rejecting it), and handing such a request the shell would make
    // the app the entry point for probing `<web_dir>/..`.
    let escapes_root = path_escapes_web_root(&path);
    let navigation = !escapes_root
        && !path.starts_with("/assets/")
        && (no_extension(&path) || accepts_html(&request));
    let mut response = next.run(request).await;

    if method_serves_body && !is_api && response.status() == StatusCode::NOT_FOUND && navigation {
        // Read per request instead of at router build time so a rebuilt
        // `index.html` is served without restarting the agent. The static mode
        // itself is chosen once at startup: `build_router` only installs this
        // middleware when `index.html` already exists, so a web directory that
        // appears later keeps the status page until a restart.
        if let Ok(bytes) = tokio::fs::read(state.cfg.web_dir.join("index.html")).await {
            response = index_response(bytes, head_only);
        }
    }

    if response.status().is_success() {
        let cache = if path.starts_with("/assets/") {
            Some(HeaderValue::from_static(ASSET_CACHE))
        } else if is_html(&response) {
            Some(HeaderValue::from_static("no-cache"))
        } else {
            None
        };
        if let Some(value) = cache {
            response.headers_mut().insert(header::CACHE_CONTROL, value);
        }
    }
    response
}

fn no_extension(path: &str) -> bool {
    std::path::Path::new(path).extension().is_none()
}

/// True when the request path could resolve outside the web root, in which case
/// the SPA fallback must leave the file server's 404 untouched. Checked raw and
/// after one round of percent-decoding: the URI carries the encoded form
/// (`%2e%2e`, `%2f`, `%5c`) while the file server decodes before joining, so
/// the guard has to see what the join will see.
fn path_escapes_web_root(path: &str) -> bool {
    has_dot_segment(path) || has_dot_segment(&percent_decode_once(path))
}

/// A segment of `.`/`..` walks the tree, and a backslash (only meaningful after
/// decoding, as a second separator on Windows) could do the same.
fn has_dot_segment(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment == "." || segment == ".." || segment.contains('\\'))
}

/// Decodes `%XX` escapes exactly once; malformed or truncated escapes are kept
/// literally, matching what a lenient decoder would do.
fn percent_decode_once(path: &str) -> String {
    let bytes = path.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                decoded.push(high << 4 | low);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn accepts_html(request: &Request) -> bool {
    request
        .headers()
        .get(header::ACCEPT)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.contains("text/html"))
        .unwrap_or(false)
}

fn is_html(response: &Response) -> bool {
    response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.starts_with("text/html"))
        .unwrap_or(false)
}

fn index_response(bytes: Vec<u8>, head_only: bool) -> Response {
    let length = bytes.len();
    let mut response = if head_only {
        // `HEAD` carries the headers a `GET` would, but no payload.
        let mut response = StatusCode::OK.into_response();
        if let Ok(value) = HeaderValue::from_str(&length.to_string()) {
            response.headers_mut().insert(header::CONTENT_LENGTH, value);
        }
        response
    } else {
        (StatusCode::OK, bytes).into_response()
    };
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

pub async fn serve(state: Arc<AppState>) -> Result<(), Box<dyn std::error::Error>> {
    let listener = tokio::net::TcpListener::bind(state.cfg.bind).await?;
    let addr = listener.local_addr()?;
    eprintln!("lighttier-agent listening on {addr}");
    tracing::info!(%addr, "listening");
    axum::serve(
        listener,
        build_router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

pub async fn request_id(mut request: Request, next: Next) -> Response {
    if matches!(
        *request.method(),
        Method::GET | Method::HEAD | Method::OPTIONS
    ) {
        return next.run(request).await;
    }
    let mut bytes = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut bytes);
    let id = hex::encode(bytes);
    request.extensions_mut().insert(RequestId(id.clone()));
    let mut response = next.run(request).await;
    if let Ok(value) = HeaderValue::from_str(&id) {
        response.headers_mut().insert("x-request-id", value);
    }
    response
}
