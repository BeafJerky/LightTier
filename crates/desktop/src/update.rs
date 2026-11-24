//! 应用内更新：启动已下载的桌面安装包。
//!
//! 安装包位于 `<resource>/resource/update`，覆盖安装会与自身文件句柄冲突，
//! 因此先复制到临时目录再启动；启动后延迟退出，避免 NSIS 写文件时旧 exe 仍被占用。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Manager;

#[cfg(windows)]
const FILE_SHARE_READ: u32 = 0x0000_0001;

const OFFICIAL_RELEASES_API: &str = "https://api.github.com/repos/BeafJerky/LightTier/releases";
const OFFICIAL_API_TIMEOUT: Duration = Duration::from_secs(10);
const OFFICIAL_API_USER_AGENT: &str = concat!("LightTier/", env!("CARGO_PKG_VERSION"));
const OFFICIAL_API_ACCEPT: &str = "application/vnd.github+json";

/// 只接受纯文件名：路径分隔符与 `..` 一律拒绝，防止越出更新目录执行任意程序。
fn validate_installer_name(installer: &str) -> Result<(), String> {
    if installer.is_empty()
        || installer.contains('/')
        || installer.contains('\\')
        || installer.contains("..")
    {
        return Err(format!("非法的安装包文件名: {installer}"));
    }
    if !installer.to_lowercase().ends_with(".exe") {
        return Err(format!("不支持的安装包类型: {installer}"));
    }
    Ok(())
}

/// 只接受官方 API 中唯一且格式严格的 `sha256:<64 hex>`，返回规范化小写 hex。
fn parse_official_installer_digest(
    releases: &serde_json::Value,
    installer: &str,
) -> Result<String, String> {
    let releases = releases
        .as_array()
        .ok_or_else(|| "官方发布列表格式非法，拒绝安装".to_string())?;
    let mut digest = None;
    for release in releases {
        let Some(assets) = release.get("assets").and_then(serde_json::Value::as_array) else {
            continue;
        };
        for asset in assets {
            if asset.get("name").and_then(serde_json::Value::as_str) != Some(installer) {
                continue;
            }
            if digest.is_some() {
                return Err("官方发布中存在重复安装包，拒绝安装".into());
            }
            let value = asset
                .get("digest")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| "官方安装包缺少 SHA-256 摘要，拒绝安装".to_string())?;
            let hex = value
                .strip_prefix("sha256:")
                .ok_or_else(|| "官方安装包摘要格式非法，拒绝安装".to_string())?;
            if hex.len() != 64 || !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("官方安装包摘要格式非法，拒绝安装".into());
            }
            digest = Some(hex.to_ascii_lowercase());
        }
    }
    digest.ok_or_else(|| "官方发布中未找到安装包摘要，拒绝安装".to_string())
}

async fn fetch_installer_digest(
    client: &reqwest::Client,
    api_url: &str,
    installer: &str,
) -> Result<String, String> {
    let response = client
        .get(api_url)
        .header(reqwest::header::USER_AGENT, OFFICIAL_API_USER_AGENT)
        .header(reqwest::header::ACCEPT, OFFICIAL_API_ACCEPT)
        .send()
        .await
        .map_err(|error| format!("获取官方安装包摘要失败: {error}"))?
        .error_for_status()
        .map_err(|error| format!("官方安装包摘要接口请求失败: {error}"))?;
    let releases = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("解析官方安装包摘要失败: {error}"))?;
    parse_official_installer_digest(&releases, installer)
}

/// 校验已从官方 API 解析出的纯 hex 摘要；不再接受 IPC 可自报的带前缀字符串。
fn verify_sha256(bytes: &[u8], expected_hex: &str) -> Result<(), String> {
    if expected_hex.len() != 64 || !expected_hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("安装包摘要格式非法，拒绝安装".into());
    }
    let actual = lighttier_core::kernel_manifest::sha256_bytes(bytes);
    if actual.eq_ignore_ascii_case(expected_hex) {
        Ok(())
    } else {
        Err("安装包校验失败，拒绝安装".into())
    }
}

fn create_staged_installer(temp_dir: &Path, bytes: &[u8]) -> Result<(PathBuf, File), String> {
    for _ in 0..16 {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let staged = temp_dir.join(format!(
            ".lighttier-update-{}-{nonce}.exe",
            std::process::id()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(windows)]
        // 只共享读取：验证后到 spawn 返回前，其他进程无法写入、截断或删除暂存 exe。
        options.share_mode(FILE_SHARE_READ);
        let mut file = match options.open(&staged) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("创建安装包暂存文件失败: {e}")),
        };
        if let Err(e) = file.write_all(bytes) {
            drop(file);
            let _ = std::fs::remove_file(&staged);
            return Err(format!("写入安装包暂存文件失败: {e}"));
        }
        return Ok((staged, file));
    }
    Err("无法创建唯一安装包暂存文件".into())
}

pub async fn launch_update_installer(
    app: &tauri::AppHandle,
    installer: &str,
) -> Result<(), String> {
    validate_installer_name(installer)?;

    let read_app = app.clone();
    let read_installer = installer.to_owned();
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let resource_dir = read_app.path().resource_dir().map_err(|e| e.to_string())?;
        let source = resource_dir
            .join("resource")
            .join("update")
            .join(read_installer);
        std::fs::read(&source).map_err(|e| format!("读取安装包失败: {e}"))
    })
    .await
    .map_err(|e| format!("读取安装包任务失败: {e}"))??;
    // 文件头必须是 PE 的 "MZ"：镜像站可能把 HTML 错误页存成 .exe，不能直接执行
    if bytes.len() < 2 || &bytes[..2] != b"MZ" {
        return Err(format!("安装包内容不是可执行程序: {installer}"));
    }

    let client = reqwest::Client::builder()
        .timeout(OFFICIAL_API_TIMEOUT)
        .build()
        .map_err(|e| format!("创建官方摘要客户端失败: {e}"))?;
    let expected_hex = fetch_installer_digest(&client, OFFICIAL_RELEASES_API, installer).await?;

    let launch_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        verify_sha256(&bytes, &expected_hex)?;
        launch_verified_installer(&launch_app, &bytes)
    })
    .await
    .map_err(|e| format!("启动安装器任务失败: {e}"))?
}

fn launch_verified_installer(app: &tauri::AppHandle, bytes: &[u8]) -> Result<(), String> {
    let (staged, staged_file) = create_staged_installer(&std::env::temp_dir(), bytes)?;

    let mut command = Command::new(&staged);
    #[cfg(windows)]
    // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP：脱离本进程控制台，应用退出后安装器继续运行
    command.creation_flags(0x0000_0208);
    if let Err(e) = command.spawn() {
        drop(staged_file);
        let _ = std::fs::remove_file(&staged);
        return Err(format!("启动安装器失败: {e}"));
    }
    drop(staged_file);

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        handle.exit(0);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_matching_digest_hex_with_case() {
        let bytes = b"MZ installer";
        let expected = lighttier_core::kernel_manifest::sha256_bytes(bytes);
        assert!(verify_sha256(bytes, &expected).is_ok());
        assert!(verify_sha256(bytes, &expected.to_uppercase()).is_ok());
    }

    #[test]
    fn rejects_unparsed_digest_at_verification_boundary() {
        let bytes = b"MZ installer";
        let digest = format!(
            "sha256:{}",
            lighttier_core::kernel_manifest::sha256_bytes(bytes)
        );
        assert!(verify_sha256(bytes, &digest).is_err());
        assert!(verify_sha256(bytes, &digest.to_uppercase()).is_err());
        assert!(verify_sha256(bytes, &format!(" {digest}")).is_err());
    }

    #[test]
    fn rejects_mismatched_digest() {
        let bytes = b"MZ installer";
        let expected = "0".repeat(64);
        assert!(verify_sha256(bytes, &expected).is_err());
    }

    #[test]
    fn rejects_malformed_digest() {
        assert!(verify_sha256(b"MZ", "").is_err());
        assert!(verify_sha256(b"MZ", "sha256:1234").is_err());
        assert!(verify_sha256(b"MZ", &"g".repeat(64)).is_err());
        assert!(verify_sha256(b"MZ", &"0".repeat(63)).is_err());
        assert!(verify_sha256(b"MZ", &"0".repeat(65)).is_err());
    }

    #[test]
    fn parses_only_the_unique_official_asset_digest() {
        let releases = serde_json::json!([
            {
                "assets": [
                    { "name": "other.exe", "digest": "sha256:malformed" },
                    { "name": "LightTier_9.9.9_x64-setup.exe", "digest": "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }
                ]
            },
            { "assets": [] }
        ]);

        assert_eq!(
            parse_official_installer_digest(&releases, "LightTier_9.9.9_x64-setup.exe").unwrap(),
            "a".repeat(64)
        );
    }

    #[test]
    fn rejects_missing_official_installer_asset() {
        let releases = serde_json::json!([
            { "assets": [{ "name": "other.exe", "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] }
        ]);

        assert!(
            parse_official_installer_digest(&releases, "LightTier_9.9.9_x64-setup.exe").is_err()
        );
    }

    #[test]
    fn rejects_duplicate_official_installer_assets() {
        let asset = serde_json::json!({
            "name": "LightTier_9.9.9_x64-setup.exe",
            "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        });
        let same_release = serde_json::json!([{ "assets": [asset.clone(), asset.clone()] }]);
        let across_releases = serde_json::json!([
            { "assets": [asset.clone()] },
            { "assets": [asset] }
        ]);

        assert!(
            parse_official_installer_digest(&same_release, "LightTier_9.9.9_x64-setup.exe")
                .is_err()
        );
        assert!(
            parse_official_installer_digest(&across_releases, "LightTier_9.9.9_x64-setup.exe")
                .is_err()
        );
    }

    #[test]
    fn rejects_missing_or_malformed_official_digest() {
        let valid_hex = "a".repeat(64);
        let invalid_digests = [
            None,
            Some(format!("SHA256:{valid_hex}")),
            Some(valid_hex.clone()),
            Some(format!("sha256:{}", "a".repeat(63))),
            Some(format!("sha256:{}", "a".repeat(65))),
            Some(format!("sha256:{}", "g".repeat(64))),
            Some(format!(" sha256:{valid_hex}")),
            Some(format!("sha256:{valid_hex} ")),
        ];

        for digest in invalid_digests {
            let mut asset = serde_json::json!({ "name": "LightTier_9.9.9_x64-setup.exe" });
            if let Some(digest) = digest {
                asset["digest"] = serde_json::json!(digest);
            }
            let releases = serde_json::json!([{ "assets": [asset] }]);
            assert!(
                parse_official_installer_digest(&releases, "LightTier_9.9.9_x64-setup.exe")
                    .is_err()
            );
        }
    }

    #[test]
    fn rejects_official_digest_network_failure() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(1))
            .build()
            .unwrap();

        let result = tauri::async_runtime::block_on(fetch_installer_digest(
            &client,
            &format!("http://{address}"),
            "LightTier_9.9.9_x64-setup.exe",
        ));

        assert!(result.is_err());
    }

    #[test]
    fn rejects_malformed_official_release_payload() {
        assert!(parse_official_installer_digest(&serde_json::json!({}), "setup.exe").is_err());
        assert!(parse_official_installer_digest(&serde_json::json!([]), "setup.exe").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn staged_installer_rejects_write_and_delete_until_handle_closes() {
        let root = std::env::temp_dir().join(format!(
            "lighttier-update-share-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let bytes = b"MZ installer";
        let (staged, file) = create_staged_installer(&root, bytes).unwrap();

        let write_attempt = OpenOptions::new().write(true).truncate(true).open(&staged);
        let write_allowed = write_attempt.is_ok();
        drop(write_attempt);
        let read_result = std::fs::read(&staged);
        let delete_allowed = std::fs::remove_file(&staged).is_ok();
        drop(file);
        if !delete_allowed {
            let _ = std::fs::remove_file(&staged);
        }
        let _ = std::fs::remove_dir_all(&root);

        assert!(!write_allowed, "暂存句柄持有期间不得允许写入或截断");
        assert_eq!(read_result.unwrap(), bytes, "暂存句柄持有期间仍应允许读取");
        assert!(!delete_allowed, "暂存句柄持有期间不得允许删除");
    }

    #[test]
    fn stages_verified_bytes_in_unique_exclusive_files() {
        let root = std::env::temp_dir().join(format!(
            "lighttier-update-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let bytes = b"MZ installer";
        let (first, first_file) = create_staged_installer(&root, bytes).unwrap();
        let (second, second_file) = create_staged_installer(&root, bytes).unwrap();

        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), bytes);
        assert_eq!(std::fs::read(&second).unwrap(), bytes);
        drop(first_file);
        drop(second_file);
        std::fs::remove_dir_all(root).unwrap();
    }
}
