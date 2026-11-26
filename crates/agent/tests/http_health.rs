use std::path::Path;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
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
    // Same core root as the supervisor, so the package listing and a spawn can
    // never disagree about the active kernel.
    let packages = Arc::new(
        lighttier_agent::packages::Packages::new(&cfg.data_dir)
            .with_core_override(Some(dir.join("core"))),
    );
    let logs = Arc::new(lighttier_agent::logs::Logs::new(&cfg.data_dir));
    Arc::new(AppState::new(
        cfg, auth, configs, audit, settings, supervisor, cli, packages, logs,
    ))
}

/// Writes a minimal SPA build into `<dir>/web` (where `LT_WEB_DIR` points) and
/// returns the shell marker the static tests look for in every response.
fn write_web_build(dir: &Path) -> &'static str {
    const INDEX: &str = "<!doctype html><html><body>lt-spa-shell</body></html>";
    let web = dir.join("web");
    std::fs::create_dir_all(web.join("assets")).unwrap();
    std::fs::write(web.join("index.html"), INDEX).unwrap();
    std::fs::write(web.join("assets/app.js"), "console.log('lt-asset');").unwrap();
    INDEX
}

/// Plants a kernel the way the image or an install would:
/// `<root>/<version>/easytier-core`.
fn install_core(root: &Path, version: &str) {
    let dir = root.join(version);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("easytier-core"), "#!/bin/sh\n").unwrap();
}

async fn text_body(response: axum::response::Response) -> String {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8_lossy(&bytes).into_owned()
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
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
async fn static_files_keep_spa_routing_and_cache_policy() {
    let dir = tempfile::tempdir().unwrap();
    let index = write_web_build(dir.path());
    let app = build_router(test_state(dir.path()).await);

    // `/` serves the shell straight from disk, never cached.
    let res = app
        .clone()
        .oneshot(Request::get("/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers()[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-cache");
    assert!(text_body(res).await.contains(index));

    // Extension-less paths are client-side routes: the shell, not a 404.
    for uri in ["/instances", "/config/detail"] {
        let res = app
            .clone()
            .oneshot(Request::get(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "{uri}");
        assert!(
            res.headers()[header::CONTENT_TYPE]
                .to_str()
                .unwrap()
                .starts_with("text/html"),
            "{uri}"
        );
        assert_eq!(res.headers()[header::CACHE_CONTROL], "no-cache", "{uri}");
        assert!(text_body(res).await.contains(index), "{uri}");
    }

    // A dotted path is not a navigation unless the client asks for HTML.
    let res = app
        .clone()
        .oneshot(Request::get("/settings.html").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/settings.html")
                .header(header::ACCEPT, "text/html")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(text_body(res).await.contains(index));

    // Hashed bundles are immutable; a missing bundle is still a real 404.
    let res = app
        .clone()
        .oneshot(Request::get("/assets/app.js").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()[header::CACHE_CONTROL],
        "public, max-age=31536000, immutable"
    );
    assert!(text_body(res).await.contains("lt-asset"));

    let res = app
        .clone()
        .oneshot(
            Request::get("/assets/missing.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert!(res.headers().get(header::CACHE_CONTROL).is_none());

    // API misses are never rewritten to HTML, including non-v1 paths.
    for uri in ["/api/v1/nope", "/api/v2/nope"] {
        let res = app
            .clone()
            .oneshot(Request::get(uri).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{uri}");
        let value = json_body(res).await;
        assert_eq!(value["error"]["code"], "not_found", "{uri}");
    }
}

#[tokio::test]
async fn readyz_reports_installed_core_versions() {
    let dir = tempfile::tempdir().unwrap();
    let core_root = dir.path().join("core");
    install_core(&core_root, "v2.5.0");
    install_core(&core_root, "v2.7.1");
    let app = build_router(test_state(dir.path()).await);

    let res = app
        .oneshot(Request::get("/api/v1/readyz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let value = json_body(res).await;
    assert_eq!(value["ready"], true);
    // Newest first, exactly what `Packages` would offer to spawn.
    assert_eq!(
        value["coreVersions"],
        serde_json::json!(["v2.7.1", "v2.5.0"])
    );
}

#[tokio::test]
async fn static_fallback_keeps_traversal_api_and_method_errors() {
    let dir = tempfile::tempdir().unwrap();
    let index = write_web_build(dir.path());
    let app = build_router(test_state(dir.path()).await);

    // Traversal attempts must never be laundered into the SPA shell, with or
    // without an explicit HTML preference (`Accept: text/html` otherwise counts
    // as a navigation, so both forms are pinned). `%2e%2e` is the encoded form
    // of `..`, which is what a URI actually carries.
    for uri in ["/%2e%2e/data/state/auth.json", "/../x"] {
        for accept_html in [false, true] {
            let mut builder = Request::get(uri);
            if accept_html {
                builder = builder.header(header::ACCEPT, "text/html");
            }
            let res = app
                .clone()
                .oneshot(builder.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(
                res.status(),
                StatusCode::NOT_FOUND,
                "{uri} accept={accept_html}"
            );
            let body = text_body(res).await;
            assert!(
                !body.contains(index),
                "{uri} accept={accept_html} must not return the shell"
            );
        }
    }

    // `/api/` has an empty rest, but it is still an API prefix: JSON 404, not
    // the status page or the shell.
    let res = app
        .clone()
        .oneshot(Request::get("/api/").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    assert!(res.headers()[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .starts_with("application/json"));
    assert_eq!(json_body(res).await["error"]["code"], "not_found");

    // HEAD gets the navigation headers without a payload.
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method("HEAD")
                .uri("/instances")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers()[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .starts_with("text/html"));
    // HEAD drops the payload but must still advertise the exact shell length a
    // GET would carry, so caches and clients cannot mis-size the response.
    assert_eq!(
        res.headers()[header::CONTENT_LENGTH].to_str().unwrap(),
        index.len().to_string(),
        "HEAD /instances must pin content-length to the shell size"
    );
    assert!(
        text_body(res).await.is_empty(),
        "HEAD must not carry a body"
    );

    // A non-GET/HEAD request on a client route is a method error, never a
    // rewrite into the shell.
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/instances")
                .header(header::HOST, "localhost:17800")
                .header(header::ORIGIN, "http://localhost:17800")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::METHOD_NOT_ALLOWED);
}

#[tokio::test]
async fn meta_reports_kernel_features_and_manifest_versions() {
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(test_state(dir.path()).await);

    // No session cookie here on purpose: `/meta` must stay public for the login
    // page to read the kernel offer.
    let res = app
        .oneshot(Request::get("/api/v1/meta").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let value = json_body(res).await;
    assert_eq!(value["features"]["kernel"], true);
    assert_eq!(value["features"]["logs"], true);
    assert_eq!(value["features"]["login"], true);
    assert_eq!(value["features"]["routes"], false);
    // Derived from the manifest itself: a version/channel bump must not require
    // editing this test.
    let expected: Vec<serde_json::Value> = lighttier_agent::packages::LINUX_PACKAGES
        .iter()
        .map(
            |item| serde_json::json!({ "version": item.version, "channel": item.channel.as_str() }),
        )
        .collect();
    assert_eq!(value["coreVersions"], serde_json::Value::Array(expected));
}

#[tokio::test]
async fn status_page_is_bilingual_and_links_the_api() {
    let dir = tempfile::tempdir().unwrap();
    let app = build_router(test_state(dir.path()).await);
    let res = app
        .oneshot(Request::get("/status").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = text_body(res).await;
    assert!(body.contains("LightTier Agent"));
    assert!(body.contains("LightTier agent 运行中 / LightTier agent is running"));
    assert!(body.contains("/api/v1/meta"));
    assert!(
        body.contains("/login"),
        "the status page links the login entry"
    );
    assert!(!body.contains("M1"), "the milestone wording is gone");
}
