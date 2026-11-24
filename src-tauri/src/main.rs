// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(desktop)]
    if let Some(exit_code) = lighttier_desktop::service_launcher::run_entry() {
        std::process::exit(exit_code);
    }
    app_lib::run();
}
