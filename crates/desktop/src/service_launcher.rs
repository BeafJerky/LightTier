//! SCM 服务的安全入口：先校验内核，再等待子进程并透传退出码。

use std::path::{Path, PathBuf};
use std::process::{Child, Command};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub const SERVICE_CORE_ARG: &str = "--lighttier-service-core";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 仅分派位于首位的完整隐藏参数；普通 GUI 参数保持原样。
pub fn parse_service_args(args: &[String]) -> Option<&[String]> {
    if args.first().map(String::as_str) == Some(SERVICE_CORE_ARG) {
        Some(&args[1..])
    } else {
        None
    }
}

pub fn core_path_for_exe(executable: &Path) -> PathBuf {
    core_dir_for_exe(executable).join(if cfg!(windows) {
        "easytier-core.exe"
    } else {
        "easytier-core"
    })
}

fn core_dir_for_exe(executable: &Path) -> PathBuf {
    executable
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("resource/core")
}

/// 在 Tauri 初始化前运行；返回 None 表示应继续普通 GUI 启动。
pub fn run_entry() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(SERVICE_CORE_ARG)) {
        return None;
    }
    // 只有服务入口需要把参数转换为 UTF-8，普通 GUI 启动不读取其余参数。
    let core_args = args
        .map(|arg| {
            arg.into_string()
                .map_err(|_| "服务内核参数不是有效 UTF-8".to_string())
        })
        .collect::<Result<Vec<_>, _>>();
    let result = core_args.and_then(|args| {
        std::env::current_exe()
            .map_err(|error| format!("无法解析 LightTier 可执行文件: {error}"))
            .and_then(|executable| run_service_core(&core_dir_for_exe(&executable), &args))
    });
    match result {
        Ok(code) => Some(code),
        Err(error) => {
            eprintln!("LightTier 服务启动失败: {error}");
            Some(1)
        }
    }
}

pub fn run_service_core(core_dir: &Path, args: &[String]) -> Result<i32, String> {
    let executable = crate::kernel_manifest::open_verified_exe(
        &core_dir.join(if cfg!(windows) {
            "easytier-core.exe"
        } else {
            "easytier-core"
        }),
        crate::kernel_manifest::CoreFile::Core,
        core_dir,
    )?;
    let mut command = Command::new(executable.path());
    command
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    // 校验句柄必须保留到 spawn 返回，阻止校验后替换可执行文件。
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动服务内核失败: {error}"))?;
    drop(executable);
    wait_for_exit(&mut child)
}

fn wait_for_exit(child: &mut Child) -> Result<i32, String> {
    child
        .wait()
        .map_err(|error| format!("等待服务内核退出失败: {error}"))?
        .code()
        .ok_or_else(|| "服务内核被信号终止，无退出码".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::Command;

    #[test]
    fn dispatches_only_the_exact_leading_service_flag() {
        let plain = vec!["--config-file".to_string(), "a.toml".to_string()];
        assert_eq!(parse_service_args(&plain), None);

        let mut service = vec![SERVICE_CORE_ARG.to_string()];
        service.extend(plain.clone());
        assert_eq!(parse_service_args(&service), Some(plain.as_slice()));

        let mut misplaced = plain.clone();
        misplaced.push(SERVICE_CORE_ARG.to_string());
        assert_eq!(parse_service_args(&misplaced), None);
        assert_eq!(
            parse_service_args(&[format!("{SERVICE_CORE_ARG}-extra")]),
            None
        );
        assert_eq!(
            parse_service_args(&[SERVICE_CORE_ARG.to_string()]),
            Some([].as_slice())
        );
    }

    #[test]
    fn resolves_core_relative_to_the_running_lighttier_executable() {
        let exe = PathBuf::from("C:/Program Files/LightTier/lighttier.exe");
        let expected =
            PathBuf::from("C:/Program Files/LightTier/resource/core").join(if cfg!(windows) {
                "easytier-core.exe"
            } else {
                "easytier-core"
            });
        assert_eq!(core_path_for_exe(&exe), expected);
    }

    #[test]
    fn rejects_tampered_core_before_spawning() {
        let core = std::env::temp_dir().join(format!(
            "lighttier-service-core-tampered-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&core);
        std::fs::create_dir_all(&core).unwrap();
        let executable = core.join(if cfg!(windows) {
            "easytier-core.exe"
        } else {
            "easytier-core"
        });
        std::fs::write(&executable, b"MZ tampered").unwrap();

        let error =
            run_service_core(&core, &["--config-file".into(), "a.toml".into()]).unwrap_err();
        assert!(error.contains("校验失败"), "{error}");
        let _ = std::fs::remove_dir_all(&core);
    }

    #[cfg(windows)]
    #[test]
    fn waits_and_returns_the_child_exit_code_unchanged() {
        let mut child = Command::new("cmd.exe")
            .args(["/D", "/C", "exit", "37"])
            .spawn()
            .unwrap();
        assert_eq!(wait_for_exit(&mut child).unwrap(), 37);
    }

    #[cfg(unix)]
    #[test]
    fn waits_and_returns_the_child_exit_code_unchanged() {
        let mut child = Command::new("sh").args(["-c", "exit 37"]).spawn().unwrap();
        assert_eq!(wait_for_exit(&mut child).unwrap(), 37);
    }
}
