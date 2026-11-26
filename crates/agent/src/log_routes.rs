//! `GET /api/v1/logs`, `GET /api/v1/logs/{*name}` and `DELETE /api/v1/logs`.
//!
//! Reading is a tail, not a download: the handler returns text, never JSON, and
//! the name whitelist lives in [`crate::logs`] so a request can only reach a
//! log the agent itself wrote.

use std::sync::Arc;

use axum::extract::{Extension, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::error::ApiError;
use crate::http::{AppState, RequestId};
use crate::logs::{LogList, DEFAULT_TAIL_LINES};

#[derive(Deserialize)]
pub struct TailQuery {
    /// Missing means [`DEFAULT_TAIL_LINES`]; a non-numeric value is a `400`.
    pub tail: Option<usize>,
}

/// `GET /api/v1/logs` — what exists on disk, grouped by writer.
pub async fn list(State(state): State<Arc<AppState>>) -> Result<Json<LogList>, ApiError> {
    Ok(Json(state.logs.list().await?))
}

/// `GET /api/v1/logs/{*name}?tail=N` — the last `N` lines, `text/plain`.
pub async fn read(
    State(state): State<Arc<AppState>>,
    Path(name): Path<String>,
    Query(query): Query<TailQuery>,
) -> Result<Response, ApiError> {
    let tail = query.tail.unwrap_or(DEFAULT_TAIL_LINES);
    let body = state.logs.tail(&name, tail).await?;
    // The body is a log excerpt: never let a browser sniff it into markup, and
    // never let a proxy or the disk cache keep a copy of a kernel's output.
    Ok((
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response())
}

/// `DELETE /api/v1/logs` — empties the agent log and every kernel log file in
/// place (the writers hold them open, so truncating is what actually reclaims
/// the space); the audit trail survives by design, and so do the directories.
pub async fn clear(
    State(state): State<Arc<AppState>>,
    Extension(request_id): Extension<RequestId>,
) -> Result<StatusCode, ApiError> {
    state.logs.clear().await?;
    // Recorded only after the log files are actually empty: a failed clear must
    // not claim success in the audit trail. The audit line is written into the
    // same directory tree that was just emptied, which is fine — `audit.log` is
    // never touched.
    tracing::warn!("log files cleared");
    state
        .audit
        .record("logs.clear", Some(&request_id.0), json!({}))
        .await;
    Ok(StatusCode::NO_CONTENT)
}
