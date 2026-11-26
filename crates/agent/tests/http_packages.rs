//! HTTP contract of the kernel-package endpoints: what the UI lists, how an
//! install is started and polled, when a removal is refused, and what an
//! administrator change leaves in the audit log.

mod common;

use std::time::Duration;

use axum::http::StatusCode;
use serde_json::json;

use common::TestApp;

/// A root that exists but holds no kernel, so a version list is genuinely empty
/// without depending on `/opt/lighttier/core` of the machine running the tests.
fn empty_root(dir: &std::path::Path) -> std::path::PathBuf {
    let root = dir.join("core");
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[tokio::test]
async fn package_routes_require_login() {
    let archive = common::kernel_zip();
    let dir = tempfile::tempdir().unwrap();
    let app = TestApp::new(
        dir.path(),
        empty_root(dir.path()),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        None,
    )
    .await;

    // Before setup the whole protected group answers `setup_required`.
    let res = app.send("GET", "/api/v1/packages", None, None).await;
    assert_eq!(res.status(), StatusCode::PRECONDITION_REQUIRED);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "setup_required"
    );

    let dir = tempfile::tempdir().unwrap();
    let app = TestApp::new(
        dir.path(),
        empty_root(dir.path()),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        None,
    )
    .await;
    let _cookie = app.session().await;

    // After setup a missing cookie is `auth_required`, for reads and writes.
    let cases = [
        ("GET", "/api/v1/packages".to_string()),
        ("GET", "/api/v1/packages/tasks/9.9.9-1".to_string()),
        (
            "POST",
            format!("/api/v1/packages/{}/install", common::VERSION),
        ),
        ("POST", "/api/v1/packages/tasks/9.9.9-1/cancel".to_string()),
        ("POST", "/api/v1/packages/mirror-probe".to_string()),
        ("DELETE", format!("/api/v1/packages/{}", common::VERSION)),
    ];
    for (method, uri) in cases {
        let res = app.send(method, &uri, Some(json!({})), None).await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{method} {uri}");
        let err = common::json_body(res).await;
        assert_eq!(err["error"]["code"], "auth_required", "{method} {uri}");
    }
}

#[tokio::test]
async fn list_reports_available_releases_and_no_installed_versions() {
    let dir = tempfile::tempdir().unwrap();
    let root = empty_root(dir.path());
    let app = TestApp::new(
        dir.path(),
        root.clone(),
        root,
        // The shipped release table, so the listing is the one a real agent serves.
        lighttier_agent::packages::LINUX_PACKAGES,
        None,
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send("GET", "/api/v1/packages", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = common::json_body(res).await;

    assert_eq!(body["installed"], json!([]));
    assert!(body["active"].is_null(), "nothing is installed: {body}");
    assert_eq!(
        body["installAllowed"], true,
        "a default layout installs into the root it scans: {body}"
    );
    assert_eq!(body["mirrorLocked"], false, "no env lock by default: {body}");

    let available = body["available"].as_array().unwrap();
    let versions: Vec<&str> = available
        .iter()
        .map(|item| item["version"].as_str().unwrap())
        .collect();
    assert_eq!(versions, ["v2.7.1", "v2.6.4", "v2.5.0", "v2.4.5"]);
    let channels: Vec<&str> = available
        .iter()
        .map(|item| item["channel"].as_str().unwrap())
        .collect();
    assert_eq!(channels, ["prerelease", "stable", "prerelease", "stable"]);
    assert!(available.iter().all(|item| item["installed"] == false));
}

#[tokio::test]
async fn install_rejects_a_version_outside_the_manifest() {
    let archive = common::kernel_zip();
    let mirror = common::mirror_serving(archive.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let app = TestApp::new(
        dir.path(),
        empty_root(dir.path()),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        Some(mirror.base()),
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send(
            "POST",
            "/api/v1/packages/v8.8.8/install",
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "core_version_unsupported"
    );
    assert!(
        mirror.hits().is_empty(),
        "a refused version never downloads"
    );

    // A rejected request creates no task and leaves no audit line behind. The
    // read is non-blocking: nothing is *expected* to be written here, so waiting
    // for a line that never comes would only cost the deadline.
    let entries = app.audit_now();
    assert!(
        entries
            .iter()
            .all(|entry| entry["event"] != "package.install"),
        "a rejected install must not be audited: {entries:?}"
    );

    let res = app
        .send("GET", "/api/v1/packages/tasks/9.9.9-1", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(common::json_body(res).await["error"]["code"], "not_found");
}

/// Under `LT_CORE_DIR` the agent's publish target `<data>/core` is never
/// scanned, so an install would succeed and stay invisible. The endpoints say
/// so up front instead of writing a tree nothing can activate.
#[tokio::test]
async fn override_layout_refuses_installs_and_reports_them_disabled() {
    let archive = common::kernel_zip();
    let dir = tempfile::tempdir().unwrap();
    let override_dir = dir.path().join("operator-core");
    // A kernel the operator placed, so the listing has something to show.
    common::write_fake_install(&override_dir, "v2.6.4");
    let app = TestApp::new_with_override(
        dir.path(),
        override_dir.clone(),
        common::manifest_for(&archive),
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send("GET", "/api/v1/packages", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = common::json_body(res).await;
    assert_eq!(body["installAllowed"], false, "{body}");
    assert_eq!(body["active"], "v2.6.4");
    assert_eq!(body["installed"][0]["builtin"], true);

    let res = app
        .send(
            "POST",
            &format!("/api/v1/packages/{}/install", common::VERSION),
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "core_override_read_only"
    );
    // The refusal happens before anything touches the unscanned tree.
    assert!(
        !dir.path().join("data/core").exists(),
        "no version may be published into a root nobody scans"
    );
    assert!(
        app.audit_now().is_empty(),
        "a refusal is not an install to audit"
    );

    // No task was created either, so the id namespace stays empty.
    let res = app
        .send("GET", "/api/v1/packages/tasks/9.9.9-1", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn install_publishes_a_verified_package_and_reports_it_active() {
    let archive = common::kernel_zip();
    let mirror = common::mirror_serving(archive.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    // The data root is the agent's install target *and* the searched root, so an
    // installed version becomes active exactly like in an override deployment.
    let app = TestApp::new(
        dir.path(),
        dir.path().join("data/core"),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        Some(mirror.base()),
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send(
            "POST",
            &format!("/api/v1/packages/{}/install", common::VERSION),
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let request_id = res
        .headers()
        .get("x-request-id")
        .expect("non-GET responses carry x-request-id")
        .to_str()
        .unwrap()
        .to_string();
    let task_id = common::json_body(res).await["taskId"]
        .as_str()
        .expect("202 carries the task id")
        .to_string();
    assert_eq!(
        task_id, "9.9.9-1",
        "ids drop the v prefix and carry a sequence"
    );

    let view = common::wait_finished(&app, &cookie, &task_id).await;
    assert_eq!(view["state"], "done");
    assert!(view["error"].is_null());
    assert_eq!(view["version"], common::VERSION);
    assert_eq!(view["total"], json!(archive.len()));

    let res = app
        .send("GET", "/api/v1/packages", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = common::json_body(res).await;

    let installed = body["installed"].as_array().unwrap();
    assert_eq!(installed.len(), 1, "one version installed: {body}");
    assert_eq!(installed[0]["version"], common::VERSION);
    assert_eq!(installed[0]["builtin"], false);
    assert_eq!(installed[0]["hasCore"], true);
    assert_eq!(installed[0]["hasCli"], true);
    let path = installed[0]["path"].as_str().unwrap();
    assert!(
        path.ends_with(&format!("data/core/{}", common::VERSION)),
        "path must be the data root: {path}"
    );
    assert_eq!(body["active"], common::VERSION);
    assert_eq!(body["available"][0]["version"], common::VERSION);
    assert_eq!(body["available"][0]["installed"], true);

    // The mirror is a plain prefix in front of the official URL.
    let hits = mirror.hits();
    assert_eq!(hits.len(), 1, "{hits:?}");
    assert!(
        hits[0].starts_with("/https://github.com/EasyTier/EasyTier/releases/download/v9.9.9/"),
        "unexpected mirror path: {}",
        hits[0]
    );

    // Starting a task is audited once, with the version and task id only.
    let entries = app.audit_entries(1).await;
    let installs: Vec<&serde_json::Value> = entries
        .iter()
        .filter(|entry| entry["event"] == "package.install")
        .collect();
    assert_eq!(
        installs.len(),
        1,
        "one install, one audit line: {entries:?}"
    );
    assert_eq!(installs[0]["requestId"], request_id.as_str());
    assert_eq!(installs[0]["details"]["version"], common::VERSION);
    assert_eq!(installs[0]["details"]["taskId"], task_id);
    assert_eq!(
        installs[0]["details"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        ["taskId", "version"],
        "audit details stay minimal (no TOML, no credentials)"
    );

    // Cancelling a finished task is a no-op that still answers with a snapshot.
    let res = app
        .send(
            "POST",
            &format!("/api/v1/packages/tasks/{task_id}/cancel"),
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(common::json_body(res).await["state"], "done");
}

#[tokio::test]
async fn delete_refuses_the_active_version_while_an_instance_runs() {
    let archive = common::kernel_zip();
    let mirror = common::mirror_serving(archive.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("data/core");
    let app = TestApp::new(
        dir.path(),
        root.clone(),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        Some(mirror.base()),
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send(
            "POST",
            &format!("/api/v1/packages/{}/install", common::VERSION),
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let task_id = common::json_body(res).await["taskId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        common::wait_finished(&app, &cookie, &task_id).await["state"],
        "done"
    );

    // The installed kernel is a fake core that idles, so it backs a real instance.
    let res = app
        .send(
            "PUT",
            "/api/v1/configs/home",
            Some(json!({ "toml": "rpc_portal = \"127.0.0.1:15990\"\n" })),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let res = app
        .send(
            "POST",
            "/api/v1/instances/home/start",
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(common::json_body(res).await["running"], true);
    assert!(app.supervisor.snapshot("home").await.running);

    // The active version powers a live instance: refuse, and keep the tree.
    let res = app
        .send(
            "DELETE",
            &format!("/api/v1/packages/{}", common::VERSION),
            None,
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::CONFLICT);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "instance_running"
    );
    assert!(root.join(common::VERSION).is_dir());
    // Nothing is expected to be written, so this read must not wait.
    let entries = app.audit_now();
    assert!(
        entries
            .iter()
            .all(|entry| entry["event"] != "package.delete"),
        "a refused delete must not be audited: {entries:?}"
    );

    let res = app
        .send(
            "POST",
            "/api/v1/instances/home/stop",
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);

    // Nothing runs it any more, so the removal goes through and is audited.
    let res = app
        .send(
            "DELETE",
            &format!("/api/v1/packages/{}", common::VERSION),
            None,
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let delete_request_id = res
        .headers()
        .get("x-request-id")
        .expect("non-GET responses carry x-request-id")
        .to_str()
        .unwrap()
        .to_string();
    assert!(!root.join(common::VERSION).exists());

    let entries = app.audit_entries(2).await;
    let deletes: Vec<&serde_json::Value> = entries
        .iter()
        .filter(|entry| entry["event"] == "package.delete")
        .collect();
    assert_eq!(
        deletes.len(),
        1,
        "only the successful delete is audited: {entries:?}"
    );
    assert_eq!(deletes[0]["requestId"], delete_request_id.as_str());
    assert_eq!(deletes[0]["details"]["version"], common::VERSION);

    let res = app
        .send("GET", "/api/v1/packages", None, Some(&cookie))
        .await;
    let body = common::json_body(res).await;
    assert_eq!(body["installed"], json!([]));
    assert!(body["active"].is_null());
}

#[tokio::test]
async fn delete_refuses_a_builtin_version() {
    let archive = common::kernel_zip();
    let dir = tempfile::tempdir().unwrap();
    let builtin = dir.path().join("builtin");
    // The image (or an operator) placed this version; the agent never did.
    common::write_fake_install(&builtin, common::VERSION);
    let app = TestApp::new(
        dir.path(),
        builtin.clone(),
        builtin.clone(),
        common::manifest_for(&archive),
        None,
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send("GET", "/api/v1/packages", None, Some(&cookie))
        .await;
    let body = common::json_body(res).await;
    assert_eq!(body["installed"][0]["version"], common::VERSION);
    assert_eq!(body["installed"][0]["builtin"], true);
    assert_eq!(body["active"], common::VERSION);

    let res = app
        .send(
            "DELETE",
            &format!("/api/v1/packages/{}", common::VERSION),
            None,
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "builtin_package"
    );
    assert!(
        builtin.join(common::VERSION).is_dir(),
        "the read-only tree is untouched"
    );
}

/// The two refusal paths overlap when the builtin version is also the running
/// one. `403 builtin_package` must win: the refusal is permanent (no instance
/// state can make a read-only version removable), so it is the true answer.
#[tokio::test]
async fn delete_answers_builtin_before_the_running_gate() {
    let archive = common::kernel_zip();
    let dir = tempfile::tempdir().unwrap();
    let builtin = dir.path().join("builtin");
    common::write_fake_install(&builtin, common::VERSION);
    let app = TestApp::new(
        dir.path(),
        builtin.clone(),
        builtin.clone(),
        common::manifest_for(&archive),
        None,
    )
    .await;
    let cookie = app.session().await;

    // A live instance runs the read-only kernel, so both gates apply at once.
    let res = app
        .send(
            "PUT",
            "/api/v1/configs/home",
            Some(json!({ "toml": "rpc_portal = \"127.0.0.1:15991\"\n" })),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let res = app
        .send(
            "POST",
            "/api/v1/instances/home/start",
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert!(app.supervisor.snapshot("home").await.running);

    let res = app
        .send(
            "DELETE",
            &format!("/api/v1/packages/{}", common::VERSION),
            None,
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "builtin_package",
        "the permanent refusal outranks the momentary one"
    );
    assert!(builtin.join(common::VERSION).is_dir());

    let res = app
        .send(
            "POST",
            "/api/v1/instances/home/stop",
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn delete_reports_unknown_and_unsafe_versions() {
    let archive = common::kernel_zip();
    let dir = tempfile::tempdir().unwrap();
    let app = TestApp::new(
        dir.path(),
        empty_root(dir.path()),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        None,
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send("DELETE", "/api/v1/packages/v1.0.0", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(common::json_body(res).await["error"]["code"], "not_found");

    // A traversal attempt stays inside the route and is rejected by the version
    // whitelist instead of touching a path outside `<data>/core`.
    let res = app
        .send("DELETE", "/api/v1/packages/%2E%2E", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert_eq!(common::json_body(res).await["error"]["code"], "invalid_id");
}

#[tokio::test]
async fn failed_install_is_audited_and_never_publishes() {
    let archive = common::kernel_zip();
    let mirror = common::mirror_serving(archive.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("data/core");
    let app = TestApp::new(
        dir.path(),
        root.clone(),
        dir.path().join("builtin"),
        common::broken_manifest(),
        Some(mirror.base()),
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send(
            "POST",
            &format!("/api/v1/packages/{}/install", common::VERSION),
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let task_id = common::json_body(res).await["taskId"]
        .as_str()
        .unwrap()
        .to_string();

    let view = common::wait_finished(&app, &cookie, &task_id).await;
    assert_eq!(view["state"], "failed");
    assert_eq!(view["error"]["code"], "checksum_mismatch");
    assert!(
        !root.join(common::VERSION).exists(),
        "a failed verification publishes nothing"
    );

    // The task finished after the POST was answered, so the pipeline audits it.
    let entries = app.audit_entries(2).await;
    let failures: Vec<&serde_json::Value> = entries
        .iter()
        .filter(|entry| entry["event"] == "package.install_failed")
        .collect();
    assert_eq!(failures.len(), 1, "one failure, one line: {entries:?}");
    assert_eq!(failures[0]["details"]["version"], common::VERSION);
    assert_eq!(failures[0]["details"]["code"], "checksum_mismatch");
    assert!(
        failures[0]["requestId"].is_null(),
        "a background failure has no request of its own: {failures:?}"
    );

    let res = app
        .send("GET", "/api/v1/packages", None, Some(&cookie))
        .await;
    let body = common::json_body(res).await;
    assert_eq!(body["installed"], json!([]));
    assert!(body["active"].is_null());
}

#[tokio::test]
async fn cancel_stops_a_stalled_install_without_auditing_a_failure() {
    // The mirror accepts the connection and goes silent, so the task can only end
    // through `cancel`.
    let mirror = common::mirror_hanging().await;
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("data/core");
    let app = TestApp::new(
        dir.path(),
        root.clone(),
        dir.path().join("builtin"),
        common::manifest_for(&common::kernel_zip()),
        Some(mirror.base()),
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send(
            "POST",
            &format!("/api/v1/packages/{}/install", common::VERSION),
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let task_id = common::json_body(res).await["taskId"]
        .as_str()
        .unwrap()
        .to_string();

    // Cancel a task that is really running, not one that already finished.
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        let res = app
            .send(
                "GET",
                &format!("/api/v1/packages/tasks/{task_id}"),
                None,
                Some(&cookie),
            )
            .await;
        let state = common::json_body(res).await["state"]
            .as_str()
            .unwrap()
            .to_string();
        if state == "downloading" {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "task never reached downloading, last state {state}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let res = app
        .send(
            "POST",
            &format!("/api/v1/packages/tasks/{task_id}/cancel"),
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        common::json_body(res).await["state"],
        "downloading",
        "the worker owns the terminal state"
    );

    let view = common::wait_finished(&app, &cookie, &task_id).await;
    assert_eq!(view["state"], "canceled");
    assert!(view["error"].is_null());
    assert!(!root.join(common::VERSION).exists());

    // A cancellation is the caller's own doing, so it is not a failure to audit.
    tokio::time::sleep(Duration::from_millis(150)).await;
    let entries = app.audit_now();
    assert!(
        entries
            .iter()
            .all(|entry| entry["event"] != "package.install_failed"),
        "a cancelled task is not a failure: {entries:?}"
    );

    let res = app
        .send(
            "POST",
            "/api/v1/packages/tasks/nope/cancel",
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert_eq!(common::json_body(res).await["error"]["code"], "not_found");
}

#[tokio::test]
async fn mirror_probe_rejects_too_many_sources_and_unknown_versions() {
    let archive = common::kernel_zip();
    let dir = tempfile::tempdir().unwrap();
    let app = TestApp::new(
        dir.path(),
        empty_root(dir.path()),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        None,
    )
    .await;
    let cookie = app.session().await;

    let sources: Vec<String> = (0..11).map(|i| format!("https://m{i}.example/")).collect();
    let res = app
        .send(
            "POST",
            "/api/v1/packages/mirror-probe",
            Some(json!({ "sources": sources, "version": common::VERSION })),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "invalid_settings"
    );

    let res = app
        .send(
            "POST",
            "/api/v1/packages/mirror-probe",
            Some(json!({ "sources": [], "version": "v8.8.8" })),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        common::json_body(res).await["error"]["code"],
        "core_version_unsupported"
    );

    // A rejected probe is not an administrator change to audit.
    assert!(app.audit_now().is_empty());
}

#[tokio::test]
async fn mirror_probe_samples_a_live_mirror_and_isolates_bad_prefixes() {
    let archive = common::kernel_zip();
    let mirror = common::mirror_serving(archive.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let app = TestApp::new(
        dir.path(),
        empty_root(dir.path()),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        None,
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send(
            "POST",
            "/api/v1/packages/mirror-probe",
            Some(json!({
                "sources": [mirror.base(), "ftp://bad.example/", "https://user:pass@x.example/"],
                "version": common::VERSION,
            })),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = common::json_body(res).await;
    let results = body["results"].as_array().unwrap();
    assert_eq!(results.len(), 3, "results come back in input order: {body}");
    assert_eq!(results[0]["source"], format!("{}/", mirror.base()));
    assert_eq!(results[0]["ok"], true);
    assert!(results[0]["latencyMs"].is_number());
    assert!(results[0]["speedBytesPerSec"].as_u64().unwrap() > 0);
    assert_eq!(results[1]["ok"], false, "bad scheme fails per source");
    assert!(results[1]["latencyMs"].is_null());
    assert_eq!(results[2]["ok"], false, "credentials fail per source");

    // The server fetched `<prefix>/<official url>`, never a client-supplied URL.
    let hits = mirror.hits();
    assert!(
        hits.iter().all(|path| path
            .starts_with("/https://github.com/EasyTier/EasyTier/releases/download/v9.9.9/")),
        "unexpected probe paths: {hits:?}"
    );

    // The probe is audited with counts only — no prefixes, no credentials.
    let entries = app.audit_entries(1).await;
    let probes: Vec<&serde_json::Value> = entries
        .iter()
        .filter(|entry| entry["event"] == "packages.mirror_probe")
        .collect();
    assert_eq!(probes.len(), 1, "{entries:?}");
    assert_eq!(probes[0]["details"]["version"], common::VERSION);
    assert_eq!(probes[0]["details"]["sources"], 3);
}

#[tokio::test]
async fn settings_mirror_drives_downloads_and_the_env_lock_is_reported() {
    let archive = common::kernel_zip();
    let mirror = common::mirror_serving(archive.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    // No env mirror: the user setting must reach the download pipeline.
    let app = TestApp::new(
        dir.path(),
        dir.path().join("data/core"),
        dir.path().join("builtin"),
        common::manifest_for(&archive),
        None,
    )
    .await;
    let cookie = app.session().await;

    let res = app
        .send(
            "PUT",
            "/api/v1/settings",
            Some(json!({ "coreMirror": mirror.base() })),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .send(
            "POST",
            &format!("/api/v1/packages/{}/install", common::VERSION),
            Some(json!({})),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::ACCEPTED);
    let task_id = common::json_body(res).await["taskId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        common::wait_finished(&app, &cookie, &task_id).await["state"],
        "done"
    );
    let hits = mirror.hits();
    assert_eq!(hits.len(), 1, "the download used the settings mirror: {hits:?}");

    // With `LT_CORE_MIRROR` set the listing reports the lock.
    let locked_dir = tempfile::tempdir().unwrap();
    let locked = TestApp::new(
        locked_dir.path(),
        empty_root(locked_dir.path()),
        locked_dir.path().join("builtin"),
        common::manifest_for(&archive),
        Some(mirror.base()),
    )
    .await;
    let locked_cookie = locked.session().await;
    let res = locked
        .send("GET", "/api/v1/packages", None, Some(&locked_cookie))
        .await;
    assert_eq!(common::json_body(res).await["mirrorLocked"], true);
}
