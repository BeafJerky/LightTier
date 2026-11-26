//! HTTP contract of the server-side web configs (`easytier-core --config-server`):
//! the table, the per-record process actions, and what an administrator change
//! leaves in the audit log. Every kernel is a shell script; nothing here reaches
//! a real configuration server.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::http::StatusCode;
use serde_json::{json, Value};

use common::TestApp;

/// A root that exists but holds no kernel.
fn empty_root(dir: &Path) -> PathBuf {
    let root = dir.join("core");
    std::fs::create_dir_all(&root).unwrap();
    root
}

/// Installs `body` as `<root>/v9.9.9/easytier-core` (mode 0755).
fn install_core(root: &Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    let version = root.join(common::VERSION);
    std::fs::create_dir_all(&version).unwrap();
    let core = version.join("easytier-core");
    std::fs::write(&core, body).unwrap();
    std::fs::set_permissions(&core, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn item(name: &str) -> Value {
    json!({
        "configFileName": name,
        "protocol": "udp",
        "host": "web.example.com",
        "port": 11010,
        "userName": "octet",
        "webStartMethod": 2,
        "webUrl": "http://web.example.com:11223",
    })
}

async fn test_app(dir: &Path, core_body: &str) -> TestApp {
    let archive = common::kernel_zip();
    let root = empty_root(dir);
    install_core(&root, core_body);
    TestApp::new(
        dir,
        root,
        dir.join("builtin"),
        common::manifest_for(&archive),
        None,
    )
    .await
}

async fn put(app: &TestApp, cookie: &str, items: Vec<Value>) -> axum::response::Response {
    app.send("PUT", "/api/v1/web-configs", Some(json!({ "items": items })), Some(cookie))
        .await
}

async fn list(app: &TestApp, cookie: &str) -> Value {
    let res = app.send("GET", "/api/v1/web-configs", None, Some(cookie)).await;
    assert_eq!(res.status(), StatusCode::OK);
    common::json_body(res).await
}

async fn wait_not_running(app: &TestApp, cookie: &str, name: &str) -> Value {
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let body = list(app, cookie).await;
        let entry = body["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["configFileName"] == name)
            .cloned()
            .unwrap_or(Value::Null);
        if entry["status"] == "notRunning" || std::time::Instant::now() >= deadline {
            return entry;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

const LIVE_CORE: &str = "#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 0.1; done\n";

#[tokio::test]
async fn web_config_routes_require_login() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let res = app.send("GET", "/api/v1/web-configs", None, None).await;
    assert_eq!(res.status(), StatusCode::PRECONDITION_REQUIRED);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "setup_required"
    );

    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let _cookie = app.session().await;
    for (method, uri) in [
        ("GET", "/api/v1/web-configs".to_string()),
        ("PUT", "/api/v1/web-configs".to_string()),
        ("POST", "/api/v1/web-configs/home/start".to_string()),
        ("POST", "/api/v1/web-configs/home/stop".to_string()),
    ] {
        let body = (method == "PUT").then(|| json!({ "items": [] }));
        let res = app.send(method, &uri, body, None).await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(common::json_body(res).await["error"]["code"], "auth_required");
    }
}

#[tokio::test]
async fn table_and_process_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let cookie = app.session().await;

    let res = put(&app, &cookie, vec![item("office web")]).await;
    assert_eq!(res.status(), StatusCode::OK);
    let created = common::json_body(res).await;
    let entry = &created["items"][0];
    assert_eq!(entry["configFileName"], "office web");
    assert_eq!(entry["protocol"], "udp");
    assert_eq!(entry["host"], "web.example.com");
    assert_eq!(entry["port"], 11010);
    assert_eq!(entry["userName"], "octet");
    assert_eq!(entry["webStartMethod"], 2);
    assert_eq!(entry["webUrl"], "http://web.example.com:11223");
    assert_eq!(entry["status"], "notRunning");
    assert_eq!(entry["pid"], Value::Null);

    // The id may contain a space (valid config id), so it arrives percent-encoded.
    let start = "/api/v1/web-configs/office%20web/start";
    let res = app.send("POST", start, None, Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let running = list(&app, &cookie).await;
    assert_eq!(running["items"][0]["status"], "running");
    let pid = running["items"][0]["pid"].as_u64().expect("running pid");

    // A second start is idempotent: same process, no second kernel.
    let res = app.send("POST", start, None, Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(list(&app, &cookie).await["items"][0]["pid"], json!(pid));

    // Web configs are not TOML instances: they must not leak into that list.
    let instances = app
        .send("GET", "/api/v1/instances", None, Some(&cookie))
        .await;
    assert_eq!(instances.status(), StatusCode::OK);
    let instances = common::json_body(instances).await;
    assert_eq!(instances["instances"], json!([]));
    assert_eq!(instances["catalog"], json!([]));
    // ...and the instance endpoint cannot address them either.
    let res = app
        .send("POST", "/api/v1/instances/office%20web/stop", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::CONFLICT);

    // Re-putting the identical table must not restart the running kernel.
    let res = put(&app, &cookie, vec![item("office web")]).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(common::json_body(res).await["items"][0]["pid"], json!(pid));

    let stop = "/api/v1/web-configs/office%20web/stop";
    let res = app.send("POST", stop, None, Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let stopped = list(&app, &cookie).await;
    assert_eq!(stopped["items"][0]["status"], "notRunning");
    assert_eq!(stopped["items"][0]["pid"], Value::Null);
    assert!(!Path::new(&format!("/proc/{pid}")).exists(), "kernel must be gone");

    // Stopping an already stopped record is a success.
    let res = app.send("POST", stop, None, Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Unknown records are 404 for both actions.
    for action in ["start", "stop"] {
        let res = app
            .send(
                "POST",
                &format!("/api/v1/web-configs/missing/{action}"),
                None,
                Some(&cookie),
            )
            .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{action}");
        assert_eq!(common::json_body(res).await["error"]["code"], "not_found");
    }
}

#[tokio::test]
async fn put_validates_every_field() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let cookie = app.session().await;

    let cases: Vec<(Value, StatusCode, &str)> = vec![
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "quic", "host": "h", "port": 1, "userName": "u" })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_settings",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "h", "port": 0, "userName": "u" })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_settings",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "h", "port": 70000, "userName": "u" })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_settings",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "bad host", "port": 1, "userName": "u" })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_settings",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "h", "port": 1, "userName": "../etc" })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_settings",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "h", "port": 1, "userName": "u", "webUrl": "javascript:alert(1)" })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_settings",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "h", "port": 1, "userName": "u", "webStartMethod": 10 })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_settings",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "h", "port": 1, "userName": "u", "webStartMethod": -1 })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_settings",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "h", "port": 1, "userName": "u", "webStartMethod": 1.5 })] }),
            StatusCode::UNPROCESSABLE_ENTITY,
            "bad_request",
        ),
        (
            json!({ "items": [json!({ "configFileName": "bad\\id", "protocol": "udp", "host": "h", "port": 1, "userName": "u" })] }),
            StatusCode::BAD_REQUEST,
            "invalid_id",
        ),
        (
            json!({ "items": [json!({ "configFileName": "web", "protocol": "udp", "host": "h", "port": 1, "userName": "u" }), json!({ "configFileName": "web", "protocol": "tcp", "host": "h2", "port": 2, "userName": "u" })] }),
            StatusCode::CONFLICT,
            "config_exists",
        ),
    ];
    for (body, status, code) in cases {
        let res = app
            .send("PUT", "/api/v1/web-configs", Some(body.clone()), Some(&cookie))
            .await;
        assert_eq!(res.status(), status, "{body}");
        assert_eq!(common::json_body(res).await["error"]["code"], code, "{body}");
    }
    // Nothing was written by the rejected requests.
    assert_eq!(list(&app, &cookie).await["items"], json!([]));

    // Every legacy `webStartMethod` value is accepted and persisted verbatim.
    let items: Vec<Value> = (0..=9)
        .map(|method| {
            let mut entry = item(&format!("web{method}"));
            entry["webStartMethod"] = json!(method);
            entry
        })
        .collect();
    let res = put(&app, &cookie, items).await;
    assert_eq!(res.status(), StatusCode::OK);
    let listed = list(&app, &cookie).await;
    for method in 0..=9u64 {
        let entry = listed["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["configFileName"] == json!(format!("web{method}")))
            .unwrap()
            .clone();
        assert_eq!(entry["webStartMethod"], json!(method));
    }
    // A missing `webStartMethod` falls back to the desktop default (2).
    let mut entry = item("default-method");
    entry.as_object_mut().unwrap().remove("webStartMethod");
    let res = put(&app, &cookie, vec![entry]).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(common::json_body(res).await["items"][0]["webStartMethod"], 2);
}

#[tokio::test]
async fn persisted_file_holds_user_fields_only_and_survives_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let cookie = app.session().await;

    // Desktop backups carry `status`/`pid`; they must be ignored, not stored.
    let mut with_runtime = item("home");
    with_runtime["status"] = json!("running");
    with_runtime["pid"] = json!(4242);
    let res = put(&app, &cookie, vec![with_runtime]).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(common::json_body(res).await["items"][0]["status"], "notRunning");

    let raw = tokio::fs::read_to_string(app.data_dir().join("state/web-configs.json"))
        .await
        .unwrap();
    let parsed: Value = serde_json::from_str(&raw).unwrap();
    let stored = &parsed["items"][0];
    assert_eq!(stored["configFileName"], "home");
    assert!(stored.get("status").is_none(), "{stored}");
    assert!(stored.get("pid").is_none(), "{stored}");

    // A corrupt file must not break the API: it reads as an empty table.
    let dir2 = tempfile::tempdir().unwrap();
    let app2 = test_app(dir2.path(), LIVE_CORE).await;
    let cookie2 = app2.session().await;
    tokio::fs::create_dir_all(app2.data_dir().join("state"))
        .await
        .unwrap();
    tokio::fs::write(
        app2.data_dir().join("state/web-configs.json"),
        b"{not json",
    )
    .await
    .unwrap();
    assert_eq!(list(&app2, &cookie2).await["items"], json!([]));
}

#[tokio::test]
async fn removing_a_running_record_stops_it_first() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let cookie = app.session().await;

    let res = put(&app, &cookie, vec![item("office"), item("keep")]).await;
    assert_eq!(res.status(), StatusCode::OK);
    for name in ["office", "keep"] {
        app.send(
            "POST",
            &format!("/api/v1/web-configs/{name}/start"),
            None,
            Some(&cookie),
        )
        .await;
    }
    let before = list(&app, &cookie).await;
    let pid_of = |body: &Value, name: &str| {
        body["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["configFileName"] == name)
            .unwrap()["pid"]
            .as_u64()
            .expect("running pid")
    };
    let office_pid = pid_of(&before, "office");
    let keep_pid = pid_of(&before, "keep");

    // Only the console URL changes on `keep`; a running kernel is not stale.
    let mut kept = item("keep");
    kept["webUrl"] = json!("http://other.example.com:11223");
    let res = put(&app, &cookie, vec![kept]).await;
    assert_eq!(res.status(), StatusCode::OK);
    let listed = common::json_body(res).await;
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);
    assert_eq!(listed["items"][0]["configFileName"], "keep");
    assert_eq!(listed["items"][0]["pid"], json!(keep_pid));
    // The removed record took its kernel with it.
    assert!(
        !Path::new(&format!("/proc/{office_pid}")).exists(),
        "the removed record's kernel must be stopped"
    );
    app.send("POST", "/api/v1/web-configs/keep/stop", None, Some(&cookie))
        .await;
}

#[tokio::test]
async fn exited_process_returns_to_not_running() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), "#!/bin/sh\nexit 0\n").await;
    let cookie = app.session().await;

    let res = put(&app, &cookie, vec![item("crashy")]).await;
    assert_eq!(res.status(), StatusCode::OK);
    let res = app
        .send("POST", "/api/v1/web-configs/crashy/start", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    let entry = wait_not_running(&app, &cookie, "crashy").await;
    assert_eq!(entry["status"], "notRunning");
    assert_eq!(entry["pid"], Value::Null);
}

#[tokio::test]
async fn web_config_logs_are_a_listed_core_group() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let cookie = app.session().await;
    let res = put(&app, &cookie, vec![item("home")]).await;
    assert_eq!(res.status(), StatusCode::OK);
    app.send("POST", "/api/v1/web-configs/home/start", None, Some(&cookie))
        .await;
    // The kernel writes its own files; stand in for one so the listing has a row.
    let log_dir = app.data_dir().join("logs/core/web-config");
    tokio::fs::create_dir_all(&log_dir).await.unwrap();
    tokio::fs::write(log_dir.join("easytier-core.log"), b"line\n")
        .await
        .unwrap();

    let res = app.send("GET", "/api/v1/logs", None, Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::OK);
    let logs = common::json_body(res).await;
    let group = logs["core"]
        .as_array()
        .unwrap()
        .iter()
        .find(|group| group["id"] == "web-config")
        .cloned()
        .expect("web-config must be a listable core log group");
    assert_eq!(group["files"][0]["name"], "easytier-core.log");
    let res = app
        .send(
            "GET",
            "/api/v1/logs/core/web-config/easytier-core.log",
            None,
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(common::text_body(res).await, "line\n");

    app.send("POST", "/api/v1/web-configs/home/stop", None, Some(&cookie))
        .await;
}

#[tokio::test]
async fn audit_records_table_and_process_changes() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let cookie = app.session().await;

    let res = put(&app, &cookie, vec![item("home")]).await;
    let create_request = res
        .headers()
        .get("x-request-id")
        .expect("writes carry x-request-id")
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(res.status(), StatusCode::OK);

    let mut edited = item("home");
    // A console-link edit must not restart the kernel (no stop/start pair here).
    edited["webUrl"] = json!("http://web.example.com:19999");
    app.send("POST", "/api/v1/web-configs/home/start", None, Some(&cookie))
        .await;
    let res = put(&app, &cookie, vec![edited]).await;
    assert_eq!(res.status(), StatusCode::OK);
    app.send("POST", "/api/v1/web-configs/home/stop", None, Some(&cookie))
        .await;
    app.send("POST", "/api/v1/web-configs/home/start", None, Some(&cookie))
        .await;
    // Removing a running record deletes it (and stops its kernel).
    let res = put(&app, &cookie, vec![]).await;
    assert_eq!(res.status(), StatusCode::OK);

    let entries = app.audit_entries(6).await;
    let web: Vec<&Value> = entries
        .iter()
        .filter(|entry| entry["event"].as_str().unwrap_or_default().starts_with("web."))
        .collect();
    let events: Vec<&str> = web.iter().map(|entry| entry["event"].as_str().unwrap()).collect();
    assert_eq!(
        events,
        vec![
            "web.create",
            "web.start",
            "web.update",
            "web.stop",
            "web.start",
            "web.delete",
        ],
        "{entries:?}"
    );
    assert_eq!(web[0]["requestId"], create_request.as_str());
    assert_eq!(web[0]["details"]["name"], "home");
    assert_eq!(web[0]["details"]["host"], "web.example.com");
    assert_eq!(web[0]["details"]["port"], 11010);
    // No runtime state and no console URL in the trail.
    for entry in &web {
        assert!(entry["details"].get("pid").is_none(), "{entry}");
        assert!(entry["details"].get("status").is_none(), "{entry}");
        assert!(entry["details"].get("webUrl").is_none(), "{entry}");
    }
}

#[tokio::test]
async fn meta_reports_web_feature() {
    let dir = tempfile::tempdir().unwrap();
    let app = test_app(dir.path(), LIVE_CORE).await;
    let res = app.send("GET", "/api/v1/meta", None, None).await;
    assert_eq!(res.status(), StatusCode::OK);
    let value = common::json_body(res).await;
    assert_eq!(value["features"]["web"], true);
    // Windows-service management has no Linux counterpart.
    assert_eq!(value["features"]["services"], false);
}