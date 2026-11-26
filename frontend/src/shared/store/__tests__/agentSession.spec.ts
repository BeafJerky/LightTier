/**
 * agent 会话 store 单测。
 *
 * 覆盖：会话探测（200 / 401 / 428 / 网络异常）、登录成败、初始化后补登、
 * 退出登录清态，以及后端错误码到 i18n key 的映射。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  AUTH_PASSWORD_MIN_LENGTH,
  authErrorKey,
  useAgentSessionStore
} from '@/shared/store/agentSession'

const api = vi.hoisted(() => ({
  mode: 'agent' as 'agent' | 'native' | 'mock' | 'offline',
  session: vi.fn(),
  login: vi.fn(),
  setup: vi.fn(),
  logout: vi.fn()
}))

vi.mock('@/shared/platform/backend', () => ({
  backendMode: () => api.mode,
  backendAuth: () => ({
    session: api.session,
    login: api.login,
    setup: api.setup,
    logout: api.logout
  }),
  // 与 http.ts 的 ApiError 判定等价：只认携带 name = 'ApiError' 的错误
  isApiError: (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { name?: string }).name === 'ApiError'
}))

const apiError = (code: string, status: number): Error =>
  Object.assign(new Error(code), { name: 'ApiError', code, status })

describe('useAgentSessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.mode = 'agent'
    setActivePinia(createPinia())
  })

  it('isAgent 仅在 agent 模式为 true', () => {
    const store = useAgentSessionStore()
    expect(store.isAgent).toBe(true)

    api.mode = 'native'
    setActivePinia(createPinia())
    expect(useAgentSessionStore().isAgent).toBe(false)
  })

  it('refresh：会话有效置为已登录', async () => {
    api.session.mockResolvedValue({ authenticated: true })
    const store = useAgentSessionStore()

    await store.refresh()

    expect(store.authenticated).toBe(true)
    expect(store.setupRequired).toBe(false)
    expect(store.checking).toBe(false)
  })

  it('refresh：401 置为未登录且不要求初始化', async () => {
    api.session.mockRejectedValue(apiError('auth_required', 401))
    const store = useAgentSessionStore()

    await store.refresh()

    expect(store.authenticated).toBe(false)
    expect(store.setupRequired).toBe(false)
    expect(store.checking).toBe(false)
  })

  it('refresh：428 置为未初始化', async () => {
    api.session.mockRejectedValue(apiError('setup_required', 428))
    const store = useAgentSessionStore()

    await store.refresh()

    expect(store.setupRequired).toBe(true)
    expect(store.authenticated).toBe(false)
  })

  it('refresh：网络异常原样抛出并复位 checking', async () => {
    api.session.mockRejectedValue(new TypeError('failed to fetch'))
    const store = useAgentSessionStore()

    await expect(store.refresh()).rejects.toBeInstanceOf(TypeError)
    expect(store.authenticated).toBe(false)
    expect(store.checking).toBe(false)
  })

  it('login：成功后置为已登录并透传密码', async () => {
    api.login.mockResolvedValue(undefined)
    const store = useAgentSessionStore()

    await store.login('secret-pass')

    expect(api.login).toHaveBeenCalledWith('secret-pass')
    expect(store.authenticated).toBe(true)
    expect(store.setupRequired).toBe(false)
  })

  it('login：密码错误抛出 auth_invalid 且保持未登录', async () => {
    const error = apiError('auth_invalid', 401)
    api.login.mockRejectedValue(error)
    const store = useAgentSessionStore()

    await expect(store.login('wrong-pass')).rejects.toBe(error)
    expect(store.authenticated).toBe(false)
    expect(authErrorKey(error)).toBe('newAuth.authInvalid')
  })

  it('setup：初始化成功后用同一密码补登', async () => {
    api.setup.mockResolvedValue(undefined)
    api.login.mockResolvedValue(undefined)
    const store = useAgentSessionStore()

    await store.setup('token-1', 'secret-pass')

    expect(api.setup).toHaveBeenCalledWith('token-1', 'secret-pass')
    expect(api.login).toHaveBeenCalledWith('secret-pass')
    expect(store.authenticated).toBe(true)
    expect(store.setupRequired).toBe(false)
  })

  it('setup：补登失败仍视为已初始化（Cookie 会话已建立）', async () => {
    api.setup.mockResolvedValue(undefined)
    api.login.mockRejectedValue(apiError('auth_rate_limited', 429))
    const store = useAgentSessionStore()

    await store.setup('token-1', 'secret-pass')

    expect(store.authenticated).toBe(true)
    expect(store.setupRequired).toBe(false)
  })

  it('setup：令牌无效时抛出且不置登录态', async () => {
    const error = apiError('auth_invalid', 401)
    api.setup.mockRejectedValue(error)
    const store = useAgentSessionStore()

    await expect(store.setup('bad-token', 'secret-pass')).rejects.toBe(error)
    expect(store.authenticated).toBe(false)
  })

  it('logout：无论接口成败都清空登录态', async () => {
    api.session.mockResolvedValue({ authenticated: true })
    const store = useAgentSessionStore()
    await store.refresh()
    expect(store.authenticated).toBe(true)

    api.logout.mockResolvedValue(undefined)
    await store.logout()
    expect(store.authenticated).toBe(false)

    api.session.mockResolvedValue({ authenticated: true })
    await store.refresh()
    api.logout.mockRejectedValue(new TypeError('failed to fetch'))
    await expect(store.logout()).rejects.toBeInstanceOf(TypeError)
    expect(store.authenticated).toBe(false)
  })
})

describe('authErrorKey', () => {
  it('按错误码映射到 i18n key', () => {
    expect(authErrorKey(apiError('auth_invalid', 401))).toBe('newAuth.authInvalid')
    expect(authErrorKey(apiError('auth_invalid', 401), 'setup')).toBe('newAuth.setupInvalid')
    expect(authErrorKey(apiError('auth_rate_limited', 429))).toBe('newAuth.authRateLimited')
    expect(authErrorKey(apiError('setup_required', 428))).toBe('newAuth.authSetupRequired')
    expect(authErrorKey(apiError('already_initialized', 409))).toBe('newAuth.alreadyInitialized')
    expect(authErrorKey(apiError('internal', 500))).toBe('newAuth.networkError')
    expect(authErrorKey(new TypeError('failed to fetch'))).toBe('newAuth.networkError')
  })

  it('管理密码最小长度与后端约定一致', () => {
    expect(AUTH_PASSWORD_MIN_LENGTH).toBe(10)
  })
})
