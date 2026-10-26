use chrono::Local;
use serde_json::json;
use std::fmt::Arguments;
use std::sync::Arc;
use tauri::Manager;
// AppHandle 仅桌面端代码使用（show_window），Android 端全路径引用
#[cfg(desktop)]
use tauri::AppHandle;

// Windows 平台专用的进程创建选项（CREATE_NO_WINDOW）
#[cfg(windows)]
use std::os::windows::process::CommandExt;
// 子进程调用仅桌面端使用，移动端由进程内内核替代
#[cfg(not(mobile))]
use std::process::Command;
use tauri_plugin_log::fern::FormatCallback;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;

// Windows 平台：不创建控制台窗口的进程创建标志
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// 应用日志保留策略：4MB × 约 5 个文件（插件默认 40KB/KeepOne 几乎无法回溯）
const APP_LOG_MAX_FILE_SIZE: u128 = 4 * 1024 * 1024;
const APP_LOG_KEEP_FILES: usize = 5;

// Android 平台：进程内内核集成（实例管理 + 进程内 RPC + TUN fd 注入）
#[cfg(target_os = "android")]
pub mod android;

/// 日志格式化公共函数：统一 tauri_plugin_log 的 format 闭包逻辑
fn log_format(out: FormatCallback<'_>, message: &Arguments<'_>, record: &log::Record<'_>) {
    let date = Local::now().format("%Y-%m-%d %H:%M:%S");
    let target = record.target().split('@').next().unwrap_or(record.target());
    out.finish(format_args!(
        "{} {:<5} [{}]: {}",
        date,
        record.level(),
        target,
        message
    ));
}

#[tauri::command]
async fn check_cold_start(app: tauri::AppHandle) -> bool {
    let current_pid = std::process::id() as u64;

    let store: Arc<tauri_plugin_store::Store<tauri::Wry>> = match app.store("cold_start.store") {
        Ok(store) => store,
        Err(err) => {
            log::warn!("init cold_start store failed: {}", err);
            return true;
        }
    };

    let existing_pid: u64 = match store.get("cold_start_token") {
        Some(val) => val.as_u64().unwrap_or(0),
        None => 0,
    };

    let is_cold = existing_pid == 0 || existing_pid != current_pid;

    store.set("cold_start_token", json!(current_pid));
    if let Err(err) = store.save() {
        log::warn!("save cold_start_token failed: {}", err);
    }

    is_cold
}

// 内核可执行文件白名单（安全收口）：仅允许运行资源目录 resource/core 下的
// easytier-core / easytier-cli，防止前端（含被注入脚本）借 run_command/run_cli 执行任意程序
#[cfg(not(mobile))]
fn ensure_core_program_allowed(app: &tauri::AppHandle, program: &str) -> Result<(), String> {
    let program_path = std::path::Path::new(program);
    let stem = program_path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if stem != "easytier-core" && stem != "easytier-cli" {
        return Err(format!("program not allowed: {program}"));
    }

    let core_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("failed to resolve resource dir: {e}"))?
        .join("resource")
        .join("core");

    let parent = match program_path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => return Err(format!("program has no parent directory: {program}")),
    };

    // 目录存在时用 canonicalize 严格比较；目录尚不存在（首次安装未下载内核）等
    // 失败场景退回字符串归一化比较（斜杠统一 + 小写 + 去尾斜杠）
    let allowed = match (parent.canonicalize(), core_dir.canonicalize()) {
        (Ok(p), Ok(c)) => p == c,
        _ => normalize_path(&parent) == normalize_path(&core_dir),
    };
    if !allowed {
        return Err(format!("program is outside core dir: {program}"));
    }
    Ok(())
}

#[cfg(not(mobile))]
fn normalize_path(p: &std::path::Path) -> String {
    p.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
        .trim_end_matches('/')
        .to_string()
}

#[tauri::command(rename_all = "snake_case")]
fn run_cli(app: tauri::AppHandle, program: String, args: Vec<String>) -> Result<String, String> {
    // 桌面端：通过子进程执行命令并捕获输出
    #[cfg(not(mobile))]
    {
        ensure_core_program_allowed(&app, &program)?;
        // DETACHED_PROCESS: 使进程在后台运行
        // const DETACHED_PROCESS: u32 = 0x00000008;
        let mut cmd = Command::new(&program);
        cmd.args(args);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        // 使用 output() 执行并收集输出；spawn/等待失败直接作为命令错误返回
        let output = cmd.output().map_err(|e| {
            log::error!("Failed to execute process: {}", e);
            format!("执行失败: {e}")
        })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            log::error!("run_cli exited with {:?}: {}", output.status.code(), stderr);
            return Err(if stderr.is_empty() { stdout } else { stderr });
        }
        String::from_utf8(output.stdout).map_err(|e| format!("输出解码失败: {e}"))
    }

    // 移动端：不支持子进程调用
    #[cfg(mobile)]
    {
        let _ = (app, program, args);
        Err("run_cli is not supported on mobile platform".to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
fn run_command(
    app: tauri::AppHandle,
    program: String,
    args: Vec<String>,
) -> Result<String, String> {
    // 桌面端：通过子进程在后台启动命令
    #[cfg(not(mobile))]
    {
        ensure_core_program_allowed(&app, &program)?;
        // DETACHED_PROCESS: 使进程在后台运行
        // const DETACHED_PROCESS: u32 = 0x00000008;
        let mut cmd = Command::new(&program);
        cmd.args(args)
            .stdout(std::process::Stdio::null()) // 将标准输出重定向到null
            .stderr(std::process::Stdio::null()); // 将标准错误重定向到null
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        // spawn 失败必须作为错误返回，避免前端把 "Error: ..." 当成 PID
        let child = cmd.spawn().map_err(|e| {
            log::error!("Failed to execute process: {}", e);
            format!("启动进程失败: {e}")
        })?;
        Ok(child.id().to_string())
    }

    // 移动端：不支持子进程调用
    #[cfg(mobile)]
    {
        let _ = (app, program, args);
        Err("run_command is not supported on mobile platform".to_string())
    }
}

#[tauri::command]
fn check_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// 用系统默认浏览器打开外部链接。
/// 不能直接用 plugin-shell 的 JS open：其 Android 侧仍走桌面实现，会失败；
/// 走 Rust API 才会在移动端调用 Kotlin Intent。
#[tauri::command]
#[allow(deprecated)]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_exe_directory(app: tauri::AppHandle) -> String {
    // 移动端：返回应用数据目录（配置、日志等均存放于此）
    #[cfg(mobile)]
    {
        return app
            .path()
            .app_data_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_default();
    }

    // 桌面端：返回可执行文件所在目录
    #[cfg(not(mobile))]
    {
        let _ = &app;
        desktop_exe_directory()
    }
}

// 桌面端获取可执行文件所在目录
#[cfg(not(mobile))]
fn desktop_exe_directory() -> String {
    match std::env::current_exe() {
        Ok(exe_path) => {
            if let Some(parent) = exe_path.parent() {
                return parent.display().to_string();
            }
            "".to_string()
        }
        Err(e) => {
            log::error!("failed to get current exe path: {e}");
            "".to_string()
        }
    }
}

// 获取日志目录（程序安装目录下的 logs，仅桌面端使用）
#[cfg(not(mobile))]
fn get_log_directory() -> String {
    format!("{}/logs", desktop_exe_directory())
}

// 桌面端：聚焦主窗口（单实例插件回调使用）
#[cfg(desktop)]
fn show_window(app: &AppHandle) {
    let windows = app.webview_windows();

    windows
        .values()
        .next()
        .expect("Sorry, no window found")
        .set_focus()
        .expect("Can't Bring Window to Focus");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 桌面端：子进程语义的命令
    #[cfg(not(target_os = "android"))]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            run_command,
            run_cli,
            get_exe_directory,
            check_cold_start,
            check_port_available,
            open_external_url
        ]);
    }

    // Android：通用命令 + 进程内内核命令（无子进程、无 easytier-cli）
    #[cfg(target_os = "android")]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            run_command,
            run_cli,
            get_exe_directory,
            check_cold_start,
            check_port_available,
            open_external_url,
            android::start_instance,
            android::stop_instance,
            android::list_instances,
            android::query_node,
            android::query_peer,
            android::query_routes,
            android::set_tun_fd,
            android::get_core_version
        ]);
    }

    // 桌面端：单实例插件（第二次启动时聚焦已有窗口）
    #[cfg(not(mobile))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }));
    }

    // 桌面端：尝试创建日志目录（如果失败也继续运行）
    #[cfg(not(mobile))]
    {
        let log_dir = get_log_directory();
        let log_dir_created = std::fs::create_dir_all(&log_dir).is_ok();

        if !log_dir_created {
            log::warn!("Failed to create log directory at: {}", log_dir);
            log::warn!("Logs will only be output to console.");
        }

        // 只有在日志目录创建成功时才启用文件日志
        if log_dir_created {
            builder = builder.plugin(
                tauri_plugin_log::Builder::new()
                    .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                    .max_file_size(APP_LOG_MAX_FILE_SIZE)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(
                        APP_LOG_KEEP_FILES,
                    ))
                    .level(log::LevelFilter::Info)
                    .format(log_format)
                    .targets([
                        Target::new(TargetKind::Stdout),
                        // 用 Folder 指定 <exe>/logs，而不是把完整路径塞进 LogDir.file_name：
                        // 后者的轮转清理扫描的是系统日志目录，会导致历史文件无限累积
                        Target::new(TargetKind::Folder {
                            path: log_dir.clone().into(),
                            file_name: Some(env!("CARGO_PKG_NAME").to_string()),
                        }),
                        Target::new(TargetKind::Webview),
                    ])
                    .build(),
            );
        } else {
            // 日志目录创建失败，仅使用控制台和 Webview 输出
            builder = builder.plugin(
                tauri_plugin_log::Builder::new()
                    .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                    .max_file_size(APP_LOG_MAX_FILE_SIZE)
                    .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(
                        APP_LOG_KEEP_FILES,
                    ))
                    .level(log::LevelFilter::Info)
                    .format(log_format)
                    .targets([
                        Target::new(TargetKind::Stdout),
                        Target::new(TargetKind::Webview),
                    ])
                    .build(),
            );
        }
    }

    // 移动端：文件日志写入应用私有日志目录（LogDir target 在插件初始化时解析到应用日志目录）
    #[cfg(mobile)]
    {
        builder = builder.plugin(
            tauri_plugin_log::Builder::new()
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .max_file_size(APP_LOG_MAX_FILE_SIZE)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(
                    APP_LOG_KEEP_FILES,
                ))
                .level(log::LevelFilter::Info)
                .format(log_format)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(env!("CARGO_PKG_NAME").to_string()),
                    }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        );
    }

    // 配置插件
    #[allow(unused_mut)]
    let mut app_builder = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build());

    // 桌面端：窗口状态记录插件
    #[cfg(desktop)]
    {
        app_builder = app_builder.plugin(tauri_plugin_window_state::Builder::new().build());
    }

    // Android：VPN 服务插件（Kotlin VpnService + TUN fd 事件）
    #[cfg(target_os = "android")]
    {
        app_builder = app_builder.plugin(tauri_plugin_vpnservice::init());
    }

    // 仅桌面生产环境下启用 prevent-default 插件，禁用右键菜单和快捷键
    #[cfg(all(desktop, not(debug_assertions)))]
    {
        use tauri_plugin_prevent_default::{Builder, Flags};
        let prevent_default_plugin = Builder::new()
            .with_flags(Flags::CONTEXT_MENU | Flags::RELOAD | Flags::DEV_TOOLS)
            .build();
        app_builder = app_builder.plugin(prevent_default_plugin);
    }

    app_builder
        .setup(|app| {
            tauri::async_runtime::block_on(async {
                match app.store("cold_start.store") {
                    Ok(store) => {
                        let store: Arc<tauri_plugin_store::Store<tauri::Wry>> = store;
                        if let Err(err) = store.save() {
                            log::warn!("init cold_start store save failed: {}", err);
                        }
                    }
                    Err(err) => log::warn!("init cold_start store failed: {}", err),
                };
            });

            // Android：启动进程内 easytier 内核与 RPC 服务
            #[cfg(target_os = "android")]
            android::setup();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
