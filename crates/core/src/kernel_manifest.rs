//! 受支持内核包的 SHA-256 清单与校验。
//!
//! 清单来自 EasyTier 官方 Release 的 Windows x86_64 包；启动前只接受清单内文件。

use sha2::{Digest, Sha256};
use std::fs::File;
#[cfg(windows)]
use std::fs::OpenOptions;
use std::io::Read;
use std::path::{Path, PathBuf};

pub struct CoreHashes {
    pub version: &'static str,
    pub package: &'static str,
    pub core_exe: &'static str,
    pub cli_exe: &'static str,
}

/// 由官方 Release 核对后填入；新增受支持版本时必须同步追加。
/// v2.7.1 的 package 值已与官方 `SHA256SUMS` 核对；其余版本由官方 zip 计算。
pub const CORE_MANIFEST: &[CoreHashes] = &[
    CoreHashes {
        version: "v2.7.1",
        package: "6279ce18906f345345780b2f0c507125fcae861a54c45cc62efe58d5312de46b",
        core_exe: "f0ebba93149fad5f520b9f35486f97459e5cbc949a70b9617b051e7e5260daa9",
        cli_exe: "f37c5232d00a06a261eab22d048128f4f3300179ec37d5c7fde311880345a85a",
    },
    CoreHashes {
        version: "v2.6.4",
        package: "27af91e270e554709b048bd32327fefd2dfce5062ae1e8701af7550c6f525f84",
        core_exe: "da7eb2d24b5416f3d3407636949e964a0750e3f9dc53a828cb6799a57ead445d",
        cli_exe: "d8783e851e944b44a9b71b39fd02f227ec0a2a82b3165c55ead5dd32dcde53a1",
    },
    CoreHashes {
        version: "v2.5.0",
        package: "70c556c0c9322f066c81b635b49e3ff25c45c85699668da05f1830e914d9c5b2",
        core_exe: "a47b63a7763fb4ccf9d56f3a7e936163619c89a1e34c9d1e84022375a7d2711f",
        cli_exe: "83a31b18cb92436bfd6d85c4a22b27594fb5a2ec7bb1e46adf9245ebd935667b",
    },
    CoreHashes {
        version: "v2.4.5",
        package: "5d67089df8367bf449a1f60dd4edc4f67da5b88db20f92d69a0c2bcddd1e07c5",
        core_exe: "b6fd1824fb85629404293b54424a5e3c43a90ce4e5c0e221e53d6b4995f79d5d",
        cli_exe: "ddbbf6fac9d077a94cf0f0053943f63bea7a773c77c2d1e40e3b33b0464f92da",
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreFile {
    Core,
    Cli,
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?;
    sha256_reader(&mut file).map_err(|e| format!("读取 {} 失败: {e}", path.display()))
}

fn sha256_reader(reader: &mut impl Read) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn expected_package(version: &str) -> Option<&'static str> {
    CORE_MANIFEST
        .iter()
        .find(|entry| entry.version == version)
        .map(|entry| entry.package)
}

pub fn is_known_exe(hash: &str, file: CoreFile) -> bool {
    CORE_MANIFEST.iter().any(|entry| match file {
        CoreFile::Core => entry.core_exe == hash,
        CoreFile::Cli => entry.cli_exe == hash,
    })
}

pub fn verify_package(version: &str, path: &Path) -> Result<(), String> {
    let Some(expected) = expected_package(version) else {
        return Err(format!("内核 {version} 未提供校验清单，拒绝安装"));
    };
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!("内核包校验失败: {version}"))
    }
}

pub struct VerifiedExecutable {
    path: PathBuf,
    _file: File,
}

impl VerifiedExecutable {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

pub fn open_verified_exe(
    path: &Path,
    file: CoreFile,
    core_dir: &Path,
) -> Result<VerifiedExecutable, String> {
    if CORE_MANIFEST.is_empty() {
        return Err("内核校验清单为空，拒绝启动".into());
    }
    let core = core_dir
        .canonicalize()
        .map_err(|e| format!("无法解析内核目录 {}: {e}", core_dir.display()))?;
    let resolved = resolve_exe_path(path);
    let executable = resolved
        .canonicalize()
        .map_err(|e| format!("无法解析内核文件 {}: {e}", resolved.display()))?;
    if executable.parent() != Some(core.as_path()) {
        return Err(format!(
            "内核文件不在 resource/core 目录: {}",
            resolved.display()
        ));
    }

    let stem = executable
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let expected_stem = match file {
        CoreFile::Core => "easytier-core",
        CoreFile::Cli => "easytier-cli",
    };
    let extension = executable
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if stem != expected_stem || !matches!(extension.as_str(), "" | "exe") {
        return Err(format!(
            "内核文件名与程序类型不匹配: {}",
            executable.display()
        ));
    }

    // FILE_SHARE_READ 保留句柄到 spawn 返回，阻止校验后删除或改写可执行文件。
    #[cfg(windows)]
    let handle = {
        use std::os::windows::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .share_mode(0x0000_0001)
            .open(&executable)
            .map_err(|e| format!("读取 {} 失败: {e}", executable.display()))?
    };
    #[cfg(not(windows))]
    let handle =
        File::open(&executable).map_err(|e| format!("读取 {} 失败: {e}", executable.display()))?;

    let before = handle
        .metadata()
        .map_err(|e| format!("读取 {} 元数据失败: {e}", executable.display()))?;
    let before_modified = before
        .modified()
        .map_err(|e| format!("读取 {} 修改时间失败: {e}", executable.display()))?;
    let actual = sha256_reader(&mut &handle)
        .map_err(|e| format!("读取 {} 失败: {e}", executable.display()))?;
    let after = handle
        .metadata()
        .map_err(|e| format!("读取 {} 元数据失败: {e}", executable.display()))?;
    let after_modified = after
        .modified()
        .map_err(|e| format!("读取 {} 修改时间失败: {e}", executable.display()))?;
    if before.len() != after.len() || before_modified != after_modified {
        return Err(format!(
            "内核文件校验期间发生变化: {}",
            executable.display()
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev() || before.ino() != after.ino() {
            return Err(format!("内核文件校验期间被替换: {}", executable.display()));
        }
        if executable.canonicalize().ok().as_ref() != Some(&executable) {
            return Err(format!(
                "内核文件校验后路径发生变化: {}",
                executable.display()
            ));
        }
    }
    if !is_known_exe(&actual, file) {
        log::warn!(
            "kernel hash mismatch: path={} actual={} kind={:?}",
            executable.display(),
            actual,
            file
        );
        return Err(format!("内核文件校验失败: {}", executable.display()));
    }
    Ok(VerifiedExecutable {
        path: executable,
        _file: handle,
    })
}

/// Windows 的 `Command::new("...\\easytier-core")` 会自动补 `.exe`，
/// 但文件哈希必须读取真实存在的文件，这里做同样的扩展名解析。
fn resolve_exe_path(path: &Path) -> std::path::PathBuf {
    if path.exists() {
        return path.to_path_buf();
    }
    if path.extension().is_none() {
        let with_exe = path.with_extension("exe");
        if with_exe.exists() {
            return with_exe;
        }
    }
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_all_supported_versions() {
        for version in ["v2.7.1", "v2.6.4", "v2.5.0", "v2.4.5"] {
            assert!(
                expected_package(version).is_some(),
                "missing manifest for {version}"
            );
        }
    }

    #[test]
    fn resolves_extensionless_windows_path() {
        let dir = std::env::temp_dir().join("lighttier-hash-ext");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("easytier-core.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let resolved = resolve_exe_path(&dir.join("easytier-core"));
        assert_eq!(resolved, exe);
        let _ = std::fs::remove_file(&exe);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn unknown_version_is_rejected() {
        assert!(verify_package("v0.0.0", Path::new("missing.zip")).is_err());
    }

    #[test]
    fn rejects_executable_outside_core_directory() {
        let root = std::env::temp_dir().join("lighttier-hash-boundary");
        let _ = std::fs::remove_dir_all(&root);
        let core = root.join("core");
        std::fs::create_dir_all(&core).unwrap();
        let outside = root.join("easytier-core.exe");
        std::fs::write(&outside, b"MZ tampered").unwrap();

        assert!(open_verified_exe(&outside, CoreFile::Core, &core).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_nested_or_mismatched_executable() {
        let dir = std::env::temp_dir().join("lighttier-hash-layout");
        let _ = std::fs::remove_dir_all(&dir);
        let nested = dir.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("easytier-core.exe"), b"MZ tampered").unwrap();
        std::fs::write(dir.join("easytier-core.exe"), b"MZ tampered").unwrap();

        assert!(
            open_verified_exe(&nested.join("easytier-core.exe"), CoreFile::Core, &dir).is_err()
        );
        assert!(open_verified_exe(&dir.join("easytier-core.exe"), CoreFile::Cli, &dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escaping_core_directory() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join("lighttier-hash-symlink");
        let _ = std::fs::remove_dir_all(&root);
        let core = root.join("core");
        std::fs::create_dir_all(&core).unwrap();
        let outside = root.join("easytier-core.exe");
        std::fs::write(&outside, b"MZ tampered").unwrap();
        symlink(&outside, core.join("easytier-core.exe")).unwrap();

        assert!(open_verified_exe(&core.join("easytier-core.exe"), CoreFile::Core, &core).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unknown_hash_is_rejected() {
        let dir = std::env::temp_dir().join("lighttier-hash-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("easytier-core.exe");
        std::fs::write(&path, b"MZ tampered").unwrap();
        assert!(open_verified_exe(&path, CoreFile::Core, &dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
