//! 应用日志装配。
//!
//! 桌面端写入 `<exe>/logs`，移动端写入应用日志目录；两条路径共用同一轮转策略，
//! 文件上限 4MB、保留 5 个文件（插件默认 40KB + KeepOne 几乎无法回溯）。

use std::fmt::Arguments;

use tauri_plugin_log::fern::FormatCallback;
use tauri_plugin_log::{Target, TargetKind};

/// 与迁移前的 `<exe>/logs/lighttier.log` 保持一致（crate 包名不同，不能再用 CARGO_PKG_NAME）。
const LOG_FILE_NAME: &str = "lighttier";
const LOG_MAX_FILE_SIZE: u128 = 4 * 1024 * 1024;
const LOG_KEEP_FILES: usize = 5;

fn log_format(out: FormatCallback<'_>, message: &Arguments<'_>, record: &log::Record<'_>) {
    let date = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let target = record.target().split('@').next().unwrap_or(record.target());
    out.finish(format_args!(
        "{} {:<5} [{}]: {}",
        date,
        record.level(),
        target,
        message
    ));
}

fn base_builder(targets: Vec<Target>) -> tauri_plugin_log::Builder {
    tauri_plugin_log::Builder::new()
        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
        .max_file_size(LOG_MAX_FILE_SIZE)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(LOG_KEEP_FILES))
        .level(log::LevelFilter::Info)
        .format(log_format)
        .targets(targets)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn desktop_file_target() -> Option<Target> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();
    let log_dir = exe_dir.join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        log::warn!(
            "failed to create log directory at {}, file logs disabled",
            log_dir.display()
        );
        return None;
    }
    // 用 Folder 指定 <exe>/logs，而不是把完整路径塞进 LogDir.file_name：
    // 后者的轮转清理扫描的是系统日志目录，会导致历史文件无限累积
    Some(Target::new(TargetKind::Folder {
        path: log_dir,
        file_name: Some(LOG_FILE_NAME.to_string()),
    }))
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let mut targets = vec![Target::new(TargetKind::Stdout)];
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Some(file_target) = desktop_file_target() {
        targets.push(file_target);
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    let targets = vec![
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE_NAME.to_string()),
        }),
        Target::new(TargetKind::Webview),
    ];

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    targets.push(Target::new(TargetKind::Webview));

    base_builder(targets).build()
}
