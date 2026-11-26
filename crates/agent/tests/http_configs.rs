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
    let configs = Arc::new(Configs::new(&cfg.data_dir));
    let audit = Arc::new(Audit::new(&cfg.data_dir));
    let settings = Arc::new(SettingsStore::load(&cfg.data_dir).await.unwrap());
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
    let cli = Arc::new(CliQuery::new(&cfg.data_dir, Some(dir.join("core"))));
    // Same core root as the supervisor, so the package listing and a spawn can
    // never disagree about the active kernel.
    let packages = Arc::new(
        lighttier_agent::packages::Packages::new(&cfg.data_dir)
            .with_core_override(Some(dir.join("core"))),
    );
    let logs = Arc::new(lighttier_agent::logs::Logs::new(&cfg.data_dir));
    build_router(Arc::new(AppState::new(
        cfg, auth, configs, audit, settings, supervisor, cli, packages, logs,
    )))
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
    // Mutating requests must carry a same-origin `Origin`, even without a body
    // (DELETE), otherwise the CSRF guard rejects them.
    if !matches!(method, "GET" | "HEAD" | "OPTIONS") {
        builder = builder.header(header::ORIGIN, ORIGIN);
    }
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
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

async fn app_with_session(dir: &std::path::Path) -> (axum::Router, String) {
    let app = app(dir).await;
    let token = std::fs::read_to_string(dir.join("state/setup-token"))
        .unwrap()
        .trim()
        .to_string();
    let res = app
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
    (app, cookie_value(&res))
}

async fn json_body(response: axum::response::Response) -> serde_json::Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn config_crud_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;

    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/home",
            Some(serde_json::json!({ "toml": "hostname = \"nas\"\n" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let created = json_body(res).await;
    let hash = created["hash"].as_str().unwrap().to_string();

    let res = app
        .clone()
        .oneshot(request("GET", "/api/v1/configs", None, Some(&session)))
        .await
        .unwrap();
    let list = json_body(res).await;
    assert_eq!(list["configs"][0]["id"], "home");

    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/home",
            Some(serde_json::json!({ "toml": "hostname = \"b\"\n", "expectedHash": "stale" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "conflict_hash");

    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/home",
            Some(serde_json::json!({ "toml": "hostname = \"b\"\n", "expectedHash": hash })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .clone()
        .oneshot(request(
            "POST",
            "/api/v1/configs/home/rename",
            Some(serde_json::json!({ "to": "office" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);

    let res = app
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/configs/office/export",
            None,
            Some(&session),
        ))
        .await
        .unwrap();
    let exported = json_body(res).await;
    assert_eq!(exported["filename"], "office.toml");
    assert_eq!(exported["toml"], "hostname = \"b\"\n");

    let res = app
        .oneshot(request(
            "DELETE",
            "/api/v1/configs/office",
            None,
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn config_routes_require_login() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let res = app
        .oneshot(request("GET", "/api/v1/configs", None, None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PRECONDITION_REQUIRED);
}

#[tokio::test]
async fn import_rejects_invalid_toml() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;
    let res = app
        .oneshot(request(
            "POST",
            "/api/v1/configs/import",
            Some(serde_json::json!({ "filename": "x.toml", "toml": "= broken" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "invalid_toml");
}

#[tokio::test]
async fn config_routes_require_login_once_setup_done() {
    let dir = tempfile::tempdir().unwrap();
    let (app, _session) = app_with_session(dir.path()).await;

    let res = app
        .clone()
        .oneshot(request("GET", "/api/v1/configs", None, None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "auth_required");

    let res = app
        .oneshot(request(
            "PUT",
            "/api/v1/configs/x",
            Some(serde_json::json!({ "toml": "x = 1\n" })),
            None,
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn oversized_config_is_422_and_oversized_body_is_413() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;

    // Above the 1 MiB config guard but below the 2 MiB body limit.
    let over_config = format!("x = \"{}\"\n", "a".repeat(1_100_000));
    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/big",
            Some(serde_json::json!({ "toml": over_config })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "invalid_toml");
    let detail = err["error"]["params"]["detail"]
        .as_str()
        .unwrap_or_default();
    assert!(detail.contains("1 MiB"), "{detail}");

    // Above the 2 MiB body limit: rejected before the handler runs.
    let over_body = format!("x = \"{}\"\n", "a".repeat(2_100_000));
    let res = app
        .oneshot(request(
            "PUT",
            "/api/v1/configs/huge",
            Some(serde_json::json!({ "toml": over_body })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "payload_too_large");
}

#[tokio::test]
async fn missing_configs_are_not_found_and_rename_conflicts() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;

    let res = app
        .clone()
        .oneshot(request(
            "GET",
            "/api/v1/configs/missing",
            None,
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let res = app
        .clone()
        .oneshot(request(
            "DELETE",
            "/api/v1/configs/missing",
            None,
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    for (id, toml) in [("a", "x = 1\n"), ("b", "x = 2\n")] {
        let res = app
            .clone()
            .oneshot(request(
                "PUT",
                &format!("/api/v1/configs/{id}"),
                Some(serde_json::json!({ "toml": toml })),
                Some(&session),
            ))
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }

    let res = app
        .oneshot(request(
            "POST",
            "/api/v1/configs/a/rename",
            Some(serde_json::json!({ "to": "b" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
    let err = json_body(res).await;
    assert_eq!(err["error"]["code"], "config_exists");
}

#[tokio::test]
async fn put_returns_request_id_and_list_hides_backup_files() {
    let dir = tempfile::tempdir().unwrap();
    let (app, session) = app_with_session(dir.path()).await;

    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/home",
            Some(serde_json::json!({ "toml": "hostname = \"a\"\n" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers().get("x-request-id").is_some());

    let res = app
        .clone()
        .oneshot(request(
            "PUT",
            "/api/v1/configs/home",
            Some(serde_json::json!({ "toml": "hostname = \"b\"\n" })),
            Some(&session),
        ))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert!(res.headers().get("x-request-id").is_some());

    // The update left `home.toml.bak` behind; the listing must ignore it.
    let res = app
        .oneshot(request("GET", "/api/v1/configs", None, Some(&session)))
        .await
        .unwrap();
    let list = json_body(res).await;
    let configs = list["configs"].as_array().unwrap();
    assert_eq!(configs.len(), 1);
    assert_eq!(configs[0]["id"], "home");
}
