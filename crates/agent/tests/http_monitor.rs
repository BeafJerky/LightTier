use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
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
use lighttier_agent::supervisor::Supervisor;
use tower::ServiceExt;

const ORIGIN: &str = "http://localhost:17800";

fn write_exec(path: &Path, body: &str) {
    std::fs::write(path, body).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn fake_core(root: &Path) -> PathBuf {
    let version = root.join("core/v9.9.9");
    std::fs::create_dir_all(&version).unwrap();
    write_exec(
        &version.join("easytier-core"),
        "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 0.1; done\n",
    );
    write_exec(
        &version.join("easytier-cli"),
        "#!/bin/sh\ncase \"$5\" in\n  node) echo '{\"hostname\":\"nas\"}' ;;\n  peer) echo '[{\"hostname\":\"peer-a\"}]' ;;\n  *) exit 2 ;;\nesac\n",
    );
    root.to_path_buf()
}

struct TestApp {
    router: axum::Router,
}

async fn test_app(dir: &Path) -> TestApp {
    let data = dir.join("data");
    let cfg = AgentConfig::from_pairs(vec![
        ("LT_DATA_DIR".to_string(), data.display().to_string()),
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
        Supervisor::load(
            &cfg.data_dir,
            Some(dir.join("core")),
            configs.clone(),
            settings.clone(),
        )
        .await
        .unwrap(),
    );
    let cli = Arc::new(CliQuery::new(&cfg.data_dir, Some(dir.join("core"))));
    let router = build_router(Arc::new(AppState::new(
        cfg, auth, configs, audit, settings, supervisor, cli,
    )));
    TestApp { router }
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
    if body.is_some() {
        builder = builder
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ORIGIN, ORIGIN);
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

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

async fn session(app: &TestApp, dir: &Path) -> String {
    let token = std::fs::read_to_string(dir.join("data/state/setup-token"))
        .unwrap()
        .trim()
        .to_string();
    let res = app
        .router
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
    cookie_value(&res)
}

#[tokio::test]
async fn node_peers_and_monitor_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    fake_core(dir.path());
    let app = test_app(dir.path()).await;
    let cookie = session(&app, dir.path()).await;

    let res = app
        .router
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/home",
            Some(serde_json::json!({ "toml": "rpc_portal = \"127.0.0.1:15916\"\nhostname = \"nas\"\n" })),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let res = app
        .router
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/instances/home/start",
            Some(serde_json::json!({})),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .router
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/instances/home/node",
            None,
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let node = json_body(res).await;
    assert_eq!(node["stale"], false);
    assert_eq!(node["data"]["hostname"], "nas");

    let res = app
        .router
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/instances/home/peers",
            None,
            Some(&cookie),
        ))
        .await
        .unwrap();
    let peers = json_body(res).await;
    assert_eq!(peers["data"][0]["hostname"], "peer-a");

    let res = app
        .router
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/instances/home/monitor",
            None,
            Some(&cookie),
        ))
        .await
        .unwrap();
    let monitor = json_body(res).await;
    assert_eq!(monitor["node"]["data"]["hostname"], "nas");
    assert_eq!(monitor["peers"]["data"][0]["hostname"], "peer-a");

    let res = app
        .router
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/instances/home/stop",
            Some(serde_json::json!({})),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .router
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/instances/home/node",
            None,
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(res).await["error"]["code"],
        "instance_not_running"
    );
}
