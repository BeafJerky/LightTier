//! LightTier 桌面/移动端入口装配。
//!
//! 平台差异集中在此：桌面端使用子进程内核、单实例与窗口状态记录；
//! Android 端使用进程内内核（见 `android` 模块）。

#[cfg(desktop)]
use tauri::{AppHandle, Manager};

mod commands;

#[cfg(target_os = "android")]
pub mod android;

/// 桌面端：聚焦主窗口（单实例插件回调使用）。
/// 第二次启动可能早于窗口创建，窗口缺失时只记录日志，避免 panic。
#[cfg(desktop)]
fn focus_main_window(app: &AppHandle) {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());
    let Some(window) = window else {
        log::warn!("skip focusing: main window is not ready");
        return;
    };
    if let Err(err) = window.set_focus() {
        log::warn!("failed to focus main window: {err}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // 桌面端：子进程语义的命令 + 应用内更新安装器
    #[cfg(desktop)]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            commands::process::run_command,
            commands::system::check_port_available,
            commands::system::open_external_url,
            commands::update::launch_update_installer
        ]);
    }

    // Android：通用命令 + 进程内内核命令（无子进程、无 easytier-cli）
    #[cfg(target_os = "android")]
    {
        builder = builder.invoke_handler(tauri::generate_handler![
            commands::process::run_command,
            commands::system::check_port_available,
            commands::system::open_external_url,
            android::instance::start_instance,
            android::instance::stop_instance,
            android::instance::list_instances,
            android::rpc::query_node,
            android::rpc::query_peer,
            android::rpc::query_routes,
            android::vpn::set_tun_fd,
            android::get_core_version
        ]);
    }

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }));
    }

    builder = builder.plugin(lighttier_core::logging::init());

    // 配置插件
    #[allow(unused_mut)]
    let mut app_builder = builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

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
        .setup(|_app| {
            // Android：启动进程内 easytier 内核与 RPC 服务
            #[cfg(target_os = "android")]
            android::setup();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
