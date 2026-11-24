//! 应用内更新：启动已下载的桌面安装包。
//!
//! 安装包位于 `<resource>/resource/update`，覆盖安装会与自身文件句柄冲突，
//! 因此先复制到临时目录再启动；启动后延迟退出，避免 NSIS 写文件时旧 exe 仍被占用。

#[cfg(windows)]
use std::ffi::OsString;
use std::fs::{File, OpenOptions};
#[cfg(windows)]
use std::io::Read;
use std::io::Write;
#[cfg(windows)]
use std::os::windows::ffi::OsStringExt;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
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
const OFFICIAL_API_ATTEMPTS: u32 = 2;
const OFFICIAL_API_RETRY_DELAY: Duration = Duration::from_millis(300);
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

/// 传输类失败可重试；接口返回内容非法（状态码、非 JSON）重试也没用。
enum ReleaseFetchError {
    Retryable(String),
    Fatal(String),
}

async fn fetch_releases_once(
    client: &reqwest::Client,
    api_url: &str,
) -> Result<serde_json::Value, ReleaseFetchError> {
    let response = client
        .get(api_url)
        .header(reqwest::header::USER_AGENT, OFFICIAL_API_USER_AGENT)
        .header(reqwest::header::ACCEPT, OFFICIAL_API_ACCEPT)
        .send()
        .await
        .map_err(|error| {
            ReleaseFetchError::Retryable(format!("请求官方安装包摘要接口失败: {error}"))
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(ReleaseFetchError::Fatal(format!(
            "官方安装包摘要接口请求失败: HTTP {status}"
        )));
    }
    // Response::json() 把响应体读取失败与 JSON 解析失败都映射成 "error decoding
    // response body"；先单独取字节，才能把传输中断和返回内容非法区分开。
    let body = response.bytes().await.map_err(|error| {
        let cause = if error.is_timeout() {
            "读取官方安装包摘要响应超时"
        } else {
            "读取官方安装包摘要响应失败"
        };
        ReleaseFetchError::Retryable(format!("{cause}: {error}"))
    })?;
    serde_json::from_slice(&body)
        .map_err(|error| ReleaseFetchError::Fatal(format!("解析官方安装包摘要失败: {error}")))
}

async fn fetch_installer_digest(
    client: &reqwest::Client,
    api_url: &str,
    installer: &str,
) -> Result<String, String> {
    let mut last_error = String::new();
    for attempt in 1..=OFFICIAL_API_ATTEMPTS {
        match fetch_releases_once(client, api_url).await {
            Ok(releases) => return parse_official_installer_digest(&releases, installer),
            Err(ReleaseFetchError::Fatal(message)) => return Err(message),
            Err(ReleaseFetchError::Retryable(message)) => {
                if attempt < OFFICIAL_API_ATTEMPTS {
                    log::warn!(
                        "官方安装包摘要第 {attempt}/{OFFICIAL_API_ATTEMPTS} 次获取失败，稍后重试: {message}"
                    );
                    tokio::time::sleep(OFFICIAL_API_RETRY_DELAY).await;
                }
                last_error = message;
            }
        }
    }
    Err(format!(
        "获取官方安装包摘要失败（共 {OFFICIAL_API_ATTEMPTS} 次尝试）: {last_error}"
    ))
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

#[cfg(windows)]
fn lock_staged_installer(staged: &Path, expected_bytes: &[u8]) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).share_mode(FILE_SHARE_READ);
    let mut lock = options
        .open(staged)
        .map_err(|e| format!("锁定安装包暂存文件失败: {e}"))?;
    // 路径在关写与加锁之间可能被替换；只认可锁句柄指向的已验证字节。
    let mut actual = Vec::with_capacity(expected_bytes.len());
    (&mut lock)
        .take(expected_bytes.len() as u64 + 1)
        .read_to_end(&mut actual)
        .map_err(|e| format!("复读安装包暂存文件失败: {e}"))?;
    if actual.as_slice() != expected_bytes {
        return Err("安装包暂存文件在锁定前被替换，拒绝安装".into());
    }
    Ok(lock)
}

#[cfg(windows)]
fn locked_file_final_path(file: &File) -> Result<PathBuf, String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFinalPathNameByHandleW(
            file: *mut std::os::raw::c_void,
            buffer: *mut u16,
            length: u32,
            flags: u32,
        ) -> u32;
    }

    let mut buffer = vec![0u16; 32_768];
    // SAFETY: 句柄来自 File，缓冲区长度与实际分配一致，返回值按文档校验后再读取。
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    };
    if length == 0 {
        return Err(format!(
            "解析安装包暂存路径失败: {}",
            std::io::Error::last_os_error()
        ));
    }
    if length as usize >= buffer.len() {
        return Err("安装包暂存路径过长，拒绝安装".into());
    }
    buffer.truncate(length as usize);
    Ok(PathBuf::from(OsString::from_wide(&buffer)))
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
        #[cfg(windows)]
        // CreateProcess 拒绝仍有可写句柄的 exe；关闭写入后改用只读共享锁，继续禁止写入和删除。
        let lock = {
            drop(file);
            match lock_staged_installer(&staged, bytes) {
                Ok(lock) => lock,
                Err(e) => {
                    let _ = std::fs::remove_file(&staged);
                    return Err(e);
                }
            }
        };
        #[cfg(windows)]
        let staged = match locked_file_final_path(&lock) {
            Ok(path) => path,
            Err(error) => {
                drop(lock);
                let _ = std::fs::remove_file(&staged);
                return Err(error);
            }
        };
        #[cfg(not(windows))]
        let lock = file;
        return Ok((staged, lock));
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

    fn installer_release_payload(installer: &str) -> Vec<u8> {
        serde_json::json!([{
            "assets": [{ "name": installer, "digest": format!("sha256:{}", "a".repeat(64)) }]
        }])
        .to_string()
        .into_bytes()
    }

    fn http_response(status_line: &str, body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    /// 声明完整 Content-Length 却只发送一半字节后断开，模拟响应体传输中断。
    fn truncated_response(body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(&body[..body.len() / 2]);
        response
    }

    /// 按脚本逐次返回响应；实际受理的连接数可用于断言是否发生重试。
    fn spawn_scripted_server(
        responses: Vec<Vec<u8>>,
    ) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = std::sync::Arc::clone(&hits);
        std::thread::spawn(move || {
            for response in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut request = [0_u8; 2048];
                let _ = std::io::Read::read(&mut stream, &mut request);
                let _ = std::io::Write::write_all(&mut stream, &response);
                let _ = stream.shutdown(std::net::Shutdown::Both);
            }
        });
        (format!("http://{address}"), hits)
    }

    fn test_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap()
    }

    #[test]
    fn reports_truncated_response_body_as_read_failure() {
        let payload = installer_release_payload("setup.exe");
        let (url, hits) = spawn_scripted_server(vec![
            truncated_response(&payload),
            truncated_response(&payload),
        ]);

        let error = tauri::async_runtime::block_on(fetch_installer_digest(
            &test_client(),
            &url,
            "setup.exe",
        ))
        .unwrap_err();

        assert!(error.contains("读取官方安装包摘要响应失败"), "{error}");
        assert!(!error.contains("解析官方安装包摘要失败"), "{error}");
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn retries_truncated_response_then_succeeds() {
        let payload = installer_release_payload("setup.exe");
        let (url, hits) = spawn_scripted_server(vec![
            truncated_response(&payload),
            http_response("200 OK", &payload),
        ]);

        let digest = tauri::async_runtime::block_on(fetch_installer_digest(
            &test_client(),
            &url,
            "setup.exe",
        ))
        .unwrap();

        assert_eq!(digest, "a".repeat(64));
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn reports_non_json_body_as_parse_failure_without_retry() {
        let body = b"<html>blocked</html>".to_vec();
        let (url, hits) = spawn_scripted_server(vec![
            http_response("200 OK", &body),
            http_response("200 OK", &body),
        ]);

        let error = tauri::async_runtime::block_on(fetch_installer_digest(
            &test_client(),
            &url,
            "setup.exe",
        ))
        .unwrap_err();

        assert!(error.contains("解析官方安装包摘要失败"), "{error}");
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn reports_http_status_without_retry() {
        let body = b"missing";
        let (url, hits) = spawn_scripted_server(vec![
            http_response("404 Not Found", body),
            http_response("404 Not Found", body),
        ]);

        let error = tauri::async_runtime::block_on(fetch_installer_digest(
            &test_client(),
            &url,
            "setup.exe",
        ))
        .unwrap_err();

        assert!(error.contains("HTTP 404"), "{error}");
        assert!(error.contains("官方安装包摘要接口请求失败"), "{error}");
        assert_eq!(hits.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[cfg(windows)]
    #[test]
    fn staged_installer_lock_rejects_path_replaced_before_locking() {
        let root = std::env::temp_dir().join(format!(
            "lighttier-update-replace-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let staged = root.join("installer.exe");
        let expected = b"MZ verified installer";
        let replacement = b"MZ replaced installer";
        std::fs::write(&staged, expected).unwrap();
        let replacement_path = root.join("replacement.exe");
        std::fs::write(&replacement_path, replacement).unwrap();
        std::fs::remove_file(&staged).unwrap();
        std::fs::rename(&replacement_path, &staged).unwrap();

        let result = lock_staged_installer(&staged, expected);
        let rejected = result.is_err();
        drop(result);
        let actual = std::fs::read(&staged).unwrap();
        std::fs::remove_file(&staged).unwrap();
        std::fs::remove_dir_all(&root).unwrap();

        assert!(rejected, "加锁前被替换的暂存安装器必须拒绝启动");
        assert_eq!(actual, replacement);
    }

    #[cfg(windows)]
    #[test]
    fn staged_installer_can_spawn_while_lock_handle_blocks_write_and_delete() {
        let root = std::env::temp_dir().join(format!(
            "lighttier-update-spawn-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let interpreter = std::env::var_os("COMSPEC")
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows\System32\cmd.exe").into_os_string());
        let bytes = std::fs::read(interpreter).unwrap();
        let (staged, file) = create_staged_installer(&root, &bytes).unwrap();

        let write_attempt = OpenOptions::new().write(true).truncate(true).open(&staged);
        let write_allowed = write_attempt.is_ok();
        drop(write_attempt);
        let delete_allowed = std::fs::remove_file(&staged).is_ok();
        let mut command = Command::new(&staged);
        command.args(["/D", "/C", "exit 0"]);
        command.creation_flags(0x0800_0000);
        let spawn_result = command.status();

        drop(file);
        if !delete_allowed {
            let _ = std::fs::remove_file(&staged);
        }
        let _ = std::fs::remove_dir_all(&root);

        assert!(!write_allowed, "暂存句柄持有期间不得允许写入或截断");
        assert!(!delete_allowed, "暂存句柄持有期间不得允许删除");
        let status = spawn_result.unwrap_or_else(|error| {
            panic!("暂存安装器在锁句柄持有期间必须可以启动，实际失败: {error}")
        });
        assert!(status.success(), "暂存安装器必须以成功状态退出");
    }

    #[cfg(windows)]
    #[test]
    fn staged_installer_uses_locked_file_path_after_parent_junction_rebind() {
        let root = std::env::temp_dir().join(format!(
            "lighttier-update-junction-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let target = root.join("target");
        let alias = root.join("alias");
        std::fs::create_dir_all(&target).unwrap();
        let interpreter = std::env::var_os("COMSPEC")
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows\System32\cmd.exe").into_os_string());
        let junction_status = Command::new(&interpreter)
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&alias)
            .arg(&target)
            .status()
            .unwrap();
        assert!(junction_status.success(), "测试目录联接创建失败");

        let bytes = std::fs::read(&interpreter).unwrap();
        let (staged, file) = create_staged_installer(&alias, &bytes).unwrap();
        let file_name = staged.file_name().unwrap().to_owned();
        let renamed_target = root.join("renamed-target");
        let parent_rename_allowed = std::fs::rename(&target, &renamed_target).is_ok();
        if parent_rename_allowed {
            std::fs::rename(&renamed_target, &target).unwrap();
        }
        std::fs::remove_dir(&alias).unwrap();
        std::fs::create_dir(&alias).unwrap();
        std::fs::write(alias.join(&file_name), b"MZ replacement installer").unwrap();

        let mut command = Command::new(&staged);
        command.args(["/D", "/C", "exit 0"]);
        command.creation_flags(0x0800_0000);
        let spawn_result = command.status();

        drop(file);
        let _ = std::fs::remove_dir_all(&alias);
        let _ = std::fs::remove_dir_all(&target);
        let _ = std::fs::remove_dir_all(&root);

        assert!(
            !parent_rename_allowed,
            "暂存句柄持有期间不得重命名其实际父目录"
        );
        let status = spawn_result.unwrap_or_else(|error| {
            panic!("父目录联接重绑定后仍必须启动锁句柄对应的安装器，实际失败: {error}")
        });
        assert!(status.success(), "锁句柄对应的安装器必须以成功状态退出");
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
