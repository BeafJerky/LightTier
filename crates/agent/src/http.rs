use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{DefaultBodyLimit, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{any, get, post};
use axum::{Json, Router};
use rand::RngCore;
use serde::Serialize;
use serde_json::json;
use tower_http::services::{ServeDir, ServeFile};

use crate::audit::Audit;
use crate::auth::AuthStore;
use crate::auth_routes;
use crate::cli::CliQuery;
use crate::config::AgentConfig;
use crate::config_routes;
use crate::configs::Configs;
use crate::error::ApiError;
use crate::instance_routes;
use crate::settings::SettingsStore;
use crate::settings_routes;
use crate::storage;
use crate::supervisor::Supervisor;
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
    ) -> Self {
        Self {
            cfg,
            auth,
            configs,
            audit,
            settings,
            supervisor,
            cli,
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
    default_route_change: bool,
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
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_routes::require_auth,
        ));

    let mut router = Router::new()
        .merge(public)
        .merge(protected)
        // Unknown API paths must return the JSON error contract, not the
        // HTML diagnostic page (M2 endpoints will rely on this shape).
        .route("/api/v1/{*rest}", any(api_not_found))
        .route("/status", get(status_page));

    let index = state.cfg.web_dir.join("index.html");
    if index.exists() {
        router = router
            .route_service("/", ServeFile::new(index))
            .fallback_service(
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
            "coreVersions": [],
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
    Json(Meta {
        api_version: "1",
        agent_version: env!("CARGO_PKG_VERSION"),
        setup_required: state.auth.setup_required().await,
        tun_available: tun_available && !settings.no_tun,
        tun_reason,
        features: Features {
            routes: false,
            services: false,
            metrics: false,
            tray: false,
            themes: false,
            update: false,
            login: true,
            default_route_change: false,
        },
    })
}

async fn status_page() -> Html<String> {
    Html(format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <title>LightTier Agent</title></head><body style=\"font-family:system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem\">\
         <h1>LightTier Agent</h1>\
         <p>Agent 在线 / Agent is running.</p>\
         <p>版本 / Version: {}</p>\
         <p>这是 M1 诊断页，管理界面将在 Web 适配完成后提供。<br>\
         This is the M1 diagnostic page; the management UI arrives with the web adapter.</p>\
         <ul><li><a href=\"/api/v1/healthz\">/api/v1/healthz</a></li>\
         <li><a href=\"/api/v1/readyz\">/api/v1/readyz</a></li>\
         <li><a href=\"/api/v1/meta\">/api/v1/meta</a></li></ul>\
         </body></html>",
        env!("CARGO_PKG_VERSION")
    ))
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
