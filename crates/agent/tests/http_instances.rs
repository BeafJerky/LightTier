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
use lighttier_agent::supervisor::{self, Supervisor};
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
    root.to_path_buf()
}

struct TestApp {
    router: axum::Router,
    supervisor: Arc<Supervisor>,
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
        cfg,
        auth,
        configs,
        audit,
        settings,
        supervisor.clone(),
        cli,
        packages,
        logs,
    )));
    TestApp { router, supervisor }
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

/// Parsed JSONL records of `<data>/logs/agent/audit.log`. The file is written
/// (and flushed) before the response is returned, but the poll-with-deadline
/// keeps the assertions robust against a lagging write.
async fn audit_entries(dir: &Path, min_lines: usize) -> Vec<serde_json::Value> {
    let path = dir.join("data/logs/agent/audit.log");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let entries: Vec<serde_json::Value> = text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).expect("audit lines are JSON"))
            .collect();
        if entries.len() >= min_lines || std::time::Instant::now() >= deadline {
            return entries;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
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
async fn instance_routes_require_login() {
    // Before setup the whole protected group answers `setup_required`.
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path()).await;
    let res = app
        .router
        .clone()
        .oneshot(request("GET", "/api/v1/instances", None, None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PRECONDITION_REQUIRED);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "setup_required");

    // After setup a missing cookie is `auth_required`, for reads and writes.
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path()).await;
    let _cookie = session(&app, dir.path()).await;

    let res = app
        .router
        .clone()
        .oneshot(request("GET", "/api/v1/instances", None, None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "auth_required");

    // The helper sends a same-origin `Origin`, so the CSRF guard passes and
    // authentication is what rejects the write.
    let res = app
        .router
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/instances/home/start",
            Some(serde_json::json!({})),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "auth_required");
}

#[tokio::test]
async fn start_stop_restart_lifecycle() {
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
            Some(serde_json::json!({ "toml": "rpc_portal = \"127.0.0.1:15911\"\nhostname = \"nas\"\n" })),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    // 第二个配置保持停止：catalog 必须列出全部配置 id，而不只是运行中的实例。
    let res = app
        .router
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/office",
            Some(serde_json::json!({ "toml": "rpc_portal = \"127.0.0.1:15917\"\nhostname = \"office\"\n" })),
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
    // Captured before the body is consumed; the audit line must repeat it.
    let start_request_id = res
        .headers()
        .get("x-request-id")
        .expect("non-GET responses carry x-request-id")
        .to_str()
        .unwrap()
        .to_string();
    let started = json_body(res).await;
    assert_eq!(started["running"], true);
    assert_eq!(started["rpcPortal"], "127.0.0.1:15911");

    // A successful start is audited exactly once, linked to the response's
    // request id, and only the id is recorded as detail.
    let entries = audit_entries(dir.path(), 1).await;
    let starts: Vec<&serde_json::Value> = entries
        .iter()
        .filter(|entry| entry["event"] == "instance.start")
        .collect();
    assert_eq!(
        starts.len(),
        1,
        "one successful start, one audit line: {entries:?}"
    );
    assert_eq!(starts[0]["requestId"], start_request_id.as_str());
    assert_eq!(starts[0]["details"]["id"], "home");

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
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(json_body(res).await["error"]["code"], "instance_running");

    // Failures are not audited: the rejected duplicate adds no start line.
    let entries = audit_entries(dir.path(), 1).await;
    let starts = entries
        .iter()
        .filter(|entry| entry["event"] == "instance.start")
        .count();
    assert_eq!(starts, 1, "a failed start must not be audited: {entries:?}");

    let res = app
        .router
        .clone()
        .oneshot(request("GET", "/api/v1/instances", None, Some(&cookie)))
        .await
        .unwrap();
    let list = json_body(res).await;
    // instances 覆盖全部配置（含已停止项，用 running 标记），按 id 排序：
    // home 运行中、office 已停止。
    assert_eq!(list["instances"][0]["id"], "home");
    assert_eq!(list["instances"][0]["running"], true);
    assert_eq!(list["instances"][1]["id"], "office");
    assert_eq!(list["instances"][1]["running"], false);
    assert_eq!(list["instances"].as_array().map(Vec::len), Some(2));
    // catalog 列出全部合法配置 id，与实例是否运行无关。
    assert_eq!(list["catalog"], serde_json::json!(["home", "office"]));

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
    assert_eq!(json_body(res).await["running"], false);

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
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(res).await["error"]["code"],
        "instance_not_running"
    );

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
    // The process the restart has to replace.
    let pid_before_restart = json_body(res).await["pid"]
        .as_u64()
        .expect("a running instance reports its pid");

    let res = app
        .router
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/instances/home/restart",
            Some(serde_json::json!({})),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let restarted = json_body(res).await;
    assert_eq!(restarted["running"], true);
    // `running == true` alone also passes for a no-op, so pin the new process.
    let restarted_pid = restarted["pid"]
        .as_u64()
        .expect("restart reports the new pid");
    assert_ne!(
        restarted_pid, pid_before_restart,
        "restart must spawn a brand new process, got {restarted_pid} twice"
    );

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
            "POST",
            "/api/v1/instances/missing/start",
            Some(serde_json::json!({})),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    // A percent-encoded backslash keeps the request inside the instance route:
    // the 400 comes from `validate_config_id`, not from the `/api/v1/{*rest}`
    // catch-all (which would have answered 404 `not_found`). A space would no
    // longer do: spaces are valid in config ids, so `bad%20id` is a real id.
    let res = app
        .router
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/instances/bad%5Cid/start",
            Some(serde_json::json!({})),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json_body(res).await["error"]["code"], "invalid_id");

    // The fake kernel is stopped above; assert nothing leaked behind the test.
    assert!(!app.supervisor.snapshot("home").await.running);
}

#[tokio::test]
async fn autostart_brings_back_last_running_config() {
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
            Some(serde_json::json!({ "toml": "rpc_portal = \"127.0.0.1:15912\"\nhostname = \"nas\"\n" })),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let res = app
        .router
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/settings",
            Some(serde_json::json!({ "autoStartLastRunning": true })),
            Some(&cookie),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    // 模拟上次会话退出时 home 仍在运行。
    let state_file = dir.path().join("data/state/instances.json");
    tokio::fs::write(&state_file, "{\"lastRunning\":[\"home\"]}")
        .await
        .unwrap();
    let supervisor = Supervisor::load(
        &dir.path().join("data"),
        Some(dir.path().join("core")),
        Arc::new(Configs::new(&dir.path().join("data"))),
        Arc::new(SettingsStore::load(&dir.path().join("data")).await.unwrap()),
    )
    .await
    .unwrap();

    supervisor::autostart(&supervisor).await;
    let snapshot = supervisor.snapshot("home").await;
    assert!(snapshot.running);
    supervisor.stop("home").await.unwrap();
}
