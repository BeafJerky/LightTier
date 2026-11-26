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
    // Same core root as the supervisor, so the package listing and a spawn can
    // never disagree about the active kernel.
    let packages = Arc::new(
        lighttier_agent::packages::Packages::new(&cfg.data_dir)
            .with_core_override(Some(dir.join("core"))),
    );
    let logs = Arc::new(lighttier_agent::logs::Logs::new(&cfg.data_dir));
    let router = build_router(Arc::new(AppState::new(
        cfg, auth, configs, audit, settings, supervisor, cli, packages, logs,
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
            Some(serde_json::json!({ "toml": "rpc_portal = \"127.0.0.1:15916\"\nhostname = \"nas\"\ninstance_name = \"家\"\ndhcp = true\nexit_nodes = [\"0.0.0.0/0\"]\n\n[network_identity]\nnetwork_name = \"mesh-a\"\n" })),
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
    // 停止的配置也要出现在 catalog 中：监控页需要区分运行中与未运行实例。
    let res = app
        .router
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/office",
            Some(serde_json::json!({ "toml": "rpc_portal = \"127.0.0.1:15918\"\nhostname = \"office\"\n" })),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .router
        .clone()
        .oneshot(request("GET", "/api/v1/instances", None, Some(&cookie)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let list = json_body(res).await;
    // catalog 列出全部合法配置 id；instances 同样覆盖已停止配置，用 running 区分。
    assert_eq!(list["catalog"], serde_json::json!(["home", "office"]));
    assert_eq!(list["instances"].as_array().map(Vec::len), Some(2));
    assert_eq!(list["instances"][0]["id"], "home");
    assert_eq!(list["instances"][0]["running"], true);
    assert_eq!(list["instances"][1]["id"], "office");
    assert_eq!(list["instances"][1]["running"], false);

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
    // 配置派生字段由 agent 补进 node.data（与桌面 runtime 的投影口径一致），
    // 否则监控页会把网络名称显示成 “—”、DHCP 显示成“已禁用”
    assert_eq!(monitor["node"]["data"]["_dhcp"], true);
    assert_eq!(monitor["node"]["data"]["_network_name"], "mesh-a");
    assert_eq!(monitor["node"]["data"]["_instance_name"], "家");
    assert_eq!(monitor["node"]["data"]["_exit_nodes"][0], "0.0.0.0/0");
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

#[tokio::test]
async fn health_requires_auth_and_samples_running_instances() {
    let dir = tempfile::tempdir().unwrap();
    fake_core(dir.path());
    let app = test_app(dir.path()).await;
    let cookie = session(&app, dir.path()).await;

    let res = app
        .router
        .clone()
        .oneshot(request("GET", "/api/v1/instances/health", None, None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);

    let res = app
        .router
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/instances/health",
            None,
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let empty = json_body(res).await;
    assert!(empty["revision"].as_u64().unwrap() >= 1);
    assert!(empty["sampledAt"].as_i64().unwrap() > 0);
    assert_eq!(empty["instances"].as_array().map(Vec::len), Some(0));

    let res = app
        .router
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/home",
            Some(serde_json::json!({ "toml": "rpc_portal = \"127.0.0.1:15921\"\nhostname = \"nas\"\n" })),
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

    // 与桌面 quality_from_peers 用例同数据：Local 排除、空串跳过、字符串指标求均值。
    write_exec(
        &dir.path().join("core/v9.9.9/easytier-cli"),
        "#!/bin/sh\ncase \"$5\" in\n  node) echo '{\"hostname\":\"nas\"}' ;;\n  peer) echo '[{\"cost\":\"Local\",\"lat_ms\":\"1\",\"loss_rate\":\"0\"},{\"cost\":\"p2p\",\"lat_ms\":\"20\",\"loss_rate\":\"1.5\"},{\"cost\":\"relay\",\"lat_ms\":\"\",\"loss_rate\":\"0.5\"},{\"cost\":\"relay\",\"lat_ms\":\"40\",\"loss_rate\":\"\"}]' ;;\n  *) exit 2 ;;\nesac\n",
    );

    let res = app
        .router
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/instances/health",
            None,
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let snapshot = json_body(res).await;
    assert!(snapshot["revision"].as_u64().unwrap() > empty["revision"].as_u64().unwrap());
    let samples = snapshot["instances"].as_array().unwrap();
    assert_eq!(samples.len(), 1);
    assert_eq!(samples[0]["configFileName"], "home");
    assert_eq!(samples[0]["ok"], true);
    assert_eq!(samples[0]["avgLatencyMs"], 30.0);
    assert_eq!(samples[0]["lossRate"], 1.0);
    assert_eq!(samples[0]["peerCount"], 3);

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
            "/api/v1/instances/health",
            None,
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let stopped = json_body(res).await;
    assert_eq!(stopped["instances"].as_array().map(Vec::len), Some(0));
}

#[tokio::test]
async fn health_marks_failed_cli_query_without_metrics() {
    let dir = tempfile::tempdir().unwrap();
    fake_core(dir.path());
    write_exec(
        &dir.path().join("core/v9.9.9/easytier-cli"),
        "#!/bin/sh\nexit 3\n",
    );
    let app = test_app(dir.path()).await;
    let cookie = session(&app, dir.path()).await;

    let res = app
        .router
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/office",
            Some(serde_json::json!({ "toml": "rpc_portal = \"127.0.0.1:15922\"\nhostname = \"office\"\n" })),
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
            "/api/v1/instances/office/start",
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
            "/api/v1/instances/health",
            None,
            Some(&cookie),
        ))
        .await
        .unwrap();
    // 单实例 CLI 失败不能把整个请求打成 5xx。
    assert_eq!(res.status(), StatusCode::OK);
    let snapshot = json_body(res).await;
    let samples = snapshot["instances"].as_array().unwrap();
    assert_eq!(samples.len(), 1);
    assert_eq!(samples[0]["configFileName"], "office");
    assert_eq!(samples[0]["ok"], false);
    assert_eq!(samples[0]["peerCount"], 0);
    assert!(samples[0].get("avgLatencyMs").is_none());
    assert!(samples[0].get("lossRate").is_none());

    let res = app
        .router
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/instances/office/stop",
            Some(serde_json::json!({})),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
}
