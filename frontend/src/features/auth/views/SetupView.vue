<script setup lang="ts">
/**
 * agent 初始化页（仅 agent 模式可达）。
 *
 * 首次运行：从 agent 数据目录 `state/setup-token` 或启动日志取得令牌，设置管理密码
 * （客户端校验 ≥10 位且两次一致）。后端 204 后立即用同一密码登录，然后回首页。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { LtButton, LtInput } from '@/shared/ui'
import {
  AUTH_PASSWORD_MIN_LENGTH,
  authErrorKey,
  useAgentSessionStore
} from '@/shared/store/agentSession'

const { t } = useI18n()
const router = useRouter()
const session = useAgentSessionStore()

const token = ref('')
const password = ref('')
const confirm = ref('')
const errorKey = ref('')
const submitting = ref(false)

// 客户端校验：密码长度与一致性（后端还会按相同规则再校验一次）
const passwordTooShort = computed(
  () => password.value.length > 0 && password.value.length < AUTH_PASSWORD_MIN_LENGTH
)
const passwordMismatch = computed(
  () => confirm.value.length > 0 && confirm.value !== password.value
)
const canSubmit = computed(
  () =>
    token.value.trim().length > 0 &&
    password.value.length >= AUTH_PASSWORD_MIN_LENGTH &&
    confirm.value === password.value &&
    !submitting.value
)
// 已完成初始化提示给出登录入口
const loginLinkVisible = computed(() => errorKey.value === 'newAuth.alreadyInitialized')

const submit = async () => {
  if (!canSubmit.value) return
  submitting.value = true
  errorKey.value = ''
  try {
    await session.setup(token.value.trim(), password.value)
    password.value = ''
    confirm.value = ''
    await router.replace('/')
  } catch (error) {
    errorKey.value = authErrorKey(error, 'setup')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="lt-auth">
    <form class="lt-auth__card" novalidate @submit.prevent="submit">
      <img class="lt-auth__logo" src="/logo.png" alt="" />
      <h1 class="lt-auth__title">{{ t('newAuth.setupTitle') }}</h1>
      <p class="lt-auth__subtitle">{{ t('newAuth.setupSubtitle') }}</p>

      <label class="lt-auth__label" for="agent-setup-token">
        {{ t('newAuth.setupTokenLabel') }}
      </label>
      <LtInput
        v-model="token"
        input-id="agent-setup-token"
        size="lg"
        variant="outline"
        autocomplete="off"
        :spellcheck="false"
        :placeholder="t('newAuth.setupTokenPlaceholder')"
        :aria-label="t('newAuth.setupTokenLabel')"
        aria-describedby="agent-setup-token-hint"
        @input="errorKey = ''"
      />
      <p id="agent-setup-token-hint" class="lt-auth__hint">{{ t('newAuth.setupTokenHint') }}</p>

      <label class="lt-auth__label" for="agent-setup-password">
        {{ t('newAuth.passwordLabel') }}
      </label>
      <LtInput
        v-model="password"
        input-id="agent-setup-password"
        type="password"
        size="lg"
        variant="outline"
        autocomplete="new-password"
        :placeholder="t('newAuth.passwordPlaceholder')"
        :aria-label="t('newAuth.passwordLabel')"
        :aria-invalid="passwordTooShort"
        aria-describedby="agent-setup-password-hint"
        @input="errorKey = ''"
      />
      <p
        id="agent-setup-password-hint"
        class="lt-auth__hint"
        :class="{ 'is-error': passwordTooShort }"
      >
        {{ t('newAuth.setupPasswordHint') }}
      </p>

      <label class="lt-auth__label" for="agent-setup-confirm">
        {{ t('newAuth.setupConfirmLabel') }}
      </label>
      <LtInput
        v-model="confirm"
        input-id="agent-setup-confirm"
        type="password"
        size="lg"
        variant="outline"
        autocomplete="new-password"
        :placeholder="t('newAuth.setupConfirmPlaceholder')"
        :aria-label="t('newAuth.setupConfirmLabel')"
        :aria-invalid="passwordMismatch"
        :aria-describedby="passwordMismatch ? 'agent-setup-confirm-error' : undefined"
        @input="errorKey = ''"
      />
      <p v-if="passwordMismatch" id="agent-setup-confirm-error" class="lt-auth__error" role="alert">
        {{ t('newAuth.setupPasswordMismatch') }}
      </p>

      <p v-if="errorKey" id="agent-setup-error" class="lt-auth__error" role="alert">
        {{ t(errorKey) }}
        <RouterLink v-if="loginLinkVisible" class="lt-auth__link" to="/login">
          {{ t('newAuth.setupBackToLogin') }}
        </RouterLink>
      </p>

      <LtButton
        variant="primary"
        size="lg"
        block
        type="submit"
        class="lt-auth__submit"
        :loading="submitting"
        :disabled="!canSubmit"
      >
        {{ t('newAuth.setupAction') }}
      </LtButton>

      <RouterLink class="lt-auth__alt-link" to="/login">
        {{ t('newAuth.setupBackToLogin') }}
      </RouterLink>
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
  width: min(24rem, 100%);
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

.lt-auth__label {
  margin-bottom: var(--theme-space-2);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--theme-text-secondary);
}

.lt-auth__label + .lt-auth__label,
.lt-auth__hint + .lt-auth__label {
  margin-top: var(--theme-space-4);
}

.lt-auth__hint {
  margin: var(--theme-space-1) 0 0;
  font-size: 0.6875rem;
  line-height: 1.5;
  color: var(--theme-text-secondary);
}

.lt-auth__hint.is-error {
  color: var(--theme-color-danger, #e57373);
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

/* 禁用态用中性表面：白字压浅粉对比过低，且与可用态难以区分 */
.lt-auth__submit.lt-btn--primary:disabled {
  color: var(--theme-text-secondary);
  background: var(--theme-surface-secondary);
  border-color: var(--theme-border);
  opacity: 1;
}

.lt-auth__alt-link {
  margin-top: var(--theme-space-4);
  font-size: 0.75rem;
  color: var(--theme-text-secondary);
  text-align: center;
  text-decoration: underline;
}
</style>
