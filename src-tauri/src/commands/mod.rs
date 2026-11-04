//! 与前端交互的 Tauri 命令。
//!
//! 按职责拆分：进程启动（含安全白名单）、系统能力、应用内更新安装。
//! 命令名、参数与返回结构保持不变，注册入口见 `lib.rs`。

pub mod process;
pub mod system;

#[cfg(desktop)]
pub mod update;
