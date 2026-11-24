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
    Arc::new(AppState::new(cfg, auth))
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
