/**
 * 本地存储读写（值统一 JSON 编码）
 *
 * 非浏览器环境（vitest node）退化为空操作。
 * 读取容忍历史遗留的裸文本与 { value } 包装，避免旧数据让调用方拿到 null。
 */
export const useStorage = (type: 'localStorage' | 'sessionStorage' = 'localStorage') => {
  const storage: Storage | null = typeof window !== 'undefined' ? window[type] : null

  const setStorage = (key: string, value: unknown) => {
    storage?.setItem(key, JSON.stringify(value))
  }

  const getStorage = (key: string): unknown => {
    const raw = storage?.getItem(key)
    if (raw == null) return raw
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && 'value' in parsed) {
        return (parsed as { value: unknown }).value
      }
      return parsed
    } catch {
      return raw
    }
  }

  const removeStorage = (key: string) => {
    storage?.removeItem(key)
  }

  return { getStorage, setStorage, removeStorage }
}
