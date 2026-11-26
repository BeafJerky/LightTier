//! Kernel package endpoints: what is installed, what the manifest offers, and
//! the install/remove entry points.
//!
//! Everything that needs both sides of the system lives here: `packages` knows
//! the filesystem and the resolver, `supervisor` knows which instances run, and
//! `audit` records what an administrator changed. The install pipeline itself is
//! asynchronous, so a failure is reported through [`install_audit_hook`] instead
//! of the request that started it.

use std::sync::Arc;

use axum::extract::{Extension, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};

use crate::audit::Audit;
use crate::error::ApiError;
use crate::http::{AppState, RequestId};
use crate::packages::{InstalledPackage, TaskView};

/// One kernel version on disk, camelCase for the web UI.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstalledView {
    version: String,
    /// Directory holding the binaries; a lossy string because the API is JSON and
    /// a path that is not valid UTF-8 must not fail the whole listing.
    path: String,
    builtin: bool,
    has_core: bool,
    has_cli: bool,
}

impl From<InstalledPackage> for InstalledView {
    fn from(item: InstalledPackage) -> Self {
        Self {
            version: item.version,
            path: item.path.to_string_lossy().into_owned(),
            builtin: item.builtin,
            has_core: item.has_core,
            has_cli: item.has_cli,
        }
    }
}

/// One manifest entry as the UI offers it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AvailableView {
    version: &'static str,
    channel: &'static str,
    installed: bool,
}

/// `GET /api/v1/packages` — installed versions, installable releases, the version
/// the supervisor would start right now (`null` when none resolves), and whether
/// this deployment may install at all (`installAllowed` is false under an
/// `LT_CORE_DIR` override, where installs would land in an unscanned root).
pub async fn list(State(state): State<Arc<AppState>>) -> Json<Value> {
    let installed = state.packages.list_installed();
    let present: Vec<&str> = installed.iter().map(|item| item.version.as_str()).collect();
    let available: Vec<AvailableView> = state
        .packages
        .manifest()
        .iter()
        .map(|pkg| AvailableView {
            version: pkg.version,
            channel: pkg.channel.as_str(),
            installed: present.contains(&pkg.version),
        })
        .collect();
    Json(json!({
        "installed": installed.into_iter().map(InstalledView::from).collect::<Vec<_>>(),
        "available": available,
        "active": state.packages.active_version(),
        "installAllowed": state.packages.install_allowed(),
    }))
}

/// `POST /api/v1/packages/{version}/install` — starts the download/verify task
/// and answers `202` with its id; the UI polls `GET .../tasks/{id}`. Under a
/// `LT_CORE_DIR` override the pipeline answers `409 core_override_read_only`
/// instead, because the published tree would never be scanned.
pub async fn install(
    State(state): State<Arc<AppState>>,
    Path(version): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<Response, ApiError> {
    let task_id = state.packages.install(&version).await?;
    state
        .audit
        .record(
            "package.install",
            Some(&request_id.0),
            json!({ "version": version, "taskId": task_id }),
        )
        .await;
    Ok((StatusCode::ACCEPTED, Json(json!({ "taskId": task_id }))).into_response())
}

/// `GET /api/v1/packages/tasks/{id}` — progress snapshot of one install task.
pub async fn task(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<TaskView>, ApiError> {
    state.packages.task(&id).map(Json).ok_or(ApiError::NotFound)
}

/// `POST /api/v1/packages/tasks/{id}/cancel` — signals the running task; a
/// finished task is returned unchanged.
pub async fn cancel(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<TaskView>, ApiError> {
    Ok(Json(state.packages.cancel(&id)?))
}

/// `DELETE /api/v1/packages/{version}` — removes an agent-installed version.
///
/// Precedence, and why: a version that only exists under the read-only root is
/// `403 builtin_package` first, because that answers *what the request is*, not
/// what happens to be running (the refusal is permanent, so the state of the
/// world cannot change it). Only then does the running gate apply: the tree may
/// not be pulled from under a live kernel, so deleting the active version while
/// any instance is up is a `409 instance_running`.
///
/// The gate and the removal run inside [`Supervisor::exclusive_start`], the same
/// barrier `start`/`stop`/`restart` hold. Without it a concurrent start (or the
/// autostart pass) could spawn between the running check and `remove`, leaving a
/// process whose kernel binary was deleted. This rule needs both `packages` and
/// `supervisor`, which is why it lives here and not in `packages::remove`.
pub async fn delete(
    State(state): State<Arc<AppState>>,
    Path(version): Path<String>,
    Extension(request_id): Extension<RequestId>,
) -> Result<StatusCode, ApiError> {
    if state.packages.is_builtin_only(&version) {
        return Err(ApiError::BuiltinPackage);
    }
    {
        let _barrier = state.supervisor.exclusive_start().await;
        // Anything read before the acquisition is stale by now: a start may have
        // registered a running instance while this request waited for the lock.
        if state.packages.active_version().as_deref() == Some(version.as_str()) {
            let running = state
                .supervisor
                .snapshots()
                .await?
                .iter()
                .any(|instance| instance.running);
            if running {
                return Err(ApiError::InstanceRunning);
            }
        }
        state.packages.remove(&version).await?;
    }
    // The barrier is released before the audit append and the response: holding
    // it across unrelated I/O would stall every instance operation behind a slow
    // disk (or a slow client).
    //
    // Deleting a kernel version is never routine: keep a warning-level trace
    // next to the audit line.
    tracing::warn!(version = %version, "kernel package removed");
    state
        .audit
        .record(
            "package.delete",
            Some(&request_id.0),
            json!({ "version": version }),
        )
        .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Terminal-state observer for [`crate::packages::Packages::on_finish`].
///
/// An install finishes long after `POST .../install` answered `202`, so the
/// pipeline is the only place that still knows a download or a checksum failed.
/// Only `failed` tasks are audited (a cancellation is the caller's own doing),
/// and the write runs on its own task so the pipeline never waits for the disk.
pub fn install_audit_hook(audit: Arc<Audit>) -> impl Fn(&TaskView) + Send + Sync + 'static {
    move |view: &TaskView| {
        if !view.is_failed() {
            return;
        }
        let code = view
            .error
            .as_ref()
            .and_then(|error| error["code"].as_str())
            .unwrap_or("internal")
            .to_owned();
        let version = view.version.clone();
        tracing::warn!(%version, %code, "kernel package install failed");
        let audit = audit.clone();
        tokio::spawn(async move {
            audit
                .record(
                    "package.install_failed",
                    None,
                    json!({ "version": version, "code": code }),
                )
                .await;
        });
    }
}
