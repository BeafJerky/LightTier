//! `GET/POST /api/v1/themes` and `GET/DELETE /api/v1/themes/{name}`.

use std::sync::Arc;

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ApiError;
use crate::http::{AppState, RequestId};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTheme {
    pub name: String,
    pub css_text: String,
}

pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let themes = state.themes.list().await?;
    Ok(Json(json!({ "themes": themes })))
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let document = state.themes.read(&name).await?;
    Ok(Json(json!(document)))
}

pub async fn save(
    State(state): State<Arc<AppState>>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<SaveTheme>,
) -> Result<Json<Value>, ApiError> {
    let entry = state.themes.save(&body.name, &body.css_text).await?;
    state
        .audit
        .record(
            "theme.import",
            Some(&request_id.0),
            json!({ "name": entry.name, "size": entry.size }),
        )
        .await;
    Ok(Json(json!(entry)))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<StatusCode, ApiError> {
    state.themes.delete(&name).await?;
    state
        .audit
        .record("theme.delete", Some(&request_id.0), json!({ "name": name }))
        .await;
    Ok(StatusCode::NO_CONTENT)
}
