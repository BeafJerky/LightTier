/**
 * agent 会话状态（登录 / 初始化 / 退出）。
 *
 * 只服务 agent 模式：native / mock 下 `isAgent` 为 false，布局不展示登出入口，
 * 路由守卫也不会安装（见 `app/router/authGuard.ts`），桌面原有锁屏与引导不受影响。
 *
 * 约定：
 * - `refresh()` 用 `GET /auth/session` 探测当前会话：401 → 未登录，428 → 未初始化；
 * - `login()` / `setup()` 的错误原样抛给页面，由 `authErrorKey()` 映射成文案；
 * - 会话接口本身是 `silentAuth` 调用，密码错误不会触发全局 401 跳转。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { backendAuth, backendMode, isApiError } from '@/shared/platform/backend'

/** 管理密码最小长度（与后端 `MIN_PASSWORD_LEN` 保持一致） */
export const AUTH_PASSWORD_MIN_LENGTH = 10

/** 鉴权页展示后端错误码对应的 i18n key（setup 页的 401 表示令牌无效而非密码错误） */
export const authErrorKey = (
  error: unknown,
  scope: 'login' | 'setup' | 'changePassword' = 'login'
): string => {
  if (!isApiError(error)) return 'newAuth.networkError'
  switch (error.code) {
    case 'auth_invalid':
      if (scope === 'setup') return 'newAuth.setupInvalid'
      if (scope === 'changePassword') return 'newAuth.changePasswordInvalid'
      return 'newAuth.authInvalid'
    case 'auth_rate_limited':
      return 'newAuth.authRateLimited'
    case 'setup_required':
      return 'newAuth.authSetupRequired'
    case 'already_initialized':
      return 'newAuth.alreadyInitialized'
    default:
      return 'newAuth.networkError'
  }
}

export const useAgentSessionStore = defineStore('agentSession', () => {
  /** 已建立有效会话（`GET /auth/session` 成功或登录 / 初始化成功） */
  const authenticated = ref(false)
  /** 实例尚未初始化（428）；此时只能进入 /setup */
  const setupRequired = ref(false)
  /** 会话探测进行中（守卫与页面据此展示加载态） */
  const checking = ref(false)

  /** 当前是否为 agent 模式：仅此模式展示登出入口、安装会话门禁 */
  const isAgent = computed(() => backendMode() === 'agent')

  /** 重新探测会话；网络异常原样抛给调用方（守卫按放行处理，页面展示通用错误） */
  const refresh = async (): Promise<void> => {
    checking.value = true
    try {
      const session = await backendAuth().session()
      authenticated.value = session.authenticated === true
      setupRequired.value = false
    } catch (error) {
      if (!isApiError(error)) throw error
      authenticated.value = false
      setupRequired.value = error.status === 428 || error.code === 'setup_required'
    } finally {
      checking.value = false
    }
  }

  /** 密码登录；失败（错误码 / 网络）原样抛出，由页面映射文案 */
  const login = async (password: string): Promise<void> => {
    await backendAuth().login(password)
    authenticated.value = true
    setupRequired.value = false
  }

  /**
   * 初始化管理员：令牌 + 密码。
   *
   * 后端 204 已下发会话 Cookie，契约仍要求随后用同一密码登录一次；
   * 补登失败不回滚初始化结果（管理员已生效），按已登录处理避免页面停留在错误态。
   */
  const setup = async (token: string, password: string): Promise<void> => {
    await backendAuth().setup(token, password)
    setupRequired.value = false
    try {
      await backendAuth().login(password)
    } catch {
      // 忽略：setup 成功即代表管理员已建立，Cookie 会话可用
    }
    authenticated.value = true
  }

  /** 退出登录：即使接口失败也清空本地登录态，随后由布局跳转 /login */
  const logout = async (): Promise<void> => {
    try {
      await backendAuth().logout()
    } finally {
      authenticated.value = false
    }
  }

  /** 服务端已清空会话（如改密成功）：仅标记本地未认证，跳转登录页由调用方负责 */
  const invalidate = (): void => {
    authenticated.value = false
  }

  return {
    authenticated,
    setupRequired,
    checking,
    isAgent,
    refresh,
    login,
    setup,
    logout,
    invalidate
  }
})
