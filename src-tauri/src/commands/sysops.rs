//! 系统操作命令（薄包装，实现见 `lighttier-desktop::sysops`）。
//!
//! 安全边界：前端不再直接执行 powershell / route / taskkill；
//! 所有参数在 `lighttier-desktop::sysops` 内校验后按固定模板执行。

use lighttier_desktop::sysops::exec::CommandResult;
use lighttier_desktop::sysops::{adapter, process::ProcessInfo, route::RouteRow};

#[tauri::command]
pub fn sysops_active_adapter() -> Result<Option<String>, String> {
    adapter::active_adapter()
}

#[tauri::command]
pub fn sysops_default_gateway() -> Result<Option<String>, String> {
    adapter::default_gateway()
}

#[tauri::command]
pub fn sysops_set_adapter_metric(name: String, enabled: bool) -> Result<(), String> {
    adapter::set_adapter_metric(&name, enabled)
}

#[tauri::command]
pub fn sysops_route_add(
    target: String,
    mask: String,
    gateway: String,
    metric: u32,
) -> Result<(), String> {
    lighttier_desktop::sysops::route::add_route(&target, &mask, &gateway, metric)
}

#[tauri::command]
pub fn sysops_route_delete(target: String, mask: String, gateway: String) -> Result<(), String> {
    lighttier_desktop::sysops::route::delete_route(&target, &mask, &gateway)
}

#[tauri::command]
pub fn sysops_route_change_default(gateway: String, metric: u32) -> Result<(), String> {
    lighttier_desktop::sysops::route::change_default_route(&gateway, metric)
}

#[tauri::command]
pub fn sysops_route_print() -> Result<Vec<RouteRow>, String> {
    lighttier_desktop::sysops::route::print_routes()
}

#[tauri::command]
pub fn sysops_route_exists(ip: String) -> Result<bool, String> {
    lighttier_desktop::sysops::route::route_exists(&ip)
}

#[tauri::command]
pub fn sysops_list_processes(filter: String) -> Result<Vec<ProcessInfo>, String> {
    lighttier_desktop::sysops::process::list_processes(&filter)
}

#[tauri::command]
pub fn sysops_kill_process(pid: u32) -> Result<bool, String> {
    lighttier_desktop::sysops::process::kill_process(pid)
}

#[tauri::command]
pub fn sysops_nssm_run(app: tauri::AppHandle, args: Vec<String>) -> Result<CommandResult, String> {
    lighttier_desktop::sysops::nssm::run(&app, args)
}

#[tauri::command]
pub fn sysops_cli_run(app: tauri::AppHandle, args: Vec<String>) -> Result<CommandResult, String> {
    lighttier_desktop::sysops::cli::run(&app, args)
}

#[tauri::command]
pub fn sysops_ensure_executable(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    lighttier_desktop::sysops::exec::ensure_executable(&app, paths)
}

#[tauri::command]
pub fn sysops_verify_core_package(
    app: tauri::AppHandle,
    version: String,
    path: String,
) -> Result<String, String> {
    lighttier_desktop::sysops::exec::verify_core_package(&app, &version, &path)
}

#[tauri::command]
pub fn sysops_verify_core_files(app: tauri::AppHandle) -> Result<(), String> {
    lighttier_desktop::sysops::exec::verify_core_files(&app)
}
