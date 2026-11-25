use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use lighttier_agent::audit::Audit;
use lighttier_agent::auth::AuthStore;
use lighttier_agent::cli::CliQuery;
use lighttier_agent::config::AgentConfig;
use lighttier_agent::configs::Configs;
use lighttier_agent::http::{build_router, AppState};
use lighttier_agent::settings::SettingsStore;
use tower::ServiceExt;

const ORIGIN: &str = "http://localhost:17800";

async fn app(dir: &std::path::Path) -> axum::Router {
    let cfg = AgentConfig::from_pairs(vec![
        ("LT_DATA_DIR".to_string(), dir.display().to_string()),
        (
            "LT_WEB_DIR".to_string(),
            dir.join("web").display().to_string(),
        ),
        ("LT_BIND".to_string(), "127.0.0.1:17800".to_string()),
    ])
    .unwrap();
    let auth = AuthStore::load(&cfg).await.unwrap();
    let configs = Arc::new(Configs::new(&cfg.data_dir));
    let audit = Arc::new(Audit::new(&cfg.data_dir));
    let settings = Arc::new(SettingsStore::load(&cfg.data_dir).await.unwrap());
    let supervisor = Arc::new(
        lighttier_agent::supervisor::Supervisor::load(
            &cfg.data_dir,
            Some(dir.join("core")),
            configs.clone(),
            settings.clone(),
        )
        .await
        .unwrap(),
    );
    let cli = Arc::new(CliQuery::new(&cfg.data_dir, Some(dir.join("core"))));
    build_router(Arc::new(AppState::new(
        cfg, auth, configs, audit, settings, supervisor, cli,
    )))
}

fn request(
    method: &str,
    uri: &str,
    body: Option<serde_json::Value>,
    cookie: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, "localhost:17800");
    // Mutating requests must carry a same-origin `Origin`, even without a body
    // (DELETE), otherwise the CSRF guard rejects them.
    if !matches!(method, "GET" | "HEAD" | "OPTIONS") {
        builder = builder.header(header::ORIGIN, ORIGIN);
    }
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, format!("lt_session={cookie}"));
    }
    let body = body
        .map(|value| Body::from(value.to_string()))
        .unwrap_or_else(Body::empty);
    builder.body(body).unwrap()
}

fn cookie_value(response: &axum::response::Response) -> String {
    response
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .trim_start_matches("lt_session=")
        .to_string()
}

async fn app_with_session(dir: &std::path::Path) -> (axum::Router, String) {
    let app = app(dir).await;
    let token = std::fs::read_to_string(dir.join("state/setup-token"))
        .unwrap()
        .trim()
        .to_string();
    let res = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/auth/setup",
            Some(serde_json::json!({ "token": token, "password": "long-enough-pw" })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    (app, cookie_value(&res))
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn settings_defaults_and_update_persist() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;

    let res = app
        .clone()
        .oneshot(request("GET", "/api/v1/settings", None, Some(&session)))
        .await
        .unwrap();
    let settings = json_body(res).await;
    assert_eq!(settings["autoStartLastRunning"], false);
    assert_eq!(settings["noTun"], false);
    assert_eq!(settings["logLevel"], "info");

    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/settings",
            Some(serde_json::json!({ "autoStartLastRunning": true, "noTun": true })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let updated = json_body(res).await;
    assert_eq!(updated["autoStartLastRunning"], true);
    assert_eq!(updated["noTun"], true);
    assert_eq!(updated["logLevel"], "info");

    let saved: serde_json::Value = serde_json::from_str(
        &tokio::fs::read_to_string(dir.path().join("state/settings.json"))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(saved["autoStartLastRunning"], true);
    // A boolean-only patch must not reset omitted fields.
    assert_eq!(saved["logLevel"], "info");
    assert_eq!(saved["noTun"], true);

    // A second, disjoint patch merges into the stored value instead of
    // replacing it with defaults.
    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/settings",
            Some(serde_json::json!({ "logLevel": "debug" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let merged = json_body(res).await;
    assert_eq!(merged["logLevel"], "debug");
    assert_eq!(merged["autoStartLastRunning"], true);
    assert_eq!(merged["noTun"], true);

    let saved: serde_json::Value = serde_json::from_str(
        &tokio::fs::read_to_string(dir.path().join("state/settings.json"))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(saved["logLevel"], "debug");
    assert_eq!(saved["autoStartLastRunning"], true);
    assert_eq!(saved["noTun"], true);

    let res = app
        .oneshot(request("GET", "/api/v1/settings", None, Some(&session)))
        .await
        .unwrap();
    let reread = json_body(res).await;
    assert_eq!(reread["logLevel"], "debug");
    assert_eq!(reread["autoStartLastRunning"], true);
    assert_eq!(reread["noTun"], true);
}

#[tokio::test]
async fn invalid_log_level_returns_422() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;
    let res = app
        .oneshot(request(
            "PUT",
            "/api/v1/settings",
            Some(serde_json::json!({ "logLevel": "verbose" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "invalid_settings");
}

#[tokio::test]
async fn malformed_setting_type_is_bad_request() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;
    let res = app
        .oneshot(request(
            "PUT",
            "/api/v1/settings",
            Some(serde_json::json!({ "noTun": "yes" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "bad_request");
}

#[tokio::test]
async fn settings_route_requires_setup_first() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;

    let res = app
        .clone()
        .oneshot(request("GET", "/api/v1/settings", None, None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PRECONDITION_REQUIRED);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "setup_required");

    let res = app
        .oneshot(request(
            "PUT",
            "/api/v1/settings",
            Some(serde_json::json!({ "noTun": true })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PRECONDITION_REQUIRED);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "setup_required");
}

#[tokio::test]
async fn settings_route_requires_login_once_setup_done() {
    let dir = tempfile::tempdir().unwrap();
    let (app, _session) = app_with_session(dir.path()).await;

    let res = app
        .clone()
        .oneshot(request("GET", "/api/v1/settings", None, None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "auth_required");

    let res = app
        .oneshot(request(
            "PUT",
            "/api/v1/settings",
            Some(serde_json::json!({ "noTun": true })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "auth_required");
}

#[tokio::test]
async fn meta_reports_tun_disabled_by_settings() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;

    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/settings",
            Some(serde_json::json!({ "noTun": true })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .oneshot(request("GET", "/api/v1/meta", None, None))
        .await
        .unwrap();
    let meta = json_body(res).await;
    assert_eq!(meta["tunAvailable"], false);
    assert_eq!(meta["tunReason"], "disabled_by_settings");
}
