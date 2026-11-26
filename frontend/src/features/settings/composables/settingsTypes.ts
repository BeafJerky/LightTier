/** 设置弹窗内 Promise 化确认弹窗的签名（由弹窗父组件注入，替换原生 confirm） */
export type SettingsConfirm = (title: string, message: string) => Promise<boolean>

/** 设置弹窗的运行环境快照：桌面 Tauri 为 true，浏览器预览与 Android 均为 false */
export interface SettingsEnv {
  isDesktopRuntime: boolean
  isAndroidPlatform: boolean
  /** agent 模式的服务端能力位；native / mock 为 null（相关入口全部可见） */
  capabilities: {
    routes: boolean
    services: boolean
    themes: boolean
    update: boolean
    tray: boolean
    kernel: boolean
    logs: boolean
    mirror: boolean
  } | null
}
