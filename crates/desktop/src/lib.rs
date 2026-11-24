//! LightTier 桌面端能力（子进程内核、应用内更新）。

pub use lighttier_core::kernel_manifest;
pub mod process;
pub mod service_launcher;
pub mod sysops;
pub mod update;
