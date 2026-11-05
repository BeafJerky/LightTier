//! 平台能力抽象：实例扫描、内核查询与配置目录解析。
//!
//! 桌面走进程扫描 + `easytier-cli`，Android 走进程内实例管理器 + 进程内 RPC。

#[cfg(not(target_os = "android"))]
mod desktop;
#[cfg(not(target_os = "android"))]
pub use desktop::*;

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::*;
