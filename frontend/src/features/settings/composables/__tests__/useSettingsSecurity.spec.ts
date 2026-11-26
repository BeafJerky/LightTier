/**
 * 安全设置 composable 的 agent 管理密码分支单测。
 *
 * 覆盖：客户端校验（非空 / ≥10 位 / 两次一致）、成功后清本地会话并跳转登录页、
 * 错误码映射（auth_invalid → changePasswordInvalid）、会话失效（auth_required）跳转。
 * 桌面锁屏密码逻辑不在此覆盖（保持原样）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsSecurity } from '@/features/settings/composables/useSettingsSecurity'
import { useAgentSessionStore } from '@/shared/store/agentSession'

const mocks = vi.hoisted(() => ({
  mode: 'agent' as 'agent' | 'native' | 'mock',
  changePassword: vi.fn(),
  session: vi.fn(),
  login: vi.fn(),
  setup: vi.fn(),
  logout: vi.fn(),
  routerReplace: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.routerReplace }) }))
vi.mock('@/shared/ui', () => ({ LtInput: {} }))
vi.mock('@/shared/ui/useCreamToast', () => ({ useCreamToast: () => mocks.toast }))
vi.mock('@/shared/store/easytier', () => ({ useEasyTierStore: () => ({ lockPassword: '' }) }))
vi.mock('@/shared/platform/lockUtil', () => ({
  hashLockPassword: vi.fn((p: string) => `hashed:${p}`)
}))
vi.mock('@/shared/platform/backend', () => ({
  backendMode: () => mocks.mode,
  backendAuth: () => ({
    changePassword: mocks.changePassword,
    session: mocks.session,
    login: mocks.login,
    setup: mocks.setup,
    logout: mocks.logout
  }),
  isApiError: (e: unknown) =>
    typeof e === 'object' && e !== null && (e as { name?: string }).name === 'ApiError'
}))

const apiError = (code: string, status: number): Error =>
  Object.assign(new Error(code), { name: 'ApiError', code, status })

const VALID = 'new-secret-pass'

const createSecurity = () => useSettingsSecurity(vi.fn(async () => true))

describe('useSettingsSecurity agent 管理密码', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mode = 'agent'
    mocks.routerReplace.mockResolvedValue(undefined)
    setActivePinia(createPinia())
  })

  it('isAgent 仅在 agent 模式为 true', () => {
    expect(createSecurity().isAgent.value).toBe(true)
    mocks.mode = 'native'
    setActivePinia(createPinia())
    expect(createSecurity().isAgent.value).toBe(false)
  })

  it('空密码：行内错误且不发请求', async () => {
    const security = createSecurity()
    await security.commitAgentPassword()
    expect(security.agentPwdError.value).toBe('newSettings.agentPasswordRequired')
    expect(mocks.changePassword).not.toHaveBeenCalled()
  })

  it('长度不足：行内错误且不发请求', async () => {
    const security = createSecurity()
    security.agentPwdInput.value = 'short'
    security.agentPwdConfirm.value = 'short'
    await security.commitAgentPassword()
    expect(security.agentPwdError.value).toBe('newSettings.agentPasswordTooShort')
    expect(mocks.changePassword).not.toHaveBeenCalled()
  })

  it('两次不一致：行内错误且不发请求', async () => {
    const security = createSecurity()
    security.agentPwdInput.value = VALID
    security.agentPwdConfirm.value = `${VALID}x`
    await security.commitAgentPassword()
    expect(security.agentPwdError.value).toBe('newSettings.agentPasswordMismatch')
    expect(mocks.changePassword).not.toHaveBeenCalled()
  })

  it('成功：清本地会话并跳转登录页（changed 提示），清空明文，不调登出接口', async () => {
    mocks.session.mockResolvedValue({ authenticated: true })
    const session = useAgentSessionStore()
    await session.refresh()
    expect(session.authenticated).toBe(true)

    mocks.changePassword.mockResolvedValue(undefined)
    const security = createSecurity()
    security.agentPwdInput.value = VALID
    security.agentPwdConfirm.value = VALID
    await security.commitAgentPassword()

    expect(mocks.changePassword).toHaveBeenCalledWith(VALID)
    expect(session.authenticated).toBe(false)
    expect(mocks.routerReplace).toHaveBeenCalledWith({
      path: '/login',
      query: { notice: 'changed' }
    })
    expect(security.agentPwdInput.value).toBe('')
    expect(security.agentPwdConfirm.value).toBe('')
    expect(mocks.logout).not.toHaveBeenCalled()
  })

  it('auth_invalid：映射 changePasswordInvalid，停留当前页且保持登录态', async () => {
    mocks.session.mockResolvedValue({ authenticated: true })
    const session = useAgentSessionStore()
    await session.refresh()

    mocks.changePassword.mockRejectedValue(apiError('auth_invalid', 401))
    const security = createSecurity()
    security.agentPwdInput.value = VALID
    security.agentPwdConfirm.value = VALID
    await security.commitAgentPassword()

    expect(security.agentPwdError.value).toBe('newAuth.changePasswordInvalid')
    expect(mocks.routerReplace).not.toHaveBeenCalled()
    expect(session.authenticated).toBe(true)
  })

  it('auth_required：会话失效跳转登录页（expired 提示）', async () => {
    mocks.changePassword.mockRejectedValue(apiError('auth_required', 401))
    const security = createSecurity()
    security.agentPwdInput.value = VALID
    security.agentPwdConfirm.value = VALID
    await security.commitAgentPassword()

    expect(mocks.routerReplace).toHaveBeenCalledWith({
      path: '/login',
      query: { notice: 'expired' }
    })
    expect(security.agentPwdError.value).toBe('')
  })

  it('resetAgentPwdForm 清空明文、错误与明文可见态', () => {
    const security = createSecurity()
    security.agentPwdInput.value = VALID
    security.agentPwdConfirm.value = VALID
    security.agentPwdError.value = 'x'
    security.agentPwdVisible.value = true
    security.resetAgentPwdForm()
    expect(security.agentPwdInput.value).toBe('')
    expect(security.agentPwdConfirm.value).toBe('')
    expect(security.agentPwdError.value).toBe('')
    expect(security.agentPwdVisible.value).toBe(false)
  })
})
