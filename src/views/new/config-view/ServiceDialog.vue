<template>
  <CreamDialog
    v-model="visible"
    :title="t('newConfig.installTitle', { name: configName })"
    width="480px"
  >
    <div class="svc-form">
      <div class="svc-field">
        <label class="svc-label">{{ t('newConfig.installMethod') }}</label>
        <div class="svc-radio-group">
          <label
            class="svc-radio"
            :class="{ active: form.installMethod === 'nssm' }"
            @click="form.installMethod = 'nssm'"
          >
            <span class="svc-radio-dot"></span>
            <span>NSSM</span>
          </label>
          <label
            class="svc-radio"
            :class="{ active: form.installMethod === 'official' }"
            @click="form.installMethod = 'official'"
          >
            <span class="svc-radio-dot"></span>
            <span>{{ t('newConfig.officialCli') }}</span>
          </label>
        </div>
      </div>

      <template v-if="form.installMethod === 'nssm'">
        <div class="svc-field">
          <label class="svc-label">{{ t('newConfig.runUser') }}</label>
          <LtInput
            v-model="form.username"
            variant="outline"
            :aria-label="t('newConfig.runUser')"
            :placeholder="t('newConfig.runUserPlaceholder')"
          />
        </div>
        <div class="svc-field" v-if="form.username">
          <label class="svc-label">{{ t('newConfig.userPassword') }}</label>
          <LtInput
            v-model="form.password"
            type="password"
            variant="outline"
            :aria-label="t('newConfig.userPassword')"
            :placeholder="t('newConfig.passwordPlaceholder')"
          />
        </div>
      </template>

      <template v-if="form.installMethod === 'official'">
        <div class="svc-field">
          <label class="svc-label">{{ t('newConfig.displayName') }}</label>
          <LtInput
            v-model="form.displayName"
            variant="outline"
            :aria-label="t('newConfig.displayName')"
            :placeholder="t('newConfig.displayNamePlaceholder')"
          />
        </div>
        <div class="svc-field">
          <label class="svc-label">{{ t('newConfig.svcDesc') }}</label>
          <LtInput
            v-model="form.description"
            type="textarea"
            variant="outline"
            :aria-label="t('newConfig.svcDesc')"
            :placeholder="t('newConfig.svcDescPlaceholder')"
          />
        </div>
        <div class="svc-field svc-field-row">
          <label class="svc-label">{{ t('newSettings.defaultAutostart') }}</label>
          <LtSwitch
            v-model="form.enableAutostart"
            :aria-label="t('newSettings.defaultAutostart')"
          />
        </div>
        <p class="svc-hint">{{ t('newConfig.installHint') }}</p>
      </template>
    </div>

    <template #footer>
      <div class="svc-footer">
        <span class="svc-footer-hint">{{ t('newConfig.installHint') }}</span>
        <div class="svc-footer-actions">
          <LtButton variant="ghost" size="md" @click="visible = false">{{
            t('newCommon.cancel')
          }}</LtButton>
          <LtButton variant="primary" size="md" :disabled="installing" @click="handleInstall">{{
            installing ? t('newCommon.installing') : t('newConfig.install')
          }}</LtButton>
        </div>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * ServiceDialog — Windows 服务安装弹窗（桌面专属）
 *
 * 两种安装方式：
 * - nssm：可指定运行账户/密码（可选，留空则以本机系统账户运行）
 * - official：使用内核官方 CLI 注册服务，可自定义显示名/描述/开机自启
 * 表单数据通过 installed 事件交给父组件执行安装，本组件不直接落盘。
 */
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CreamDialog from '@/components/CreamDialog/index.vue'
import { LtButton, LtInput, LtSwitch } from '@/components/ui'

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
  configName: string
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  installed: [configName: string, options: any]
}>()

const visible = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
  }
)
watch(visible, (v) => {
  emit('update:modelValue', v)
})

const installing = ref(false)
// 安装表单：切换安装方式时仅展示对应分支的字段（nssm 账户 / official 显示名等）
const form = ref({
  installMethod: 'nssm' as 'nssm' | 'official',
  description: '',
  displayName: '',
  enableAutostart: true,
  username: '',
  password: ''
})

// 每次打开时重置表单（描述/显示名按当前配置名生成默认值）
watch(visible, (v) => {
  if (v) {
    form.value = {
      installMethod: 'nssm',
      description: t('newConfig.svcDefaultDesc', { name: props.configName }),
      displayName: t('newConfig.svcDefaultName', { name: props.configName }),
      enableAutostart: true,
      username: '',
      password: ''
    }
  }
})

// 提交安装：把表单快照交给父组件执行（父组件负责调用 installService 并刷新状态）
const handleInstall = async () => {
  installing.value = true
  try {
    emit('installed', props.configName, { ...form.value })
    visible.value = false
  } finally {
    installing.value = false
  }
}
</script>

<style scoped>
.svc-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.svc-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.svc-field-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.svc-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-muted, #c8bdb2);
  text-transform: uppercase;
}

.svc-radio-group {
  display: flex;
  gap: 12px;
}

.svc-radio {
  display: flex;
  padding: 6px 16px;
  font-size: 13px;
  color: var(--theme-text-secondary, #7a6e5e);
  cursor: pointer;
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: var(--theme-transition-interactive);
  align-items: center;
  gap: 6px;
}

.svc-radio.active {
  color: var(--theme-accent-primary, #e8a0a0);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 6%, transparent);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.svc-radio-dot {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: 50%;
  transition: var(--theme-transition-colors);
}

.svc-radio.active .svc-radio-dot {
  background: var(--theme-accent-primary, #e8a0a0);
  border-color: var(--theme-accent-primary, #e8a0a0);
  box-shadow: inset 0 0 0 2px var(--theme-bg-card, #fff);
}

.svc-hint {
  padding: 8px 12px;
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 4%, transparent);
  border-radius: var(--theme-radius-sm, 6px);
}

.svc-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.svc-footer-hint {
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
}

.svc-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
