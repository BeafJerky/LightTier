/**
 * 页面刷新回调：悬浮快捷菜单等外部动作触发当前页刷新。
 * 回调不是渲染状态，放在模块级变量中，避免无意义的响应式追踪与持久化取样。
 */
let pageRefreshCallback: (() => void) | null = null

export function createPageRefresh() {
  const registerPageRefresh = (cb: () => void) => {
    pageRefreshCallback = cb
  }
  const clearPageRefresh = () => {
    pageRefreshCallback = null
  }
  const triggerPageRefresh = () => {
    pageRefreshCallback?.()
  }

  return { registerPageRefresh, clearPageRefresh, triggerPageRefresh }
}
