<template>
  <CreamDialog
    ref="dialogRef"
    v-model="visible"
    :title="mode === 'add' ? t('newWebForm.addTitle') : t('newWebForm.editTitle')"
    width="520px"
    :before-close="handleBeforeClose"
  >
    <!-- 配置名称（仅新增模式） -->
    <div v-if="mode === 'add'" class="wcf-field-bar">
      <label class="wcf-label">{{ t('newWebForm.configName') }}</label>
      <LtInput
        v-model="form.configFileName"
        variant="outline"
        :placeholder="t('newWebForm.configNamePlaceholder')"
        :aria-label="t('newWebForm.configName')"
      />
      <span v-if="nameError" class="wcf-error" role="alert">{{ nameError }}</span>
    </div>

    <!-- 服务器信息 -->
    <div class="wcf-section">
      <div class="wcf-section-title">{{ t('newWebForm.serverInfo') }}</div>
      <div class="wcf-grid">
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.protocol') }}</label>
          <LtSelect
            v-model="form.protocol"
            :options="protocolOptions"
            variant="outline"
            :aria-label="t('newWebForm.protocol')"
          />
        </div>
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.host') }}</label>
          <LtInput
            v-model="form.host"
            variant="outline"
            :placeholder="t('newWebForm.hostPlaceholder')"
            :aria-label="t('newWebForm.host')"
          />
          <span v-if="hostError" class="wcf-error" role="alert">{{ hostError }}</span>
        </div>
        <div class="wcf-field">
          <label class="wcf-label" :for="fieldId('port')">{{ t('newWebForm.port') }}</label>
          <LtInput
            :model-value="portInput"
            variant="outline"
            inputmode="numeric"
            :maxlength="5"
            :input-id="fieldId('port')"
            placeholder="22020"
            :aria-label="t('newWebForm.port')"
            :aria-invalid="!!portError"
            :aria-describedby="portError ? 'wcf-port-error' : undefined"
            @update:model-value="handlePortInput"
            @blur="validatePort"
          />
          <span v-if="portError" id="wcf-port-error" class="wcf-error" role="alert">{{
            portError
          }}</span>
        </div>
      </div>
    </div>

    <!-- 用户名 + 控制台地址 -->
    <div class="wcf-section">
      <div class="wcf-section-title">{{ t('newWebForm.account') }}</div>
      <div class="wcf-grid">
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.username') }}</label>
          <LtInput
            v-model="form.userName"
            variant="outline"
            :maxlength="36"
            :placeholder="t('newWebForm.usernamePlaceholder')"
            :aria-label="t('newWebForm.username')"
          />
          <span v-if="userError" class="wcf-error" role="alert">{{ userError }}</span>
        </div>
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.consoleAddr') }}</label>
          <LtInput
            v-model="form.webUrl"
            variant="outline"
            :placeholder="t('newWebForm.consolePlaceholder')"
            :aria-label="t('newWebForm.consoleAddr')"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="wcf-footer">
        <span class="wcf-footer-hint">{{
          mode === 'add' ? t('newWebForm.addHint') : t('newWebForm.editHint')
        }}</span>
        <div class="wcf-footer-btns">
          <LtButton variant="ghost" @click="requestCloseFromButton">{{
            t('newCommon.cancel')
          }}</LtButton>
          <LtButton variant="primary" :disabled="saving" @click="handleSave">{{
            saving
              ? t('newCommon.saving')
              : mode === 'add'
                ? t('newWebForm.create')
                : t('newWebForm.save')
          }}</LtButton>
        </div>
      </div>
    </template>
  </CreamDialog>

  <!-- 放弃未保存修改的二次确认 -->
  <CreamDialog v-model="discardVisible" :title="t('newCommon.discardTitle')" width="380px">
    <p class="wcf-discard-msg">{{ t('newCommon.discardMsg') }}</p>
    <template #footer>
      <LtButton variant="ghost" @click="resolveDiscard(false)">{{
        t('newCommon.cancel')
      }}</LtButton>
      <LtButton variant="danger" @click="resolveDiscard(true)">{{
        t('newCommon.discardConfirm')
      }}</LtButton>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * WebConfigForm — Web 控制台配置表单（新增 / 编辑双模式，web-config-view 专用弹窗）
 *
 * 字段：配置名（仅新增）、协议/主机/端口、用户名与控制台地址。
 * 校验规则与 config-view 的 EditDialog 不同：用户名允许 @ 与点号（EasyTier 用户名语义）；
 * 端口非法时就地提示并阻止保存，不再静默回退默认值；保存需等待父组件写盘结果。
 */
import { computed, ref, watch, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import CreamDialog from '@/components/CreamDialog/index.vue'
import { LtButton, LtInput, LtSelect } from '@/components/ui'
import type { FormWebData } from '@/types/formTypes'
import DefaultData from '@/constants/defaultData'
import { isValidConfigName } from '@/utils/configNameUtil'
import { cloneDeep } from 'lodash-es'

const { t } = useI18n()

const protocolOptions = [
  { label: 'udp', value: 'udp' },
  { label: 'tcp', value: 'tcp' }
]

const props = defineProps<{
  modelValue: boolean
  configData: FormWebData | null
  mode?: 'add' | 'edit'
  existingNames?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  // done 由父组件在写盘结束后回调：true 关闭弹窗，false 保留内容
  saved: [data: FormWebData, done: (ok: boolean) => void]
}>()

const dialogRef = ref<InstanceType<typeof CreamDialog> | null>(null)
const uid = useId()
const fieldId = (key: string) => `wcf-${uid}-${key}`
const visible = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
    if (v) resetForm()
  }
)
watch(visible, (v) => {
  emit('update:modelValue', v)
})

const form = ref<FormWebData>(cloneDeep(DefaultData.defaultFormWebData))
// 端口以文本承接原始输入，避免非法字符被数字输入立即吞掉而无法提示
const portInput = ref(String(form.value.port ?? ''))
const handlePortInput = (value: string) => {
  portInput.value = value
  form.value.port = value.trim() ? Number(value) : undefined
  portError.value = ''
}
// 各字段校验错误文案（非空时在输入框下方展示）
const nameError = ref('')
const hostError = ref('')
const userError = ref('')
const portError = ref('')
const saving = ref(false)
// 脏检查基线：打开/重置时的表单快照
const baseline = ref('')

const formSignature = () => JSON.stringify(form.value)
const dirty = computed(
  () => visible.value && !!baseline.value && formSignature() !== baseline.value
)

// 重置表单：新增用默认值（清空配置名），编辑深拷贝入参（避免直接修改父组件数据）
const resetForm = () => {
  if (props.mode === 'add' || !props.configData) {
    form.value = cloneDeep(DefaultData.defaultFormWebData)
    form.value.configFileName = ''
  } else {
    form.value = cloneDeep(props.configData)
  }
  portInput.value = String(form.value.port ?? '')
  nameError.value = ''
  hostError.value = ''
  userError.value = ''
  portError.value = ''
  baseline.value = formSignature()
}

// 放弃确认（桌面弹窗；与 EditDialog 保持一致）
const discardVisible = ref(false)
let discardResolve: ((ok: boolean) => void) | null = null
const resolveDiscard = (ok: boolean) => {
  const resolve = discardResolve
  discardResolve = null
  discardVisible.value = false
  if (!ok) return resolve?.(false)
  baseline.value = formSignature()
  resolve?.(true)
}
const confirmDiscard = (): Promise<boolean> => {
  if (!dirty.value) return Promise.resolve(true)
  if (discardVisible.value) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    discardResolve = resolve
    discardVisible.value = true
  })
}
watch(discardVisible, (v) => {
  if (!v && discardResolve) {
    const resolve = discardResolve
    discardResolve = null
    resolve(false)
  }
})
const requestCloseFromButton = () => {
  void dialogRef.value?.requestClose()
}
const handleBeforeClose = async (): Promise<boolean> => {
  if (saving.value) return false
  return confirmDiscard()
}

defineExpose({ isDirty: () => dirty.value, confirmDiscard })

// 端口失焦校验：非整数或越界时就地提示，不回写默认值（UX-303）
const validatePort = () => {
  const port = Number(form.value.port)
  portError.value =
    !Number.isInteger(port) || port < 1 || port > 65535 ? t('newWebForm.portInvalid') : ''
}

// 校验：新增模式校验配置名（非空/字符/重名）；用户名与主机始终必填；端口非法时就地提示，不改写输入
const validate = (): boolean => {
  nameError.value = ''
  hostError.value = ''
  userError.value = ''
  portError.value = ''
  let ok = true

  if (props.mode === 'add') {
    form.value.configFileName = form.value.configFileName?.trim() || ''
    if (!form.value.configFileName) {
      nameError.value = t('newWebForm.nameEmpty')
      ok = false
    } else if (!isValidConfigName(form.value.configFileName)) {
      nameError.value = t('newWebForm.nameInvalid')
      ok = false
    } else if (props.existingNames?.includes(form.value.configFileName)) {
      nameError.value = t('newWebForm.nameExists')
      ok = false
    }
  }

  if (!form.value.userName?.trim()) {
    userError.value = t('newWebForm.userEmpty')
    ok = false
  } else if (!/^[a-zA-Z0-9@._-]+$/.test(form.value.userName)) {
    userError.value = t('newWebForm.userInvalid')
    ok = false
  }

  if (!form.value.host?.trim()) {
    hostError.value = t('newWebForm.hostEmpty')
    ok = false
  }

  const port = Number(form.value.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    portError.value = t('newWebForm.portInvalid')
    ok = false
  } else {
    form.value.port = port
  }

  return ok
}

// 保存：校验通过后 emit saved，等待父组件写盘结果；失败时保持弹窗与内容
const handleSave = async () => {
  if (saving.value) return
  if (!validate()) return
  saving.value = true
  const data = cloneDeep(form.value)
  try {
    const ok = await new Promise<boolean>((resolve) => {
      emit('saved', data, resolve)
    })
    if (!ok) return
    baseline.value = formSignature()
    visible.value = false
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.wcf-field-bar {
  display: flex;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: var(--theme-bg-tag, rgb(232 160 160 / 4%));
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  flex-direction: column;
  gap: 4px;
}

.wcf-section {
  margin-bottom: 18px;
}

.wcf-section-title {
  padding-bottom: 6px;
  margin-bottom: 10px;
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--theme-accent-primary, #e8a0a0);
  border-bottom: 1px solid var(--theme-border-light, #f5ede6);
}

.wcf-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.wcf-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wcf-label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-muted, #c8bdb2);
  text-transform: uppercase;
}

.wcf-error {
  font-size: 12px;
  color: var(--theme-accent-primary, #e8a0a0);
}

.wcf-discard-msg {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--theme-text-secondary, #7a6e5e);
}

.wcf-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.wcf-footer-hint {
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
}

.wcf-footer-btns {
  display: flex;
  gap: 8px;
}

/* 移动端：表单单列，避免两列在 390px 下横向溢出 */
@media (width <= 640px) {
  .wcf-grid {
    grid-template-columns: 1fr;
  }

  .wcf-footer {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
