use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub bind: SocketAddr,
    pub data_dir: PathBuf,
    pub web_dir: PathBuf,
    pub cookie_secure: bool,
}

impl AgentConfig {
    pub fn from_env() -> Result<Self, String> {
        Self::from_pairs(std::env::vars())
    }

    pub fn from_pairs<I>(pairs: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = (String, String)>,
    {
        let map: HashMap<String, String> = pairs.into_iter().collect();
        let bind_raw = map
            .get("LT_BIND")
            .cloned()
            .unwrap_or_else(|| "0.0.0.0:17800".to_string());
        let bind = bind_raw
            .parse::<SocketAddr>()
            .map_err(|_| format!("invalid LT_BIND: {bind_raw}"))?;
        let data_dir = PathBuf::from(
            map.get("LT_DATA_DIR")
                .cloned()
                .unwrap_or_else(|| "/data".to_string()),
        );
        let web_dir = PathBuf::from(
            map.get("LT_WEB_DIR")
                .cloned()
                .unwrap_or_else(|| "/opt/lighttier/web".to_string()),
        );
        let cookie_secure = matches!(
            map.get("LT_COOKIE_SECURE").map(String::as_str),
            Some("1") | Some("true")
        );
        Ok(Self {
            bind,
            data_dir,
            web_dir,
            cookie_secure,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
        items
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn defaults_match_spec() {
        let cfg = AgentConfig::from_pairs(Vec::new()).unwrap();
        assert_eq!(cfg.bind.to_string(), "0.0.0.0:17800");
        assert_eq!(cfg.data_dir, std::path::PathBuf::from("/data"));
        assert_eq!(cfg.web_dir, std::path::PathBuf::from("/opt/lighttier/web"));
        assert!(!cfg.cookie_secure);
    }

    #[test]
    fn env_overrides_are_applied() {
        let cfg = AgentConfig::from_pairs(pairs(&[
            ("LT_BIND", "127.0.0.1:18000"),
            ("LT_DATA_DIR", "/tmp/lt"),
            ("LT_WEB_DIR", "/tmp/web"),
            ("LT_COOKIE_SECURE", "1"),
        ]))
        .unwrap();
        assert_eq!(cfg.bind.to_string(), "127.0.0.1:18000");
        assert_eq!(cfg.data_dir, std::path::PathBuf::from("/tmp/lt"));
        assert_eq!(cfg.web_dir, std::path::PathBuf::from("/tmp/web"));
        assert!(cfg.cookie_secure);
    }

    #[test]
    fn invalid_bind_is_rejected() {
        assert!(AgentConfig::from_pairs(pairs(&[("LT_BIND", "not-a-socket")])).is_err());
    }
}
