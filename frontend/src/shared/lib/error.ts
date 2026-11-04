/**
 * 提取错误文案：Tauri 插件命令 reject 的是字符串，Error 与 { message } 也常见
 */
export const getErrorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message ?? '')
  }
  return e == null ? '' : String(e)
}
