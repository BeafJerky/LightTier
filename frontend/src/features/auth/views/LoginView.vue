<script setup lang="ts">
/**
 * agent 登录页（仅 agent 模式可达）。
 *
 * 密码登录：成功后回首页；失败按后端错误码展示文案（错误码 → i18n key 见
 * `authErrorKey`）。登录接口本身是 silentAuth，密码错误不会触发全局 401 跳转。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { LtButton, LtInput } from '@/shared/ui'
import { authErrorKey, useAgentSessionStore } from '@/shared/store/agentSession'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const session = useAgentSessionStore()

const password = ref('')
const errorKey = ref('')
const submitting = ref(false)

// 改密成功 / 会话失效跳转携带的提示（toast 容器随布局卸载，改在登录页常驻展示）
const noticeKey = computed(() => {
  if (route.query.notice === 'changed') return 'newAuth.passwordChanged'
  if (route.query.notice === 'expired') return 'newAuth.sessionExpired'
  return ''
})

const canSubmit = computed(() => password.value.length > 0 && !submitting.value)
// 未初始化时后端返回 setup_required：错误提示旁给出初始化入口
const setupLinkVisible = computed(() => errorKey.value === 'newAuth.authSetupRequired')

const submit = async () => {
  if (!canSubmit.value) return
  submitting.value = true
  errorKey.value = ''
  try {
    await session.login(password.value)
    password.value = ''
    await router.replace('/')
  } catch (error) {
    errorKey.value = authErrorKey(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="lt-auth">
    <form class="lt-auth__card" novalidate @submit.prevent="submit">
      <img class="lt-auth__logo" src="/logo.png" alt="" />
      <h1 class="lt-auth__title">{{ t('newAuth.loginTitle') }}</h1>
      <p class="lt-auth__subtitle">{{ t('newAuth.loginSubtitle') }}</p>
      <p v-if="noticeKey" class="lt-auth__notice" role="status">{{ t(noticeKey) }}</p>
      <label class="lt-auth__label" for="agent-login-password">
        {{ t('newAuth.passwordLabel') }}
      </label>
      <LtInput
        v-model="password"
        input-id="agent-login-password"
        type="password"
        size="lg"
        variant="outline"
        autocomplete="current-password"
        :placeholder="t('newAuth.passwordPlaceholder')"
        :aria-label="t('newAuth.passwordLabel')"
        :aria-invalid="Boolean(errorKey)"
        :aria-describedby="errorKey ? 'agent-login-error' : undefined"
        @input="errorKey = ''"
      />
      <p v-if="errorKey" id="agent-login-error" class="lt-auth__error" role="alert">
        {{ t(errorKey) }}
        <RouterLink v-if="setupLinkVisible" class="lt-auth__link" to="/setup">
          {{ t('newAuth.setupLink') }}
        </RouterLink>
      </p>
      <LtButton
        variant="primary"
        size="lg"
        block
        type="submit"
        class="lt-auth__submit"
        :loading="submitting"
        :disabled="!password"
      >
        {{ t('newAuth.loginAction') }}
      </LtButton>
    </form>
  </div>
</template>

<style scoped>
.lt-auth {
  display: flex;
  height: 100%;
  padding: var(--theme-space-6);
  overflow-y: auto;
  font-family: var(--theme-font-body);
  color: var(--theme-text-primary);
  background: var(--theme-bg);
  box-sizing: border-box;
}

.lt-auth__card {
  display: flex;
  width: min(22rem, 100%);
  padding: var(--theme-space-8, 32px) var(--theme-space-6);
  margin: auto;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  box-shadow: 0 12px 32px rgb(0 0 0 / 8%);
  flex-direction: column;
  align-items: stretch;
}

.lt-auth__logo {
  width: 40px;
  height: 40px;
  margin: 0 auto var(--theme-space-3);
  object-fit: contain;
}

.lt-auth__title {
  margin: 0;
  font-family: var(--theme-font-display);
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
}

.lt-auth__subtitle {
  margin: var(--theme-space-1) 0 var(--theme-space-5);
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--theme-text-secondary);
  text-align: center;
}

.lt-auth__notice {
  padding: var(--theme-space-2) var(--theme-space-3);
  margin: 0 0 var(--theme-space-4);
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--theme-color-success, #7fba8a);
  background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.12);
  border: 1px solid var(--theme-color-success, #7fba8a);
  border-radius: var(--theme-radius-md, 10px);
}

.lt-auth__label {
  margin-bottom: var(--theme-space-2);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--theme-text-secondary);
}

.lt-auth__error {
  margin: var(--theme-space-2) 0 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--theme-color-danger, #e57373);
}

.lt-auth__link {
  display: inline-block;
  margin-left: var(--theme-space-1);
  color: var(--theme-accent-primary);
  text-decoration: underline;
}

.lt-auth__submit {
  margin-top: var(--theme-space-5);
}
</style>
