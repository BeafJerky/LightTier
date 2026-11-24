pub mod auth;
pub mod auth_routes;
pub mod config;
pub mod error;
pub mod http;
pub mod ids;
pub mod logging;
pub mod storage;

use std::sync::Arc;

pub async fn run_server() -> Result<(), Box<dyn std::error::Error>> {
    let cfg = config::AgentConfig::from_env()?;
    std::fs::create_dir_all(&cfg.data_dir)?;
    let _guard = logging::init(&cfg.data_dir.join("logs/agent"))?;
    let auth = crate::auth::AuthStore::load(&cfg).await?;
    let state = Arc::new(http::AppState::new(cfg, auth));
    http::serve(state).await
}
