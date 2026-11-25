use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use lighttier_agent::config::AgentConfig;
use lighttier_agent::http::{build_router, AppState};
use tower::ServiceExt;

async fn test_state(dir: &std::path::Path) -> Arc<AppState> {
    let cfg = AgentConfig::from_pairs(vec![
        ("LT_DATA_DIR".to_string(), dir.display().to_string()),
        (
            "LT_WEB_DIR".to_string(),
            dir.join("web").display().to_string(),
        ),
        ("LT_BIND".to_string(), "127.0.0.1:17800".to_string()),
    ])
    .unwrap();
    let auth = lighttier_agent::auth::AuthStore::load(&cfg).await.unwrap();
    let configs = Arc::new(lighttier_agent::configs::Configs::new(&cfg.data_dir));
    let audit = Arc::new(lighttier_agent::audit::Audit::new(&cfg.data_dir));
    let settings = Arc::new(
        lighttier_agent::settings::SettingsStore::load(&cfg.data_dir)
            .await
            .unwrap(),
    );
    // No core is installed and no instance is started here, so a missing core
    // directory is fine; the supervisor only needs the path for later starts.
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
    let cli = Arc::new(lighttier_agent::cli::CliQuery::new(
        &cfg.data_dir,
        Some(dir.join("core")),
    ));
    Arc::new(AppState::new(
        cfg, auth, configs, audit, settings, supervisor, cli,
    ))
}

#[tokio::test]
async fn healthz_is_public() {
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(test_state(dir.path()).await);
    let res = app
        .oneshot(Request::get("/api/v1/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn meta_reports_uninitialized() {
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(test_state(dir.path()).await);
    let res = app
        .oneshot(Request::get("/api/v1/meta").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["apiVersion"], "1");
    assert_eq!(value["setupRequired"], true);
}

#[tokio::test]
async fn unknown_api_path_returns_json_404() {
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(test_state(dir.path()).await);
    let res = app
        .clone()
        .oneshot(Request::get("/api/v1/nope").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["error"]["code"], "not_found");

    // Non-API paths still reach the diagnostic page in M1.
    let res = app
        .oneshot(Request::get("/whatever").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn status_page_is_html() {
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(test_state(dir.path()).await);
    let res = app
        .oneshot(Request::get("/status").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert!(String::from_utf8_lossy(&body).contains("LightTier Agent"));
}
