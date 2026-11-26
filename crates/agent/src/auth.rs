use std::collections::HashMap;
use std::path::PathBuf;

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::distributions::Alphanumeric;
use rand::rngs::OsRng;
use rand::{Rng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{Mutex, RwLock};

use crate::config::AgentConfig;
use crate::error::ApiError;
use crate::storage;

const MIN_PASSWORD_LEN: usize = 10;
const SLIDING_SECS: i64 = 7 * 86_400;
const ABSOLUTE_SECS: i64 = 30 * 86_400;
const MAX_ATTEMPTS: u32 = 5;
const ATTEMPT_WINDOW_SECS: i64 = 60;

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub created_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AuthFile {
    #[serde(rename = "passwordHash")]
    password_hash: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionRecord {
    #[serde(rename = "createdAt")]
    created_at: i64,
    #[serde(rename = "lastSeenAt")]
    last_seen_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct SessionsFile {
    sessions: HashMap<String, SessionRecord>,
}

#[derive(Debug, Default)]
struct AuthInner {
    password_hash: Option<String>,
    setup_token: Option<String>,
    sessions: HashMap<String, SessionRecord>,
}

#[derive(Debug, Default)]
struct RateLimiter {
    entries: HashMap<String, Attempt>,
}

#[derive(Debug)]
struct Attempt {
    count: u32,
    window_start: i64,
}

impl RateLimiter {
    fn allowed(&self, key: &str, now: i64) -> bool {
        match self.entries.get(key) {
            None => true,
            Some(attempt) if now - attempt.window_start >= ATTEMPT_WINDOW_SECS => true,
            Some(attempt) => attempt.count < MAX_ATTEMPTS,
        }
    }

    fn record_failure(&mut self, key: &str, now: i64) {
        let attempt = self.entries.entry(key.to_string()).or_insert(Attempt {
            count: 0,
            window_start: now,
        });
        if now - attempt.window_start >= ATTEMPT_WINDOW_SECS {
            attempt.count = 0;
            attempt.window_start = now;
        }
        attempt.count += 1;
    }

    fn clear(&mut self, key: &str) {
        self.entries.remove(key);
    }
}

pub struct AuthStore {
    inner: RwLock<AuthInner>,
    limiter: Mutex<RateLimiter>,
    /// Serializes snapshot+write so an older snapshot can never be written
    /// after a newer one. Lock order: limiter -> persist -> inner.
    persist: Mutex<()>,
    auth_path: PathBuf,
    sessions_path: PathBuf,
    setup_token_path: PathBuf,
    cookie_secure: bool,
}

impl AuthStore {
    pub async fn load(cfg: &AgentConfig) -> std::io::Result<Self> {
        let state_dir = cfg.data_dir.join("state");
        storage::ensure_dir(&state_dir).await?;
        let auth_path = state_dir.join("auth.json");
        let sessions_path = state_dir.join("sessions.json");
        let setup_token_path = state_dir.join("setup-token");

        let auth_file: AuthFile = storage::read_json_or_default(&auth_path).await?;
        let sessions_file: SessionsFile = storage::read_json_or_default(&sessions_path).await?;

        let mut setup_token = None;
        if auth_file.password_hash.is_none() {
            let token = match tokio::fs::read_to_string(&setup_token_path).await {
                Ok(existing) if existing.trim().len() == 8 => existing.trim().to_string(),
                _ => {
                    let token = generate_setup_token();
                    tokio::fs::write(&setup_token_path, format!("{token}\n")).await?;
                    token
                }
            };
            tracing::warn!(setup_token = %token, "administrator setup token generated");
            setup_token = Some(token);
        }

        Ok(Self {
            inner: RwLock::new(AuthInner {
                password_hash: auth_file.password_hash,
                setup_token,
                sessions: sessions_file.sessions,
            }),
            limiter: Mutex::new(RateLimiter::default()),
            persist: Mutex::new(()),
            auth_path,
            sessions_path,
            setup_token_path,
            cookie_secure: cfg.cookie_secure,
        })
    }

    pub fn cookie_secure(&self) -> bool {
        self.cookie_secure
    }

    pub async fn setup_required(&self) -> bool {
        self.inner.read().await.password_hash.is_none()
    }

    pub async fn setup_token(&self) -> Option<String> {
        self.inner.read().await.setup_token.clone()
    }

    pub async fn setup(&self, token: &str, password: &str, now: i64) -> Result<String, ApiError> {
        {
            let limiter = self.limiter.lock().await;
            if !limiter.allowed("__setup__", now) {
                return Err(ApiError::AuthRateLimited);
            }
        }
        if password.chars().count() < MIN_PASSWORD_LEN {
            return Err(ApiError::AuthInvalid);
        }
        let persist_guard = self.persist.lock().await;
        let mut inner = self.inner.write().await;
        if inner.password_hash.is_some() {
            return Err(ApiError::AlreadyInitialized);
        }
        if inner.setup_token.as_deref() != Some(token) {
            drop(inner);
            // Release `persist` before touching the limiter so the lock order
            // stays limiter -> persist -> inner (never inverted).
            drop(persist_guard);
            self.limiter.lock().await.record_failure("__setup__", now);
            return Err(ApiError::AuthInvalid);
        }
        let hash = hash_password(password)?;
        inner.password_hash = Some(hash.clone());
        inner.setup_token = None;
        let raw = create_session(&mut inner, now);
        let sessions = sessions_snapshot(&inner);
        drop(inner);

        storage::write_json_atomic(
            &self.auth_path,
            &AuthFile {
                password_hash: Some(hash),
                created_at: Some(now),
            },
        )
        .await?;
        storage::write_json_atomic(&self.sessions_path, &sessions).await?;
        let _ = tokio::fs::remove_file(&self.setup_token_path).await;
        drop(persist_guard);
        self.limiter.lock().await.clear("__setup__");
        Ok(raw)
    }

    pub async fn login_at(&self, ip: &str, password: &str, now: i64) -> Result<String, ApiError> {
        // Reserve the attempt slot before the (slow) Argon2 check so that N
        // concurrent requests cannot all pass `allowed` and then verify.
        {
            let mut limiter = self.limiter.lock().await;
            if !limiter.allowed(ip, now) {
                return Err(ApiError::AuthRateLimited);
            }
            limiter.record_failure(ip, now);
        }
        let hash = self
            .inner
            .read()
            .await
            .password_hash
            .clone()
            .ok_or(ApiError::SetupRequired)?;
        if !verify_password(&hash, password) {
            // The slot was already consumed above; do not record a second time.
            return Err(ApiError::AuthInvalid);
        }
        self.limiter.lock().await.clear(ip);
        let _persist = self.persist.lock().await;
        let mut inner = self.inner.write().await;
        prune_sessions(&mut inner, now);
        let raw = create_session(&mut inner, now);
        let sessions = sessions_snapshot(&inner);
        drop(inner);
        storage::write_json_atomic(&self.sessions_path, &sessions).await?;
        Ok(raw)
    }

    pub async fn validate_at(&self, raw: &str, now: i64) -> Option<SessionInfo> {
        let key = sha256_hex(raw.as_bytes());
        let _persist = self.persist.lock().await;
        let mut inner = self.inner.write().await;
        let record = inner.sessions.get(&key).cloned()?;
        if now - record.created_at > ABSOLUTE_SECS || now - record.last_seen_at > SLIDING_SECS {
            inner.sessions.remove(&key);
            let sessions = sessions_snapshot(&inner);
            drop(inner);
            let _ = storage::write_json_atomic(&self.sessions_path, &sessions).await;
            return None;
        }
        if now - record.last_seen_at >= 60 {
            if let Some(entry) = inner.sessions.get_mut(&key) {
                entry.last_seen_at = now;
            }
            let sessions = sessions_snapshot(&inner);
            drop(inner);
            let _ = storage::write_json_atomic(&self.sessions_path, &sessions).await;
        }
        Some(SessionInfo {
            created_at: record.created_at,
        })
    }

    pub async fn logout(&self, raw: &str) {
        let key = sha256_hex(raw.as_bytes());
        let _persist = self.persist.lock().await;
        let mut inner = self.inner.write().await;
        inner.sessions.remove(&key);
        let sessions = sessions_snapshot(&inner);
        drop(inner);
        let _ = storage::write_json_atomic(&self.sessions_path, &sessions).await;
    }

    pub async fn change_password(&self, password: &str) -> Result<(), ApiError> {
        if password.chars().count() < MIN_PASSWORD_LEN {
            return Err(ApiError::AuthInvalid);
        }
        let hash = hash_password(password)?;
        let _persist = self.persist.lock().await;
        let mut inner = self.inner.write().await;
        if inner.password_hash.is_none() {
            return Err(ApiError::SetupRequired);
        }
        inner.password_hash = Some(hash.clone());
        inner.sessions.clear();
        drop(inner);
        storage::write_json_atomic(
            &self.auth_path,
            &AuthFile {
                password_hash: Some(hash),
                created_at: Some(chrono::Utc::now().timestamp()),
            },
        )
        .await?;
        storage::write_json_atomic(&self.sessions_path, &SessionsFile::default()).await?;
        Ok(())
    }

    /// Completes first-run setup from the locally stored token, with no HTTP
    /// session. Packaging hooks call this so the admin password can be set
    /// before the browser is ever opened.
    pub async fn complete_setup(&self, password: &str) -> Result<(), ApiError> {
        if password.chars().count() < MIN_PASSWORD_LEN {
            return Err(ApiError::AuthInvalid);
        }
        let hash = hash_password(password)?;
        let _persist = self.persist.lock().await;
        let mut inner = self.inner.write().await;
        if inner.password_hash.is_some() {
            return Err(ApiError::AlreadyInitialized);
        }
        if inner.setup_token.is_none() {
            return Err(ApiError::SetupRequired);
        }
        inner.password_hash = Some(hash.clone());
        inner.setup_token = None;
        inner.sessions.clear();
        drop(inner);
        storage::write_json_atomic(
            &self.auth_path,
            &AuthFile {
                password_hash: Some(hash),
                created_at: Some(chrono::Utc::now().timestamp()),
            },
        )
        .await?;
        storage::write_json_atomic(&self.sessions_path, &SessionsFile::default()).await?;
        let _ = tokio::fs::remove_file(&self.setup_token_path).await;
        Ok(())
    }

    pub async fn reset_password(&self, password: &str) -> Result<(), ApiError> {
        if password.chars().count() < MIN_PASSWORD_LEN {
            return Err(ApiError::AuthInvalid);
        }
        let hash = hash_password(password)?;
        let _persist = self.persist.lock().await;
        let mut inner = self.inner.write().await;
        inner.password_hash = Some(hash.clone());
        inner.setup_token = None;
        inner.sessions.clear();
        drop(inner);
        storage::write_json_atomic(
            &self.auth_path,
            &AuthFile {
                password_hash: Some(hash),
                created_at: Some(chrono::Utc::now().timestamp()),
            },
        )
        .await?;
        storage::write_json_atomic(&self.sessions_path, &SessionsFile::default()).await?;
        let _ = tokio::fs::remove_file(&self.setup_token_path).await;
        Ok(())
    }
}

fn generate_setup_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect()
}

fn create_session(inner: &mut AuthInner, now: i64) -> String {
    let mut bytes = [0u8; 32];
    let mut rng = OsRng;
    rng.fill_bytes(&mut bytes);
    let raw = hex::encode(bytes);
    let key = sha256_hex(raw.as_bytes());
    inner.sessions.insert(
        key,
        SessionRecord {
            created_at: now,
            last_seen_at: now,
        },
    );
    raw
}

fn prune_sessions(inner: &mut AuthInner, now: i64) {
    inner.sessions.retain(|_, record| {
        now - record.created_at <= ABSOLUTE_SECS && now - record.last_seen_at <= SLIDING_SECS
    });
}

fn sessions_snapshot(inner: &AuthInner) -> SessionsFile {
    SessionsFile {
        sessions: inner.sessions.clone(),
    }
}

fn hash_password(password: &str) -> Result<String, ApiError> {
    let mut rng = OsRng;
    let salt = SaltString::generate(&mut rng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| ApiError::Internal(err.to_string()))
}

fn verify_password(hash: &str, password: &str) -> bool {
    PasswordHash::new(hash)
        .ok()
        .and_then(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .ok()
        })
        .is_some()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cfg(dir: &std::path::Path) -> AgentConfig {
        AgentConfig::from_pairs(vec![
            ("LT_DATA_DIR".to_string(), dir.display().to_string()),
            ("LT_BIND".to_string(), "127.0.0.1:17800".to_string()),
        ])
        .unwrap()
    }

    #[tokio::test]
    async fn first_run_creates_setup_token() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        assert!(store.setup_required().await);
        let token = store.setup_token().await.unwrap();
        assert_eq!(token.len(), 8);
        let on_disk = tokio::fs::read_to_string(dir.path().join("state/setup-token"))
            .await
            .unwrap();
        assert_eq!(on_disk.trim(), token);
    }

    #[tokio::test]
    async fn setup_rejects_wrong_token_and_short_password() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        assert!(matches!(
            store.setup("00000000", "long-enough-pw", now).await,
            Err(ApiError::AuthInvalid)
        ));
        assert!(matches!(
            store.setup(&token, "short", now).await,
            Err(ApiError::AuthInvalid)
        ));
        assert!(store.setup_required().await);
    }

    #[tokio::test]
    async fn setup_then_login_and_validate() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        let session = store.setup(&token, "long-enough-pw", now).await.unwrap();
        assert!(!store.setup_required().await);
        assert!(store.validate_at(&session, now + 10).await.is_some());
        assert!(tokio::fs::metadata(dir.path().join("state/setup-token"))
            .await
            .is_err());

        assert!(matches!(
            store.login_at("1.2.3.4", "wrong-password", now).await,
            Err(ApiError::AuthInvalid)
        ));
        let second = store
            .login_at("1.2.3.4", "long-enough-pw", now)
            .await
            .unwrap();
        assert_ne!(session, second);
        store.logout(&second).await;
        assert!(store.validate_at(&second, now + 20).await.is_none());
    }

    #[tokio::test]
    async fn session_expires_after_sliding_window() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        let session = store.setup(&token, "long-enough-pw", now).await.unwrap();
        assert!(store.validate_at(&session, now + 8 * 86400).await.is_none());
    }

    #[tokio::test]
    async fn rate_limiter_blocks_after_five_failures() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        store.setup(&token, "long-enough-pw", now).await.unwrap();
        for _ in 0..5 {
            let _ = store.login_at("9.9.9.9", "wrong-password", now).await;
        }
        assert!(matches!(
            store.login_at("9.9.9.9", "long-enough-pw", now).await,
            Err(ApiError::AuthRateLimited)
        ));
        assert!(store
            .login_at("9.9.9.9", "long-enough-pw", now + 61)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn change_password_invalidates_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        let session = store.setup(&token, "long-enough-pw", now).await.unwrap();
        store.change_password("another-good-pw").await.unwrap();
        assert!(store.validate_at(&session, now + 1).await.is_none());
        assert!(store
            .login_at("1.1.1.1", "long-enough-pw", now + 2)
            .await
            .is_err());
        assert!(store
            .login_at("1.1.1.1", "another-good-pw", now + 3)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn setup_attempts_are_limited() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        for _ in 0..5 {
            let _ = store.setup("00000000", "long-enough-pw", now).await;
        }
        assert!(matches!(
            store.setup(&token, "long-enough-pw", now).await,
            Err(ApiError::AuthRateLimited)
        ));
        assert!(store.setup_required().await);
    }

    #[tokio::test]
    async fn concurrent_login_attempts_respect_limit() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        store.setup(&token, "long-enough-pw", now).await.unwrap();

        let store = &store;
        let (a, b, c, d, e, f) = tokio::join!(
            store.login_at("10.0.0.1", "wrong-password", now),
            store.login_at("10.0.0.1", "wrong-password", now),
            store.login_at("10.0.0.1", "wrong-password", now),
            store.login_at("10.0.0.1", "wrong-password", now),
            store.login_at("10.0.0.1", "wrong-password", now),
            store.login_at("10.0.0.1", "wrong-password", now),
        );
        let results = [a, b, c, d, e, f];
        let invalid = results
            .iter()
            .filter(|r| matches!(r, Err(ApiError::AuthInvalid)))
            .count();
        let limited = results
            .iter()
            .filter(|r| matches!(r, Err(ApiError::AuthRateLimited)))
            .count();
        assert_eq!(
            invalid, 5,
            "expected exactly 5 credential rejections, got {results:?}"
        );
        assert_eq!(
            limited, 1,
            "expected exactly 1 rate-limited rejection, got {results:?}"
        );
    }

    #[tokio::test]
    async fn reset_password_clears_sessions_and_replaces_password() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        let session = store.setup(&token, "long-enough-pw", now).await.unwrap();
        store.reset_password("reset-password-ok").await.unwrap();
        assert!(store.validate_at(&session, now + 1).await.is_none());
        assert!(matches!(
            store.login_at("2.2.2.2", "long-enough-pw", now + 2).await,
            Err(ApiError::AuthInvalid)
        ));
        assert!(store
            .login_at("2.2.2.2", "reset-password-ok", now + 3)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn complete_setup_initializes_without_session_and_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = test_cfg(dir.path());
        let store = AuthStore::load(&cfg).await.unwrap();
        store.complete_setup("long-enough-pw").await.unwrap();

        assert!(!store.setup_required().await);
        assert!(tokio::fs::metadata(dir.path().join("state/setup-token"))
            .await
            .is_err());
        let sessions = tokio::fs::read_to_string(dir.path().join("state/sessions.json"))
            .await
            .unwrap();
        let sessions: serde_json::Value = serde_json::from_str(&sessions).unwrap();
        assert_eq!(sessions["sessions"], serde_json::json!({}));
        assert!(store
            .login_at("1.2.3.4", "long-enough-pw", 1_700_000_000)
            .await
            .is_ok());

        assert!(matches!(
            store.complete_setup("another-long-pw").await,
            Err(ApiError::AlreadyInitialized)
        ));
        let reloaded = AuthStore::load(&cfg).await.unwrap();
        assert!(reloaded
            .login_at("1.2.3.4", "long-enough-pw", 1_700_000_000)
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn complete_setup_rejects_short_password_and_keeps_token() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        assert!(matches!(
            store.complete_setup("short").await,
            Err(ApiError::AuthInvalid)
        ));
        assert!(store.setup_required().await);
        assert!(tokio::fs::metadata(dir.path().join("state/setup-token"))
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn sessions_are_persisted_hashed_and_survive_reload() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = test_cfg(dir.path());
        let now = 1_700_000_000;
        let raw = {
            let store = AuthStore::load(&cfg).await.unwrap();
            let token = store.setup_token().await.unwrap();
            store.setup(&token, "long-enough-pw", now).await.unwrap()
        };

        let on_disk = tokio::fs::read_to_string(dir.path().join("state/sessions.json"))
            .await
            .unwrap();
        assert!(
            !on_disk.contains(&raw),
            "raw session token must never be persisted"
        );
        let key = sha256_hex(raw.as_bytes());
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(on_disk.contains(&key), "expected sha256 key in {on_disk}");

        let reloaded = AuthStore::load(&cfg).await.unwrap();
        assert!(reloaded.validate_at(&raw, now + 10).await.is_some());
    }

    #[tokio::test]
    async fn session_expires_after_absolute_window() {
        let dir = tempfile::tempdir().unwrap();
        let store = AuthStore::load(&test_cfg(dir.path())).await.unwrap();
        let token = store.setup_token().await.unwrap();
        let now = 1_700_000_000;
        let session = store.setup(&token, "long-enough-pw", now).await.unwrap();
        // Keep the sliding window alive with a refresh every 5 days up to day 25.
        for day in 1..=5 {
            let at = now + day * 5 * 86_400;
            assert!(
                store.validate_at(&session, at).await.is_some(),
                "session must still be alive on day {}",
                day * 5
            );
        }
        // Day 31 is beyond the 30-day absolute bound even though lastSeenAt is recent.
        assert!(store
            .validate_at(&session, now + 31 * 86_400)
            .await
            .is_none());
    }
}
