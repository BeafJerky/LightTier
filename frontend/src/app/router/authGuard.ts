/**
 * agent 会话门禁（仅 agent 模式安装）。
 *
 * 由 `main.ts` 在 `initBackend()` 判定为 agent 后安装；native / mock 不注册任何
 * 守卫与回调，桌面启动、锁屏与路由行为保持原样。
 *
 * - 受保护路由：先探测会话，未登录 → `/login`，未初始化（428）→ `/setup`；
 * - `meta.public` 路由（登录 / 初始化页）直接放行，天然打断重定向循环；
 * - 401 / 428 全局回调：页面调用触发的会话失效 → `/login`，未初始化 → `/setup`；
 * - 同一导航批次（含守卫返回的重定向）只查一次会话，`afterEach` 清理缓存，
 *   下一次导航重新校验；
 * - 会话探测的网络异常按“放行”处理：避免瞬时故障把用户永久锁在登录页，
 *   页面自身的请求仍会按错误码提示。
 */
import type { Router } from 'vue-router'
import { backendMode, onSetupRequired, onUnauthorized } from '@/shared/platform/backend'
import { useAgentSessionStore } from '@/shared/store/agentSession'

export const LOGIN_ROUTE_NAME = 'Login'
export const SETUP_ROUTE_NAME = 'Setup'

type Gate = 'authenticated' | 'login' | 'setup'

// 同一 router 只安装一次（热重载 / 重复调用幂等）
const installedRouters = new WeakSet<Router>()

/**
 * 注册 401 / 428 跳转回调与路由守卫。
 *
 * 可重复调用：同一 router 重复安装不会重复注册守卫。
 */
export const installAgentAuthGuard = (router: Router): void => {
  if (installedRouters.has(router)) return
  installedRouters.add(router)

  // 本次导航批次内的会话结论；afterEach 清空
  let gate: Gate | null = null

  const redirectTo = (name: string) => {
    // 已在该页面时不再导航，避免并发的多条 401 产生重复跳转
    if (router.currentRoute.value.name === name) return
    void router.replace({ name })
  }

  onUnauthorized(() => redirectTo(LOGIN_ROUTE_NAME))
  onSetupRequired(() => redirectTo(SETUP_ROUTE_NAME))

  const resolveGate = async (): Promise<Gate> => {
    if (gate) return gate
    const session = useAgentSessionStore()
    try {
      await session.refresh()
      gate = session.setupRequired ? 'setup' : session.authenticated ? 'authenticated' : 'login'
    } catch {
      gate = 'authenticated'
    }
    return gate
  }

  router.beforeEach(async (to) => {
    // 非 agent（含初始化前的 native 默认值）不改变既有导航行为
    if (backendMode() !== 'agent') return true
    if (to.meta.public) return true
    const resolved = await resolveGate()
    if (resolved === 'setup') return { name: SETUP_ROUTE_NAME, replace: true }
    if (resolved === 'login') return { name: LOGIN_ROUTE_NAME, replace: true }
    return true
  })

  // 一次导航（含重定向链）结束后失效缓存，下次导航重新探测会话
  router.afterEach(() => {
    gate = null
  })
}
