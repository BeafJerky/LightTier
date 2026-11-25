use std::path::Path;

/// Best-effort signal only: a successful open of `/dev/net/tun` does not prove a later TUNSETIFF will succeed (that also needs CAP_NET_ADMIN), so `tunAvailable` may be optimistic.
pub fn probe() -> (bool, Option<&'static str>) {
    probe_at(Path::new("/dev/net/tun"))
}

pub fn probe_at(path: &Path) -> (bool, Option<&'static str>) {
    if !path.exists() {
        return (false, Some("missing_device"));
    }
    match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
    {
        Ok(_) => (true, None),
        Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => {
            (false, Some("permission_denied"))
        }
        Err(_) => (false, Some("missing_device")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_path_reports_reason() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            probe_at(&dir.path().join("tun")),
            (false, Some("missing_device"))
        );
    }

    #[test]
    fn regular_file_is_openable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tun");
        std::fs::write(&path, b"").unwrap();
        assert_eq!(probe_at(&path), (true, None));
    }
}
