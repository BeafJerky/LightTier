/**
 * agent 会话门禁单测（memory router，不挂载应用）。
 *
 * 覆盖：未登录 / 未初始化重定向、已登录放行、public 白名单、同一批次只探测一次、
 * 重复安装幂等，以及 401 / 428 全局回调的跳转。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { installAgentAuthGuard } from '@/app/router/authGuard'

const api = vi.hoisted(() => ({
  mode: 'agent' as 'agent' | 'native',
  session: vi.fn(),
  unauthorized: null as (() => void) | null,
  setupRequired: null as (() => void) | null
}))

vi.mock('@/shared/platform/backend', () => ({
  backendMode: () => api.mode,
  backendAuth: () => ({
    session: api.session,
    login: vi.fn(),
    setup: vi.fn(),
    logout: vi.fn()
  }),
  isApiError: (error: unknown) =>
    typeof error === 'object' && error !== null && (error as { name?: string }).name === 'ApiError',
  onUnauthorized: (handler: () => void) => {
    api.unauthorized = handler
    return () => {
      if (api.unauthorized === handler) api.unauthorized = null
    }
  },
  onSetupRequired: (handler: () => void) => {
    api.setupRequired = handler
    return () => {
      if (api.setupRequired === handler) api.setupRequired = null
    }
  }
}))

const Stub = { render: () => null }

const apiError = (code: string, status: number): Error =>
  Object.assign(new Error(code), { name: 'ApiError', code, status })

const makeRouter = (): Router =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/new' },
      { path: '/new', name: 'New', component: Stub, meta: {} },
      { path: '/login', name: 'Login', component: Stub, meta: { public: true } },
      { path: '/setup', name: 'Setup', component: Stub, meta: { public: true } }
    ]
  })

const makeGuardedRouter = (): Router => {
  const router = makeRouter()
  installAgentAuthGuard(router)
  return router
}

describe('installAgentAuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.mode = 'agent'
    api.unauthorized = null
    api.setupRequired = null
    setActivePinia(createPinia())
  })

  it('未登录：受保护路由重定向到 /login，重定向链只探测一次会话', async () => {
    api.session.mockRejectedValue(apiError('auth_required', 401))
    const router = makeGuardedRouter()

    // 从 / 进入会先重定向到 /new，再被守卫送到 /login：同一批次只查一次
    await router.push('/')

    expect(router.currentRoute.value.name).toBe('Login')
    expect(api.session).toHaveBeenCalledTimes(1)
  })

  it('未初始化（428）：重定向到 /setup', async () => {
    api.session.mockRejectedValue(apiError('setup_required', 428))
    const router = makeGuardedRouter()

    await router.push('/new')

    expect(router.currentRoute.value.name).toBe('Setup')
  })

  it('已登录：受保护路由放行', async () => {
    api.session.mockResolvedValue({ authenticated: true })
    const router = makeGuardedRouter()

    await router.push('/new')

    expect(router.currentRoute.value.name).toBe('New')
  })

  it('public 白名单（登录 / 初始化页）不触发会话探测', async () => {
    const router = makeGuardedRouter()

    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('Login')

    await router.push('/setup')
    expect(router.currentRoute.value.name).toBe('Setup')

    expect(api.session).not.toHaveBeenCalled()
  })

  it('重复安装幂等：同一 router 只注册一次守卫', async () => {
    api.session.mockResolvedValue({ authenticated: true })
    const router = makeRouter()
    installAgentAuthGuard(router)
    installAgentAuthGuard(router)

    await router.push('/new')

    expect(router.currentRoute.value.name).toBe('New')
    expect(api.session).toHaveBeenCalledTimes(1)
  })

  it('非 agent 模式不安装门禁：受保护路由直接放行', async () => {
    api.mode = 'native'
    const router = makeGuardedRouter()

    await router.push('/new')

    expect(router.currentRoute.value.name).toBe('New')
    expect(api.session).not.toHaveBeenCalled()
  })

  it('401 全局回调跳转 /login，428 回调跳转 /setup', async () => {
    api.session.mockResolvedValue({ authenticated: true })
    const router = makeGuardedRouter()
    await router.push('/new')

    api.unauthorized?.()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('Login'))

    api.setupRequired?.()
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe('Setup'))
  })
})
