mod common;

use axum::http::StatusCode;
use common::{json_body, TestApp};

const VALID_CSS: &str = ":root { --theme-bg: #fff; --theme-text: #000; --theme-accent: #333; }";

async fn app(dir: &std::path::Path) -> TestApp {
    TestApp::new(dir, dir.join("core"), dir.join("core"), &[], None).await
}

#[tokio::test]
async fn themes_require_auth() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    // Before setup every protected route answers 428; after setup, a missing
    // cookie is a plain 401.
    let _cookie = app.session().await;
    let res = app.send("GET", "/api/v1/themes", None, None).await;
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn theme_roundtrip_is_audited() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;

    let res = app.send("GET", "/api/v1/themes", None, Some(&cookie)).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(json_body(res).await["themes"].as_array().unwrap().len(), 0);

    let res = app
        .send(
            "POST",
            "/api/v1/themes",
            Some(serde_json::json!({ "name": "ocean", "cssText": VALID_CSS })),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(json_body(res).await["name"], "ocean");

    let res = app
        .send("GET", "/api/v1/themes/ocean", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::OK);
    let body = json_body(res).await;
    assert_eq!(body["cssText"], VALID_CSS);

    let res = app.send("GET", "/api/v1/themes", None, Some(&cookie)).await;
    let body = json_body(res).await;
    assert_eq!(body["themes"][0]["name"], "ocean");

    let res = app
        .send("DELETE", "/api/v1/themes/ocean", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);

    let res = app
        .send("GET", "/api/v1/themes/ocean", None, Some(&cookie))
        .await;
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let entries = app.audit_entries(2).await;
    let events: Vec<&str> = entries
        .iter()
        .filter_map(|entry| entry["event"].as_str())
        .collect();
    assert!(events.contains(&"theme.import"), "{events:?}");
    assert!(events.contains(&"theme.delete"), "{events:?}");
    // The CSS body never reaches the audit trail.
    let raw = std::fs::read_to_string(app.data_dir().join("logs/agent/audit.log")).unwrap();
    assert!(!raw.contains("--theme-bg"), "audit leaked theme CSS");
}

#[tokio::test]
async fn rejects_bad_names_and_css() {
    let dir = tempfile::tempdir().unwrap();
    let app = app(dir.path()).await;
    let cookie = app.session().await;

    let cases = [
        (
            "../escape",
            VALID_CSS,
            StatusCode::BAD_REQUEST,
            "invalid_id",
        ),
        (
            "cream",
            VALID_CSS,
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_theme",
        ),
        (
            "plain",
            "body { color: red }",
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_theme",
        ),
    ];
    for (name, css, status, code) in cases {
        let res = app
            .send(
                "POST",
                "/api/v1/themes",
                Some(serde_json::json!({ "name": name, "cssText": css })),
                Some(&cookie),
            )
            .await;
        assert_eq!(res.status(), status, "{name}");
        assert_eq!(json_body(res).await["error"]["code"], code, "{name}");
    }

    let huge = format!("{VALID_CSS}\n{}", "a".repeat(256 * 1024));
    let res = app
        .send(
            "POST",
            "/api/v1/themes",
            Some(serde_json::json!({ "name": "huge", "cssText": huge })),
            Some(&cookie),
        )
        .await;
    assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(json_body(res).await["error"]["code"], "invalid_theme");
}
