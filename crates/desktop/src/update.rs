//! 应用内更新：启动已下载的桌面安装包。
//!
//! 安装包位于 `<resource>/resource/update`，覆盖安装会与自身文件句柄冲突，
//! 因此先复制到临时目录再启动；启动后延迟退出，避免 NSIS 写文件时旧 exe 仍被占用。

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Manager;

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

pub fn launch_update_installer(app: &tauri::AppHandle, installer: &str) -> Result<(), String> {
    validate_installer_name(installer)?;

    let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let source = resource_dir.join("resource").join("update").join(installer);
    let bytes = std::fs::read(&source).map_err(|e| format!("读取安装包失败: {e}"))?;
    // 文件头必须是 PE 的 "MZ"：镜像站可能把 HTML 错误页存成 .exe，不能直接执行
    if bytes.len() < 2 || &bytes[..2] != b"MZ" {
        return Err(format!("安装包内容不是可执行程序: {installer}"));
    }

    let staged = std::env::temp_dir().join(installer);
    std::fs::write(&staged, &bytes).map_err(|e| format!("复制安装包失败: {e}"))?;

    let mut command = Command::new(&staged);
    #[cfg(windows)]
    // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP：脱离本进程控制台，应用退出后安装器继续运行
    command.creation_flags(0x0000_0208);
    command
        .spawn()
        .map_err(|e| format!("启动安装器失败: {e}"))?;

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        handle.exit(0);
    });
    Ok(())
}
