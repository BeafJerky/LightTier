/** 设置弹窗内 Promise 化确认弹窗的签名（由弹窗父组件注入，替换原生 confirm） */
export type SettingsConfirm = (title: string, message: string) => Promise<boolean>

/** 设置弹窗的运行环境快照：桌面 Tauri 为 true，浏览器预览与 Android 均为 false */
export interface SettingsEnv {
  isDesktopRuntime: boolean
  isAndroidPlatform: boolean
}
