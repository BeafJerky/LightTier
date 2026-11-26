/**
 * 安全设置：锁定密码（5.12）双输入显式提交。
 * store.lockPassword 仅存校验串 sha256$salt$hash（随 pinia persist 持久化），绝不落明文；
 * 关闭设置弹窗时由父组件调用 resetLockForm 清空未提交的明文输入。
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LtInput } from '@/shared/ui'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useEasyTierStore } from '@/shared/store/easytier'
import { hashLockPassword } from '@/shared/platform/lockUtil'
import { backendAuth, backendMode, isApiError } from '@/shared/platform/backend'
import {
  AUTH_PASSWORD_MIN_LENGTH,
  authErrorKey,
  useAgentSessionStore
} from '@/shared/store/agentSession'
import type { SettingsConfirm } from './settingsTypes'

const LOCK_PWD_MIN_LENGTH = 6

export function useSettingsSecurity(confirm: SettingsConfirm) {
  const store = useEasyTierStore()
  const toast = useCreamToast()
  const { t } = useI18n()
  const router = useRouter()
  const agentSession = useAgentSessionStore()
  const isAgent = computed(() => backendMode() === 'agent')

  const lockPwdVisible = ref(false)
  const lockPwdInput = ref('')
  const lockPwdConfirm = ref('')
  const lockPwdError = ref('')
  const lockEditMode = ref(false)
  const lockPwdInputRef = ref<InstanceType<typeof LtInput> | null>(null)
  // 模板 ref 由安全面板绑定：组件内以函数 ref 回写
  const setLockPwdInputRef = (el: unknown) => {
    lockPwdInputRef.value = (el as InstanceType<typeof LtInput> | null) ?? null
  }

  // 重置为“未在编辑”状态并清空明文
  const resetLockForm = () => {
    lockPwdInput.value = ''
    lockPwdConfirm.value = ''
    lockPwdError.value = ''
    lockPwdVisible.value = false
    lockEditMode.value = false
  }

  // 已设置密码时，点“修改密码”展开双输入
  const startLockEdit = () => {
    resetLockForm()
    lockEditMode.value = true
    nextTick(() => lockPwdInputRef.value?.focus())
  }

  const cancelLockEdit = () => {
    resetLockForm()
  }

  // 显式提交：非空、至少 6 位、两次一致；错误就地展示并阻止写入
  const commitLockPassword = () => {
    const pwd = lockPwdInput.value
    if (!pwd) {
      lockPwdError.value = t('newSettings.lockPasswordRequired')
      return
    }
    if (pwd.length < LOCK_PWD_MIN_LENGTH) {
      lockPwdError.value = t('newSettings.lockPasswordTooShort')
      return
    }
    if (pwd !== lockPwdConfirm.value) {
      lockPwdError.value = t('newSettings.lockPasswordMismatch')
      return
    }
    const wasSet = !!store.lockPassword
    store.lockPassword = hashLockPassword(pwd)
    toast.success(
      wasSet ? t('newSettings.lockPasswordChanged') : t('newSettings.lockPasswordSetSuccess')
    )
    resetLockForm()
  }

  // 清除需二次确认，避免误触解除保护
  const handleClearLockPassword = async () => {
    if (
      !(await confirm(
        t('newSettings.lockPasswordClearTitle'),
        t('newSettings.lockPasswordClearConfirm')
      ))
    )
      return
    store.lockPassword = ''
    resetLockForm()
    toast.success(t('newSettings.lockPasswordCleared'))
  }

  // agent：服务端管理密码（与桌面锁屏密码无关）
  const agentPwdVisible = ref(false)
  const agentPwdInput = ref('')
  const agentPwdConfirm = ref('')
  const agentPwdError = ref('')
  const agentPwdBusy = ref(false)

  const resetAgentPwdForm = () => {
    agentPwdInput.value = ''
    agentPwdConfirm.value = ''
    agentPwdError.value = ''
    agentPwdVisible.value = false
    agentPwdBusy.value = false
  }

  // 改密成功 / 会话已失效：服务端会话均已不存在，标记本地未认证并回登录页
  const gotoLogin = async (notice: 'changed' | 'expired') => {
    resetAgentPwdForm()
    agentSession.invalidate()
    await router.replace({ path: '/login', query: { notice } })
  }

  const commitAgentPassword = async () => {
    if (agentPwdBusy.value) return
    const pwd = agentPwdInput.value
    if (!pwd) {
      agentPwdError.value = t('newSettings.agentPasswordRequired')
      return
    }
    if (pwd.length < AUTH_PASSWORD_MIN_LENGTH) {
      agentPwdError.value = t('newSettings.agentPasswordTooShort', {
        min: AUTH_PASSWORD_MIN_LENGTH
      })
      return
    }
    if (pwd !== agentPwdConfirm.value) {
      agentPwdError.value = t('newSettings.agentPasswordMismatch')
      return
    }
    agentPwdBusy.value = true
    try {
      await backendAuth().changePassword(pwd)
    } catch (error) {
      // 会话已失效（如其它端改密清空了会话）：与成功同样回登录页
      if (isApiError(error) && error.code === 'auth_required') {
        await gotoLogin('expired')
        return
      }
      agentPwdError.value = t(authErrorKey(error, 'changePassword'))
      return
    } finally {
      agentPwdBusy.value = false
    }
    await gotoLogin('changed')
  }

  return {
    lockPwdVisible,
    lockPwdInput,
    lockPwdConfirm,
    lockPwdError,
    lockEditMode,
    setLockPwdInputRef,
    resetLockForm,
    startLockEdit,
    cancelLockEdit,
    commitLockPassword,
    handleClearLockPassword,
    isAgent,
    agentPwdVisible,
    agentPwdInput,
    agentPwdConfirm,
    agentPwdError,
    agentPwdBusy,
    resetAgentPwdForm,
    commitAgentPassword
  }
}
