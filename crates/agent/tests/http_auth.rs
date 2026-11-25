use std::net::SocketAddr;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use axum::response::Response;
use http_body_util::BodyExt;
use lighttier_agent::auth::AuthStore;
use lighttier_agent::config::AgentConfig;
use lighttier_agent::http::{build_router, AppState};
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
    let configs = Arc::new(lighttier_agent::configs::Configs::new(&cfg.data_dir));
    let audit = Arc::new(lighttier_agent::audit::Audit::new(&cfg.data_dir));
    let settings = Arc::new(
        lighttier_agent::settings::SettingsStore::load(&cfg.data_dir)
            .await
            .unwrap(),
    );
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
    build_router(Arc::new(AppState::new(
        cfg,
        auth,
        configs,
        audit,
        settings,
        supervisor,
        Arc::new(lighttier_agent::cli::CliQuery::new(
            dir,
            Some(dir.join("core")),
        )),
    )))
}

fn peer() -> ConnectInfo<SocketAddr> {
    ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 40_000)))
}

fn post_json(
    uri: &str,
    body: serde_json::Value,
    origin: Option<&str>,
    cookie: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::HOST, "localhost:17800")
        .header(header::CONTENT_TYPE, "application/json")
        .extension(peer());
    if let Some(origin) = origin {
        builder = builder.header(header::ORIGIN, origin);
    }
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, format!("lt_session={cookie}"));
    }
    builder.body(Body::from(body.to_string())).unwrap()
}

fn get_json(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut builder = Request::builder()
        .method("GET")
        .uri(uri)
        .header(header::HOST, "localhost:17800")
        .extension(peer());
    if let Some(cookie) = cookie {
        builder = builder.header(header::COOKIE, format!("lt_session={cookie}"));
    }
    builder.body(Body::empty()).unwrap()
}

fn setup_token(dir: &std::path::Path) -> String {
    std::fs::read_to_string(dir.join("state/setup-token"))
        .unwrap()
        .trim()
        .to_string()
}

fn cookie_value(response: &Response) -> String {
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

#[tokio::test]
async fn setup_requires_same_origin() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let res = app
        .oneshot(post_json(
            "/api/v1/auth/setup",
            serde_json::json!({"token": setup_token(dir.path()), "password": "long-enough-pw"}),
            None,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn setup_login_and_session_flow() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;

    let res = app
        .clone()
        .oneshot(post_json(
            "/api/v1/auth/setup",
            serde_json::json!({"token": setup_token(dir.path()), "password": "long-enough-pw"}),
            Some(ORIGIN),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let session = cookie_value(&res);

    let res = app
        .clone()
        .oneshot(get_json("/api/v1/auth/session", Some(&session)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["authenticated"], true);

    let res = app
        .clone()
        .oneshot(get_json("/api/v1/auth/session", None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let res = app
        .clone()
        .oneshot(post_json(
            "/api/v1/auth/logout",
            serde_json::json!({}),
            Some(ORIGIN),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    let res = app
        .oneshot(get_json("/api/v1/auth/session", Some(&session)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_rate_limit_returns_429() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let res = app
        .clone()
        .oneshot(post_json(
            "/api/v1/auth/setup",
            serde_json::json!({"token": setup_token(dir.path()), "password": "long-enough-pw"}),
            Some(ORIGIN),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    for _ in 0..5 {
        let res = app
            .clone()
            .oneshot(post_json(
                "/api/v1/auth/login",
                serde_json::json!({"password": "wrong-password"}),
                Some(ORIGIN),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
    let res = app
        .oneshot(post_json(
            "/api/v1/auth/login",
            serde_json::json!({"password": "long-enough-pw"}),
            Some(ORIGIN),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
}
