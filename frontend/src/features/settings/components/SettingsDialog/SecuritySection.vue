<template>
  <!-- 安全（锁定密码，5.12） -->
  <div
    id="sd-panel-security"
    class="sd-section"
    :role="single ? undefined : 'tabpanel'"
    :aria-labelledby="single ? undefined : 'sd-tab-security'"
    :tabindex="single ? undefined : 0"
  >
    <div class="sd-security-card">
      <div class="sd-security-head">
        <div class="sd-security-title">
          <span class="sd-row-title">{{ t('newSettings.lockPassword') }}</span>
          <span class="sd-lock-status" :class="{ on: !!store.lockPassword }">
            {{
              store.lockPassword
                ? t('newSettings.lockPasswordEnabled')
                : t('newSettings.lockPasswordDisabled')
            }}
          </span>
        </div>
        <span class="sd-row-desc">{{ t('newSettings.lockPasswordDesc') }}</span>
      </div>

      <!-- 未设置密码，或已设置且点击“修改密码”时显示双输入表单 -->
      <div v-if="!store.lockPassword || lockEditMode" class="sd-lock-form">
        <div class="sd-lock-fields">
          <div class="sd-lock-field">
            <label class="sd-lock-label" for="sd-lock-new">{{
              t('newSettings.lockPasswordNew')
            }}</label>
            <div class="sd-lock-input-bar">
              <LtInput
                :ref="setLockPwdInputRef"
                v-model="lockPwdInput"
                class="sd-lock-input"
                variant="filled"
                input-id="sd-lock-new"
                :type="lockPwdVisible ? 'text' : 'password'"
                :placeholder="t('newSettings.lockPasswordNewPlaceholder')"
                :aria-label="t('newSettings.lockPasswordNew')"
                :aria-invalid="!!lockPwdError"
                :aria-describedby="lockPwdError ? 'sd-lock-error' : undefined"
                autocomplete="new-password"
                :maxlength="32"
                @input="lockPwdError = ''"
                @keyup.enter="commitLockPassword"
              />
              <LtButton
                variant="text"
                size="xs"
                circle
                class="sd-lock-eye"
                type="button"
                @mousedown.prevent
                @click="lockPwdVisible = !lockPwdVisible"
                :title="
                  lockPwdVisible ? t('newSettings.lockPwdHide') : t('newSettings.lockPwdShow')
                "
                :aria-label="
                  lockPwdVisible ? t('newSettings.lockPwdHide') : t('newSettings.lockPwdShow')
                "
                :aria-pressed="lockPwdVisible"
              >
                <svg
                  v-if="lockPwdVisible"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                  />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                <svg
                  v-else
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </LtButton>
            </div>
          </div>
          <div class="sd-lock-field">
            <label class="sd-lock-label" for="sd-lock-confirm">{{
              t('newSettings.lockPasswordConfirm')
            }}</label>
            <LtInput
              v-model="lockPwdConfirm"
              class="sd-lock-input"
              variant="filled"
              input-id="sd-lock-confirm"
              :type="lockPwdVisible ? 'text' : 'password'"
              :placeholder="t('newSettings.lockPasswordConfirmPlaceholder')"
              :aria-label="t('newSettings.lockPasswordConfirm')"
              :aria-invalid="!!lockPwdError"
              :aria-describedby="lockPwdError ? 'sd-lock-error' : undefined"
              autocomplete="new-password"
              :maxlength="32"
              @input="lockPwdError = ''"
              @keyup.enter="commitLockPassword"
            />
          </div>
        </div>
        <span v-if="lockPwdError" id="sd-lock-error" class="sd-field-error" role="alert">{{
          lockPwdError
        }}</span>
        <div class="sd-lock-actions">
          <LtButton
            v-if="store.lockPassword"
            variant="ghost"
            type="button"
            @click="cancelLockEdit"
            >{{ t('newCommon.cancel') }}</LtButton
          >
          <LtButton variant="primary" type="button" @click="commitLockPassword">{{
            store.lockPassword
              ? t('newSettings.lockPasswordSave')
              : t('newSettings.lockPasswordSet')
          }}</LtButton>
        </div>
      </div>
      <div v-else class="sd-lock-actions">
        <LtButton variant="ghost" type="button" @click="startLockEdit">{{
          t('newSettings.lockPasswordChange')
        }}</LtButton>
        <LtButton variant="danger" type="button" @click="handleClearLockPassword">{{
          t('newSettings.lockPasswordClear')
        }}</LtButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput } from '@/shared/ui'
import { useEasyTierStore } from '@/shared/store/easytier'
import { SETTINGS_SECURITY_KEY } from './context'

defineProps<{ single?: boolean }>()

const store = useEasyTierStore()
const { t } = useI18n()
const {
  lockPwdVisible,
  lockPwdInput,
  lockPwdConfirm,
  lockPwdError,
  lockEditMode,
  setLockPwdInputRef,
  startLockEdit,
  cancelLockEdit,
  commitLockPassword,
  handleClearLockPassword
} = inject(SETTINGS_SECURITY_KEY)!
</script>

<style scoped lang="less">
@import url('./styles/common.less');

/* 安全：锁定密码（5.12） */
.sd-security-card {
  display: flex;
  padding: var(--theme-space-4);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-lg, 14px);
  flex-direction: column;
  gap: var(--theme-space-4);
}

.sd-security-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sd-security-title {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

.sd-lock-status {
  padding: 2px var(--theme-space-2);
  font-size: 11px;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  background: var(--theme-bg-tag, #f5ede6);
  border-radius: var(--theme-radius-pill, 100px);
}

.sd-lock-status.on {
  color: var(--theme-color-success, #7fba8a);
  background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.12);
}

/* 双输入表单：新密码 / 确认密码两列对齐，按钮右对齐 */
.sd-lock-form {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-3);
}

.sd-lock-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--theme-space-3);
}

.sd-lock-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.sd-lock-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-secondary, #7a6e5e);
}

.sd-lock-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--theme-space-2);
}

.sd-lock-input-bar {
  position: relative;
  display: flex;
  align-items: center;
}

.sd-lock-input {
  width: 100%;
}

/* 自定义眼睛按钮悬浮在右侧，输入文字避开该区域 */
.sd-lock-input-bar .sd-lock-input :deep(.n-input__input-el) {
  padding-right: 26px;
}

/* 确认密码没有眼睛按钮，右侧留白收窄 */
.sd-lock-field > .sd-lock-input :deep(.n-input__input-el) {
  padding-right: 0;
}

/* WebView2/Edge 自带密码揭示按钮，会与自定义眼睛图标重复，隐藏之 */
.sd-lock-input :deep(input::-ms-reveal),
.sd-lock-input :deep(input::-ms-clear) {
  display: none;
}

.sd-lock-input-bar .sd-lock-eye {
  color: var(--theme-text-muted, #c8bdb2);
}

.sd-lock-input-bar .sd-lock-eye:hover:not(:disabled) {
  color: var(--theme-accent-primary, #e8a0a0);
}

.sd-lock-eye {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
}

/* 密码双输入在窄屏改为单列，避免字段被压缩 */
@media (width <= 640px) {
  .sd-lock-fields {
    grid-template-columns: 1fr;
  }
}
</style>
