//! Fixtures shared by the kernel-package HTTP tests: a self-made release
//! archive, a matching `'static` manifest, a local mirror that serves it, and
//! the app harness (state + session cookie + request/audit helpers).
//!
//! Everything is built in-process on purpose: the real releases are ~30 MiB and
//! the gate must run without network access.

#![allow(dead_code)] // each test binary compiles this module on its own

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use lighttier_agent::audit::Audit;
use lighttier_agent::auth::AuthStore;
use lighttier_agent::cli::CliQuery;
use lighttier_agent::config::AgentConfig;
use lighttier_agent::configs::Configs;
use lighttier_agent::http::{build_router, AppState};
use lighttier_agent::logs::Logs;
use lighttier_agent::package_routes;
use lighttier_agent::packages::{Channel, LinuxPackage, Packages};
use lighttier_agent::settings::SettingsStore;
use lighttier_agent::supervisor::Supervisor;
use sha2::{Digest, Sha256};
use tower::ServiceExt;

/// Origin the harness sends on writes so the same-origin guard lets them through
/// (the tests are about packages, not CSRF).
pub const ORIGIN: &str = "http://localhost:17800";

/// Version the fixture manifest publishes.
pub const VERSION: &str = "v9.9.9";

/// Stands in for `easytier-core`: it ignores every argument, stays alive until
/// SIGTERM, and can therefore back a *running* instance in the delete-gate test.
pub const CORE_BODY: &[u8] = b"#!/bin/sh\ntrap 'exit 0' TERM\nwhile true; do sleep 0.1; done\n";
/// Stands in for `easytier-cli`.
pub const CLI_BODY: &[u8] = b"#!/bin/sh\necho cli\n";

pub fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// Builds a deflated zip in memory; the archive never touches the disk here.
pub fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(cursor);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for (name, body) in entries {
        writer.start_file(*name, options).unwrap();
        std::io::Write::write_all(&mut writer, body).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

/// The release archive every test installs.
pub fn kernel_zip() -> Vec<u8> {
    build_zip(&[("easytier-core", CORE_BODY), ("easytier-cli", CLI_BODY)])
}

/// Leaks a manifest whose digests match the in-test archive, which is the only
/// way to satisfy the `'static` release table the installer reads.
pub fn manifest_for(archive: &[u8]) -> &'static [LinuxPackage] {
    static_manifest(sha256(archive), sha256(CORE_BODY), sha256(CLI_BODY))
}

/// A manifest that claims a different archive: the download succeeds, the
/// verification fails, and the task ends `failed`.
pub fn broken_manifest() -> &'static [LinuxPackage] {
    static_manifest("0".repeat(64), sha256(CORE_BODY), sha256(CLI_BODY))
}

fn static_manifest(package: String, core: String, cli: String) -> &'static [LinuxPackage] {
    Box::leak(Box::new(vec![LinuxPackage {
        version: VERSION,
        channel: Channel::Prerelease,
        package: Box::leak(package.into_boxed_str()),
        core: Box::leak(core.into_boxed_str()),
        cli: Box::leak(cli.into_boxed_str()),
    }]))
}

/// Points a root at a hand-written kernel, so a test can present a version the
/// agent never installed itself (the read-only "image" layout).
pub fn write_fake_install(root: &Path, version: &str) {
    let dir = root.join(version);
    std::fs::create_dir_all(&dir).unwrap();
    let core = dir.join("easytier-core");
    std::fs::write(&core, CORE_BODY).unwrap();
    std::fs::set_permissions(&core, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// Local stand-in for the release mirror.
pub struct Mirror {
    base: String,
    hits: Arc<Mutex<Vec<String>>>,
}

impl Mirror {
    /// Prefix the installer should prepend, i.e. `LT_CORE_MIRROR`.
    pub fn base(&self) -> String {
        self.base.clone()
    }

    /// Request paths the installer asked for.
    pub fn hits(&self) -> Vec<String> {
        self.hits.lock().unwrap().clone()
    }
}

/// Serves `body` on every path: the mirror keeps the official URL as its path
/// (`/https://github.com/...`), so matching a route would be brittle and
/// pointless here.
pub async fn mirror_serving(body: Vec<u8>) -> Mirror {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let hits = Arc::new(Mutex::new(Vec::new()));
    let seen = hits.clone();
    let router = axum::Router::new().fallback(move |request: axum::extract::Request| {
        let body = body.clone();
        let seen = seen.clone();
        async move {
            seen.lock().unwrap().push(request.uri().path().to_owned());
            ([(header::CONTENT_TYPE, "application/zip")], body)
        }
    });
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    Mirror { base, hits }
}

/// Accepts connections and never answers, so an install task stays in
/// `downloading` until the test cancels it.
pub async fn mirror_hanging() -> Mirror {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let hits = Arc::new(Mutex::new(Vec::new()));
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            // Holding the socket open (no header, no body) is exactly a stalled
            // mirror; the runtime aborts the task when the test ends.
            tokio::spawn(async move {
                let _held = stream;
                tokio::time::sleep(Duration::from_secs(30)).await;
            });
        }
    });
    Mirror { base, hits }
}

/// The whole agent behind one router, plus what a test needs to inspect it.
pub struct TestApp {
    pub router: axum::Router,
    pub supervisor: Arc<Supervisor>,
    data_dir: PathBuf,
}

impl TestApp {
    /// Builds the app with one core root and one explicit read-only root.
    ///
    /// The root is given to *both* the supervisor and `Packages`, so a version
    /// reported as `active` is exactly the binary a spawn would run. The real
    /// `/opt/lighttier/core` is never scanned, so a kernel packaged on the host
    /// cannot change a test's result.
    pub async fn new(
        dir: &Path,
        core_root: PathBuf,
        builtin_dir: PathBuf,
        manifest: &'static [LinuxPackage],
        mirror: Option<String>,
    ) -> Self {
        Self::assemble(dir, core_root, builtin_dir, manifest, mirror, false).await
    }

    /// Same harness with `Packages` built the way `lib.rs` builds it under
    /// `LT_CORE_DIR`: the override *replaces* the scanned list and becomes the
    /// read-only root. Installs are refused in that layout (`installAllowed:
    /// false`), because the publish target `<data>/core` is never scanned.
    pub async fn new_with_override(
        dir: &Path,
        core_root: PathBuf,
        manifest: &'static [LinuxPackage],
    ) -> Self {
        let builtin_dir = core_root.clone();
        Self::assemble(dir, core_root, builtin_dir, manifest, None, true).await
    }

    async fn assemble(
        dir: &Path,
        core_root: PathBuf,
        builtin_dir: PathBuf,
        manifest: &'static [LinuxPackage],
        mirror: Option<String>,
        override_active: bool,
    ) -> Self {
        let cfg = AgentConfig::from_pairs(vec![
            (
                "LT_DATA_DIR".to_string(),
                dir.join("data").display().to_string(),
            ),
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
                Some(core_root.clone()),
                configs.clone(),
                settings.clone(),
            )
            .await
            .unwrap(),
        );
        let cli = Arc::new(CliQuery::new(&cfg.data_dir, Some(core_root.clone())));
        let logs = Arc::new(Logs::new(&cfg.data_dir));
        // Two layouts, one switch: the explicit scan list shared with the
        // supervisor (what the other tests need), or the `LT_CORE_DIR` shape in
        // which the override replaces that list and owns the read-only root.
        let scanner = if override_active {
            Packages::with_manifest(&cfg.data_dir, builtin_dir, manifest)
                .with_core_override(Some(core_root.clone()))
        } else {
            Packages::with_roots(&cfg.data_dir, builtin_dir, vec![core_root], manifest)
        };
        // Wiring the audit hook here mirrors `lib.rs`: a background install
        // failure has no request left to report to, so it is audited by the
        // pipeline's terminal notification. The settings closure mirrors it too:
        // downloads read the *current* mirror setting, the env lock still wins.
        let mirror_settings = settings.clone();
        let packages = Arc::new(
            scanner
                .with_mirror(mirror)
                .with_settings_mirror(move || mirror_settings.core_mirror())
                .on_finish(package_routes::install_audit_hook(audit.clone())),
        );
        Self {
            router: build_router(Arc::new(AppState::new(
                cfg,
                auth,
                configs,
                audit,
                settings,
                supervisor.clone(),
                cli,
                packages,
                logs,
            ))),
            supervisor,
            data_dir: dir.join("data"),
        }
    }

    /// `<dir>/data`: where the app keeps state, configs and logs. Tests that
    /// plant log files need it, since `AppState` only exposes the readers.
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Runs the first-time setup and returns the session cookie.
    pub async fn session(&self) -> String {
        let token = std::fs::read_to_string(self.data_dir.join("state/setup-token"))
            .unwrap()
            .trim()
            .to_string();
        let res = self
            .send(
                "POST",
                "/api/v1/auth/setup",
                Some(serde_json::json!({ "token": token, "password": "long-enough-pw" })),
                None,
            )
            .await;
        assert_eq!(res.status(), StatusCode::NO_CONTENT);
        cookie_value(&res)
    }

    /// Issues one API request. Writes always carry a same-origin `Origin`; the
    /// caller decides whether a body and a session cookie are present.
    pub async fn send(
        &self,
        method: &str,
        uri: &str,
        body: Option<serde_json::Value>,
        cookie: Option<&str>,
    ) -> axum::response::Response {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "localhost:17800");
        if body.is_some() {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
        }
        if method != "GET" {
            builder = builder.header(header::ORIGIN, ORIGIN);
        }
        if let Some(cookie) = cookie {
            builder = builder.header(header::COOKIE, format!("lt_session={cookie}"));
        }
        let body = body
            .map(|value| Body::from(value.to_string()))
            .unwrap_or_else(Body::empty);
        self.router
            .clone()
            .oneshot(builder.body(body).unwrap())
            .await
            .unwrap()
    }

    /// Parsed JSONL records of the audit log as they are on disk right now,
    /// *without* waiting. Use it for "nothing was written" assertions:
    /// [`Self::audit_entries`] would sit out its whole deadline when the expected
    /// lines never appear, which turned every negative check into five seconds.
    pub fn audit_now(&self) -> Vec<serde_json::Value> {
        audit_records(&self.data_dir)
    }

    /// Parsed JSONL records of the audit log, waiting (briefly) for `min_lines`.
    pub async fn audit_entries(&self, min_lines: usize) -> Vec<serde_json::Value> {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            let entries = audit_records(&self.data_dir);
            if entries.len() >= min_lines || std::time::Instant::now() >= deadline {
                return entries;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
}

/// Reads and parses whatever the audit log holds at this instant.
fn audit_records(data_dir: &Path) -> Vec<serde_json::Value> {
    let path = data_dir.join("logs/agent/audit.log");
    std::fs::read_to_string(&path)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).expect("audit lines are JSON"))
        .collect()
}

pub fn cookie_value(response: &axum::response::Response) -> String {
    response
        .headers()
        .get(header::SET_COOKIE)
        .expect("setup answers with a session cookie")
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .trim_start_matches("lt_session=")
        .to_string()
}

pub async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

/// Raw body as text: `GET /logs/{name}` answers `text/plain`, not JSON.
pub async fn text_body(response: axum::response::Response) -> String {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Polls one task through the API until it reaches a terminal state. The install
/// runs in-process against a local mirror, so this returns in milliseconds; the
/// deadline only turns a hang into a readable failure.
pub async fn wait_finished(app: &TestApp, cookie: &str, task_id: &str) -> serde_json::Value {
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    loop {
        let res = app
            .send(
                "GET",
                &format!("/api/v1/packages/tasks/{task_id}"),
                None,
                Some(cookie),
            )
            .await;
        assert_eq!(res.status(), StatusCode::OK, "task snapshot must be served");
        let view = json_body(res).await;
        let state = view["state"].as_str().unwrap_or_default().to_owned();
        if matches!(state.as_str(), "done" | "failed" | "canceled") {
            return view;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "task {task_id} did not finish: {view}"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}
