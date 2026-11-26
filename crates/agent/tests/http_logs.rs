//! HTTP contract of the log endpoints: what the listing exposes, how a tail is
//! cut, which names are reachable at all, and what a clear leaves behind.
//!
//! The log tree is planted by hand (`<data>/logs/...`), because that is exactly
//! the layout the tracing appender, the audit trail and the kernels write into.

mod common;

use std::path::Path;

use axum::http::{header, StatusCode};
use serde_json::json;

use common::{json_body, text_body, TestApp};

const AGENT_LOG: &str = "first line\nsecond line\nthird line\n";
const CORE_LOG: &str = "core line 1\ncore line 2\n";
const AUDIT_LOG: &str = "{\"event\":\"planted\"}\n";

fn empty_root(dir: &Path) -> std::path::PathBuf {
    let root = dir.join("core");
    std::fs::create_dir_all(&root).unwrap();
    root
}

async fn app(dir: &Path) -> TestApp {
    let archive = common::kernel_zip();
    TestApp::new(
        dir,
        empty_root(dir),
        dir.join("builtin"),
        common::manifest_for(&archive),
        None,
    )
    .await
}

/// Writes the files the listing and the reads are about.
fn plant_logs(data: &Path) {
    let agent = data.join("logs/agent");
    let core = data.join("logs/core/home");
    std::fs::create_dir_all(&agent).unwrap();
    std::fs::create_dir_all(&core).unwrap();
    std::fs::write(agent.join("agent.log"), AGENT_LOG).unwrap();
    std::fs::write(agent.join("agent.log.2026-11-25"), "yesterday\n").unwrap();
    std::fs::write(agent.join("audit.log"), AUDIT_LOG).unwrap();
    std::fs::write(core.join("easytier-core.log"), CORE_LOG).unwrap();
}

#[tokio::test]
async fn list_reports_agent_and_core_logs() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;
    plant_logs(app.data_dir());

    // The exact `/logs` route must win over `/logs/{*name}`: this is JSON, not
    // the text a read returns.
    let res = app.send("GET", "/api/v1/logs", None, Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("application/json"));
    let list = json_body(res).await;

    let names: Vec<&str> = list["agent"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["agent.log", "agent.log.2026-11-25", "audit.log"],
        "rotated agent logs and the audit trail are listed, nothing else"
    );
    let agent_log = &list["agent"][0];
    assert_eq!(agent_log["size"].as_u64(), Some(AGENT_LOG.len() as u64));
    assert!(
        agent_log["modifiedAt"].as_i64().unwrap() > 0,
        "modifiedAt is unix seconds: {agent_log}"
    );

    let core = list["core"].as_array().unwrap();
    assert_eq!(core.len(), 1);
    assert_eq!(core[0]["id"], "home");
    let files = core[0]["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["name"], "easytier-core.log");
    assert_eq!(files[0]["size"].as_u64(), Some(CORE_LOG.len() as u64));
    // camelCase keys are what the web adapter parses.
    assert!(files[0].get("modified_at").is_none());
}

/// Reads one log through the API and checks the text/plain contract.
async fn read(app: &TestApp, cookie: &str, uri: &str) -> String {
    let res = app.send("GET", uri, None, Some(cookie)).await;
    assert_eq!(res.status(), StatusCode::OK, "{uri}");
    assert_eq!(
        res.headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        Some("text/plain; charset=utf-8"),
        "{uri}"
    );
    // A log excerpt must never be sniffed into markup, and must never be kept
    // by a proxy or the disk cache.
    assert_eq!(
        res.headers()
            .get(header::X_CONTENT_TYPE_OPTIONS)
            .and_then(|value| value.to_str().ok()),
        Some("nosniff"),
        "{uri}"
    );
    assert_eq!(
        res.headers()
            .get(header::CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("no-store"),
        "{uri}"
    );
    text_body(res).await
}

#[tokio::test]
async fn reads_tail_and_clamp() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;
    plant_logs(app.data_dir());

    // Exactly the last line, nothing before it.
    assert_eq!(
        read(&app, &cookie, "/api/v1/logs/agent.log?tail=1").await,
        "third line\n"
    );
    assert_eq!(
        read(&app, &cookie, "/api/v1/logs/agent.log?tail=2").await,
        "second line\nthird line\n"
    );
    // No `tail` means the default, which covers this small file whole.
    assert_eq!(
        read(&app, &cookie, "/api/v1/logs/agent.log").await,
        AGENT_LOG
    );
    // `tail=0` clamps up to one line instead of answering with an empty 200.
    assert_eq!(
        read(&app, &cookie, "/api/v1/logs/agent.log?tail=0").await,
        "third line\n"
    );
    // Anything above the 2000-line cap is clamped, not refused.
    assert_eq!(
        read(&app, &cookie, "/api/v1/logs/agent.log?tail=99999").await,
        AGENT_LOG
    );
    // Core logs are read the same way, through `core/<id>/<file>`.
    assert_eq!(
        read(
            &app,
            &cookie,
            "/api/v1/logs/core/home/easytier-core.log?tail=1"
        )
        .await,
        "core line 2\n"
    );
    // A non-numeric tail is a client error, not a silent default.
    let res = app
        .send(
            "GET",
            "/api/v1/logs/agent.log?tail=abc",
            None,
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json_body(res).await["error"]["code"], "bad_request");
}

#[tokio::test]
async fn traversal_and_unknown_names_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;
    plant_logs(app.data_dir());
    assert!(app.data_dir().join("state/auth.json").exists());

    // Escapes and structurally broken names are `invalid_id`, never a file read.
    for uri in [
        "/api/v1/logs/core/../state/auth.json",
        "/api/v1/logs/core/%2e%2e/x",
        "/api/v1/logs/core/home/../agent/agent.log",
        "/api/v1/logs/../state/auth.json",
    ] {
        let res = app.send("GET", uri, None, Some(&cookie)).await;
        assert_eq!(res.status(), StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(json_body(res).await["error"]["code"], "invalid_id", "{uri}");
    }

    // Names outside the whitelist, or a whitelisted name that is not there.
    for uri in [
        "/api/v1/logs/secrets.txt",
        "/api/v1/logs/config/home.toml",
        "/api/v1/logs/audit.log.bak/passwd",
        "/api/v1/logs/core/home/missing.log",
    ] {
        let res = app.send("GET", uri, None, Some(&cookie)).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{uri}");
        assert_eq!(json_body(res).await["error"]["code"], "not_found", "{uri}");
    }

    // A whitelisted name that is a directory, or a symlink planted under
    // `logs/`, is "no such log": 404, and the symlink target is never read.
    let agent = app.data_dir().join("logs/agent");
    std::fs::create_dir_all(agent.join("agent.log.dir")).unwrap();
    let secret = app.data_dir().join("outside.txt");
    std::fs::write(&secret, b"planted\n").unwrap();
    std::os::unix::fs::symlink(&secret, agent.join("agent.log.link")).unwrap();
    for uri in ["/api/v1/logs/agent.log.dir", "/api/v1/logs/agent.log.link"] {
        let res = app.send("GET", uri, None, Some(&cookie)).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{uri}");
        assert_eq!(json_body(res).await["error"]["code"], "not_found", "{uri}");
    }
    assert_eq!(std::fs::read(&secret).unwrap(), b"planted\n");
}

#[tokio::test]
async fn clear_truncates_logs_and_keeps_audit_trail() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;
    plant_logs(app.data_dir());
    let data = app.data_dir().to_path_buf();

    let res = app
        .send("DELETE", "/api/v1/logs", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    // Truncated in place, not unlinked: the appender and a running kernel keep
    // those files open, so the names must survive at size zero.
    for name in ["agent.log", "agent.log.2026-11-25"] {
        let path = data.join("logs/agent").join(name);
        assert!(path.is_file(), "{name} must survive a clear");
        assert_eq!(
            std::fs::metadata(&path).unwrap().len(),
            0,
            "{name} must be empty"
        );
    }
    let core_log = data.join("logs/core/home/easytier-core.log");
    assert!(
        core_log.is_file(),
        "the kernel log file must survive a clear"
    );
    assert_eq!(std::fs::metadata(&core_log).unwrap().len(), 0);
    assert!(
        data.join("logs/core/home").is_dir(),
        "directories stay: a running kernel still writes into them"
    );

    // The audit trail is untouched by the clear itself; the new `logs.clear`
    // record is appended to it.
    let audit_text = std::fs::read_to_string(data.join("logs/agent/audit.log")).unwrap();
    assert!(
        audit_text.starts_with(AUDIT_LOG),
        "existing audit lines must survive: {audit_text:?}"
    );
    assert_eq!(audit_text.lines().count(), 2, "{audit_text:?}");

    // The listing agrees with the filesystem right away: every name is still
    // there, the cleared ones at size 0.
    let res = app.send("GET", "/api/v1/logs", None, Some(&cookie)).await;
    let list = json_body(res).await;
    let names: Vec<&str> = list["agent"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["agent.log", "agent.log.2026-11-25", "audit.log"]);
    assert_eq!(list["agent"][0]["size"].as_u64(), Some(0));
    assert_eq!(list["agent"][1]["size"].as_u64(), Some(0));
    assert!(
        list["agent"][2]["size"].as_u64().unwrap() > AUDIT_LOG.len() as u64,
        "the audit trail still holds its old and new lines: {}",
        list["agent"][2]
    );
    let core = list["core"].as_array().unwrap();
    assert_eq!(core.len(), 1, "the group stays, with a zero-byte file");
    assert_eq!(core[0]["files"][0]["size"].as_u64(), Some(0));

    let audit = app.audit_entries(1).await;
    let entry = audit
        .iter()
        .find(|entry| entry["event"] == "logs.clear")
        .expect("clear is audited");
    assert!(entry["requestId"].as_str().is_some_and(|id| !id.is_empty()));
}

/// An unreadable or unwritable log tree is a `500`, never an empty listing and
/// never a silent "cleared"; and a clear that failed is not audited.
#[cfg(unix)]
#[tokio::test]
async fn io_errors_are_500_and_a_failed_clear_is_not_audited() {
    use std::os::unix::fs::PermissionsExt;

    // Mode 000 only stops an unprivileged process; the gate's docker runs as
    // one, a developer's root shell does not.
    if unsafe { libc::geteuid() } == 0 {
        return;
    }

    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;
    plant_logs(app.data_dir());
    let data = app.data_dir().to_path_buf();
    let locked_dir = data.join("logs/core/locked");
    std::fs::create_dir_all(&locked_dir).unwrap();
    std::fs::write(locked_dir.join("easytier-core.log"), "x\n").unwrap();
    let core_log = data.join("logs/core/home/easytier-core.log");

    // `read_dir` of one core group fails: the listing cannot be trusted, so it
    // is a 500 rather than a group quietly missing from the UI.
    std::fs::set_permissions(&locked_dir, std::fs::Permissions::from_mode(0o000)).unwrap();
    let unreadable = app.send("GET", "/api/v1/logs", None, Some(&cookie)).await;
    let status = unreadable.status();
    std::fs::set_permissions(&locked_dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(json_body(unreadable).await["error"]["code"], "internal");

    // Opening one log for truncation fails: the clear reports the failure and
    // writes no audit record claiming success.
    std::fs::set_permissions(&core_log, std::fs::Permissions::from_mode(0o000)).unwrap();
    let failed = app
        .send("DELETE", "/api/v1/logs", None, Some(&cookie))
        .await;
    let status = failed.status();
    std::fs::set_permissions(&core_log, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(json_body(failed).await["error"]["code"], "internal");
    assert!(
        app.audit_now()
            .iter()
            .all(|entry| entry["event"] != "logs.clear"),
        "a failed clear must not be audited as a success"
    );

    // With the permissions back, the same clear succeeds.
    let res = app
        .send("DELETE", "/api/v1/logs", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert!(app
        .audit_now()
        .iter()
        .any(|entry| entry["event"] == "logs.clear"));
}

#[tokio::test]
async fn log_routes_require_login() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;
    plant_logs(app.data_dir());

    for (method, uri) in [
        ("GET", "/api/v1/logs"),
        ("GET", "/api/v1/logs/agent.log"),
        ("DELETE", "/api/v1/logs"),
    ] {
        let res = app.send(method, uri, None, None).await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{method} {uri}");
        assert_eq!(
            json_body(res).await["error"]["code"],
            "auth_required",
            "{method} {uri}"
        );
    }

    // Nothing was cleared on the way out.
    assert!(app.data_dir().join("logs/agent/agent.log").exists());
    // The session cookie planted by the harness still works.
    let res = app.send("GET", "/api/v1/logs", None, Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn invalid_utf8_and_huge_files_do_not_break_a_tail() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;
    plant_logs(app.data_dir());

    // Invalid UTF-8 is replaced, never a 500.
    let core = app.data_dir().join("logs/core/home");
    std::fs::write(core.join("binary.log"), b"ok\n\xff\xfe tail\n").unwrap();
    let res = app
        .send(
            "GET",
            "/api/v1/logs/core/home/binary.log?tail=5",
            None,
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = text_body(res).await;
    assert!(body.ends_with('\n'), "{body:?}");
    assert!(body.contains('\u{FFFD}'), "{body:?}");

    // A log larger than the 512 KiB window is read from the end only.
    let mut huge = String::new();
    for index in 0..120_000 {
        huge.push_str(&format!("line {index}\n"));
    }
    assert!(huge.len() > 1_000_000);
    std::fs::write(core.join("huge.log"), &huge).unwrap();
    let res = app
        .send(
            "GET",
            "/api/v1/logs/core/home/huge.log?tail=2",
            None,
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = text_body(res).await;
    assert_eq!(body, "line 119998\nline 119999\n");
    assert!(
        body.len() < 64,
        "only the requested tail is sent, not the window: {} bytes",
        body.len()
    );
}

/// A row the UI never sees must not break the JSON contract: the audit record a
/// clear writes is itself one of the lines `GET /logs/audit.log` returns.
#[tokio::test]
async fn audit_log_is_readable_after_a_clear() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;
    plant_logs(app.data_dir());

    let res = app
        .send("DELETE", "/api/v1/logs", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    let res = app
        .send("GET", "/api/v1/logs/audit.log?tail=1", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let line = text_body(res).await;
    let record: serde_json::Value =
        serde_json::from_str(line.trim()).expect("the audit tail is still JSON");
    assert_eq!(record["event"], "logs.clear");
    assert_eq!(
        record["details"],
        json!({}),
        "a clear carries no per-file details"
    );
}
