//! Registry of in-flight kernel install tasks.
//!
//! `install()` returns a task id immediately and finishes the work in a
//! background tokio task, so the HTTP layer can answer 202 and let the UI poll.
//! The registry owns the cancellation token for each task; the install pipeline
//! observes it and is the only writer of terminal states, which keeps `remove`
//! from racing a half-written staging directory.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::error::ApiError;

/// Task accepted, nothing downloaded yet.
pub const QUEUED: &str = "queued";
/// Streaming the archive to `<data>/tmp/<id>/package.zip`.
pub const DOWNLOADING: &str = "downloading";
/// Archive digest and zip structure are being checked.
pub const VERIFYING: &str = "verifying";
/// Entries are being unpacked into the staging directory.
pub const EXTRACTING: &str = "extracting";
/// Staging directory is being renamed into `<data>/core/<version>`.
pub const INSTALLING: &str = "installing";
/// Finished successfully.
pub const DONE: &str = "done";
/// Finished with an error; `error` carries `{code, message}`.
pub const FAILED: &str = "failed";
/// Aborted by [`Tasks::cancel`]; the staging tree was removed.
pub const CANCELED: &str = "canceled";

/// Snapshot of one install task, serialized camelCase for the web UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub id: String,
    pub version: String,
    pub state: &'static str,
    pub downloaded: u64,
    /// `Content-Length` of the archive; a finished task always reports a total.
    pub total: Option<u64>,
    /// `{code, message[, params]}` of the failure, `None` while running or done.
    pub error: Option<Value>,
    /// Unix seconds at which `install()` accepted the task.
    pub started_at: i64,
}

impl TaskView {
    /// True once the task can no longer change state.
    pub fn is_finished(&self) -> bool {
        is_finished(self.state)
    }

    /// True when the pipeline stopped with an error; `error` then carries the
    /// `{code, message[, params]}` object. A cancellation is not a failure.
    pub fn is_failed(&self) -> bool {
        self.state == FAILED
    }
}

struct Entry {
    view: TaskView,
    cancel: CancellationToken,
}

/// All install tasks of this process, including finished ones (bounded by the
/// number of install attempts; ids keep the UI's polling simple).
#[derive(Default)]
pub struct Tasks {
    inner: Mutex<HashMap<String, Entry>>,
    seq: AtomicU64,
}

impl Tasks {
    pub fn new() -> Self {
        Self::default()
    }

    /// Registers a queued task and returns its id and cancellation token. Ids are
    /// `<version without leading v>-<seq>`, so the UI can show progress per
    /// version without a second lookup.
    pub fn create(&self, version: &str) -> (String, CancellationToken) {
        let mut guard = self.lock();
        Self::insert(&mut guard, &self.seq, version)
    }

    /// Registers a queued task unless one for `version` is still running. Check
    /// and insert happen under one lock, so two HTTP requests cannot both start
    /// an install of the same version.
    pub fn create_if_idle(&self, version: &str) -> Option<(String, CancellationToken)> {
        let mut guard = self.lock();
        let busy = guard
            .values()
            .any(|entry| entry.view.version == version && !is_finished(entry.view.state));
        if busy {
            return None;
        }
        Some(Self::insert(&mut guard, &self.seq, version))
    }

    fn insert(
        tasks: &mut HashMap<String, Entry>,
        seq: &AtomicU64,
        version: &str,
    ) -> (String, CancellationToken) {
        let seq = seq.fetch_add(1, Ordering::Relaxed) + 1;
        let id = format!("{}-{seq}", version.trim_start_matches('v'));
        let cancel = CancellationToken::new();
        let view = TaskView {
            id: id.clone(),
            version: version.to_owned(),
            state: QUEUED,
            downloaded: 0,
            total: None,
            error: None,
            started_at: chrono::Utc::now().timestamp(),
        };
        tasks.insert(
            id.clone(),
            Entry {
                view,
                cancel: cancel.clone(),
            },
        );
        (id, cancel)
    }

    /// Mutates a live task; unknown ids (already evicted) are ignored.
    pub fn update(&self, id: &str, f: impl FnOnce(&mut TaskView)) {
        if let Some(entry) = self.lock().get_mut(id) {
            f(&mut entry.view);
        }
    }

    /// Writes a terminal state. The install pipeline calls this exactly once.
    pub fn finish(&self, id: &str, state: &'static str, error: Option<Value>) {
        self.update(id, |view| {
            view.state = state;
            view.error = error;
        });
    }

    pub fn get(&self, id: &str) -> Option<TaskView> {
        self.lock().get(id).map(|entry| entry.view.clone())
    }

    /// Signals cancellation for a running task. A finished task is returned
    /// unchanged: cancelling twice, or cancelling after the kernel landed, is not
    /// an error the UI has to handle.
    pub fn cancel(&self, id: &str) -> Result<TaskView, ApiError> {
        let guard = self.lock();
        let entry = guard.get(id).ok_or(ApiError::NotFound)?;
        if !is_finished(entry.view.state) {
            entry.cancel.cancel();
        }
        Ok(entry.view.clone())
    }

    /// True when a task for `version` has not finished yet.
    pub fn in_progress(&self, version: &str) -> bool {
        self.lock()
            .values()
            .any(|entry| entry.view.version == version && !is_finished(entry.view.state))
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Entry>> {
        // A panicking install task must not take the whole registry down.
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn is_finished(state: &str) -> bool {
    matches!(state, DONE | FAILED | CANCELED)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_returns_version_scoped_ids_and_queued_views() {
        let tasks = Tasks::new();
        let (first, token) = tasks.create("v2.6.4");
        let (second, _) = tasks.create("v2.7.1");
        assert_eq!(first, "2.6.4-1");
        assert_eq!(second, "2.7.1-2");
        assert!(!token.is_cancelled());
        let view = tasks.get(&first).unwrap();
        assert_eq!(view.version, "v2.6.4");
        assert_eq!(view.state, QUEUED);
        assert_eq!(view.downloaded, 0);
        assert_eq!(view.total, None);
        assert!(view.error.is_none());
        assert!(view.started_at > 0);
        assert!(tasks.get("nope").is_none());
    }

    #[test]
    fn update_and_finish_write_through_and_ignore_unknown_ids() {
        let tasks = Tasks::new();
        let (id, _) = tasks.create("v2.6.4");
        tasks.update(&id, |view| {
            view.state = DOWNLOADING;
            view.downloaded = 12;
            view.total = Some(40);
        });
        let view = tasks.get(&id).unwrap();
        assert_eq!(view.state, DOWNLOADING);
        assert_eq!(view.downloaded, 12);
        // Unknown ids are ignored rather than panicking a finished worker.
        tasks.update("missing", |view| view.state = DONE);

        tasks.finish(
            &id,
            FAILED,
            Some(serde_json::json!({ "code": "bad_package" })),
        );
        let view = tasks.get(&id).unwrap();
        assert!(view.is_finished());
        assert_eq!(view.state, FAILED);
        assert_eq!(view.error.unwrap()["code"], "bad_package");
    }

    #[test]
    fn cancel_signals_running_tasks_and_leaves_finished_ones_alone() {
        let tasks = Tasks::new();
        let (running, token) = tasks.create("v2.6.4");
        let view = tasks.cancel(&running).unwrap();
        assert!(token.is_cancelled());
        assert!(!view.is_finished(), "the worker owns the terminal state");

        tasks.finish(&running, CANCELED, None);
        let view = tasks.cancel(&running).unwrap();
        assert_eq!(view.state, CANCELED, "a finished task is returned as-is");

        assert_eq!(tasks.cancel("missing").unwrap_err().code(), "not_found");
    }

    #[test]
    fn in_progress_tracks_versions_until_finished() {
        let tasks = Tasks::new();
        assert!(!tasks.in_progress("v2.6.4"));
        let (id, _) = tasks.create("v2.6.4");
        assert!(tasks.in_progress("v2.6.4"));
        assert!(!tasks.in_progress("v2.7.1"));
        tasks.finish(&id, DONE, None);
        assert!(!tasks.in_progress("v2.6.4"));
    }

    #[test]
    fn create_if_idle_refuses_a_version_that_is_still_running() {
        let tasks = Tasks::new();
        let (id, _) = tasks.create_if_idle("v2.6.4").unwrap();
        assert!(tasks.create_if_idle("v2.6.4").is_none());
        // Versions are independent of each other.
        let (other, _) = tasks.create_if_idle("v2.7.1").unwrap();
        assert_ne!(id, other);
        // A finished task frees the version for a retry.
        tasks.finish(&id, FAILED, None);
        assert!(tasks.create_if_idle("v2.6.4").is_some());
    }

    #[test]
    fn task_view_serializes_camel_case_with_a_static_state() {
        let tasks = Tasks::new();
        let (id, _) = tasks.create("v2.6.4");
        let json = serde_json::to_value(tasks.get(&id).unwrap()).unwrap();
        assert_eq!(json["state"], "queued");
        assert!(json["startedAt"].is_number());
        assert!(json.get("started_at").is_none());
        assert!(json["total"].is_null());
    }
}
