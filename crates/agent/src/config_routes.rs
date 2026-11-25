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
pub struct PutConfig {
    pub toml: String,
    #[serde(default)]
    pub expected_hash: Option<String>,
}

#[derive(Deserialize)]
pub struct RenameConfig {
    pub to: String,
}

#[derive(Deserialize)]
pub struct ImportConfig {
    pub filename: String,
    pub toml: String,
}

pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<Value>, ApiError> {
    let configs = state.configs.list().await?;
    Ok(Json(json!({ "configs": configs })))
}

pub async fn get(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let document = state.configs.get(&id).await?;
    Ok(Json(json!(document)))
}

pub async fn put(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<PutConfig>,
) -> Result<Json<Value>, ApiError> {
    let (hash, created) = state
        .configs
        .put(&id, &body.toml, body.expected_hash.as_deref())
        .await?;
    let event = if created {
        "config.create"
    } else {
        "config.update"
    };
    state
        .audit
        .record(event, Some(&request_id.0), json!({ "id": id }))
        .await;
    Ok(Json(json!({ "id": id, "hash": hash })))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<StatusCode, ApiError> {
    state.configs.delete(&id).await?;
    state
        .audit
        .record("config.delete", Some(&request_id.0), json!({ "id": id }))
        .await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn rename(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<RenameConfig>,
) -> Result<Json<Value>, ApiError> {
    let to = body.to;
    let hash = state.configs.rename(&id, &to).await?;
    state
        .audit
        .record(
            "config.rename",
            Some(&request_id.0),
            json!({ "id": id, "to": to }),
        )
        .await;
    Ok(Json(json!({ "id": to, "hash": hash })))
}

pub async fn import(
    State(state): State<Arc<AppState>>,
    Extension(request_id): Extension<RequestId>,
    Json(body): Json<ImportConfig>,
) -> Result<Json<Value>, ApiError> {
    let entry = state.configs.import(&body.filename, &body.toml).await?;
    state
        .audit
        .record(
            "config.import",
            Some(&request_id.0),
            json!({ "id": entry.id }),
        )
        .await;
    Ok(Json(json!(entry)))
}

pub async fn export(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let document = state.configs.export(&id).await?;
    Ok(Json(json!({
        "filename": format!("{}.toml", document.id),
        "toml": document.toml,
    })))
}
