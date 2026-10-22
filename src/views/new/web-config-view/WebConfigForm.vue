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
      <label class="wcf-label" :for="fieldId('configName')">{{ t('newWebForm.configName') }}</label>
      <input
        :id="fieldId('configName')"
        class="wcf-input"
        v-model="form.configFileName"
        :placeholder="t('newWebForm.configNamePlaceholder')"
      />
      <span v-if="nameError" class="wcf-error" role="alert">{{ nameError }}</span>
    </div>

    <!-- 服务器信息 -->
    <div class="wcf-section">
      <div class="wcf-section-title">{{ t('newWebForm.serverInfo') }}</div>
      <div class="wcf-grid">
        <div class="wcf-field">
          <label class="wcf-label" :for="fieldId('protocol')">{{ t('newWebForm.protocol') }}</label>
          <select :id="fieldId('protocol')" class="wcf-select" v-model="form.protocol">
            <option value="udp">udp</option>
            <option value="tcp">tcp</option>
          </select>
        </div>
        <div class="wcf-field">
          <label class="wcf-label" :for="fieldId('host')">{{ t('newWebForm.host') }}</label>
          <input
            :id="fieldId('host')"
            class="wcf-input"
            v-model="form.host"
            :placeholder="t('newWebForm.hostPlaceholder')"
          />
          <span v-if="hostError" class="wcf-error" role="alert">{{ hostError }}</span>
        </div>
        <div class="wcf-field">
          <label class="wcf-label" :for="fieldId('port')">{{ t('newWebForm.port') }}</label>
          <input
            :id="fieldId('port')"
            class="wcf-input"
            type="number"
            v-model.number="form.port"
            min="1"
            max="65535"
            placeholder="22020"
            :aria-invalid="!!portError"
            :aria-describedby="portError ? 'wcf-port-error' : undefined"
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
          <label class="wcf-label" :for="fieldId('userName')">{{ t('newWebForm.username') }}</label>
          <input
            :id="fieldId('userName')"
            class="wcf-input"
            v-model="form.userName"
            maxlength="36"
            :placeholder="t('newWebForm.usernamePlaceholder')"
          />
          <span v-if="userError" class="wcf-error" role="alert">{{ userError }}</span>
        </div>
        <div class="wcf-field">
          <label class="wcf-label" :for="fieldId('webUrl')">{{
            t('newWebForm.consoleAddr')
          }}</label>
          <input
            :id="fieldId('webUrl')"
            class="wcf-input"
            v-model="form.webUrl"
            :placeholder="t('newWebForm.consolePlaceholder')"
          />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="wcf-footer">
        <span class="wcf-footer-hint">{{
          mode === 'add' ? t('newWebForm.addHint') : t('newWebForm.editHint')
        }}</span>
        <div>
          <button type="button" class="wcf-btn wcf-btn-cancel" @click="requestCloseFromButton">{{
            t('newCommon.cancel')
          }}</button>
          <button
            type="button"
            class="wcf-btn wcf-btn-primary"
            :disabled="saving"
            @click="handleSave"
            >{{
              saving
                ? t('newCommon.saving')
                : mode === 'add'
                  ? t('newWebForm.create')
                  : t('newWebForm.save')
            }}</button
          >
        </div>
      </div>
    </template>
  </CreamDialog>

  <!-- 放弃未保存修改的二次确认 -->
  <CreamDialog
    v-model="discardVisible"
    :title="t('newCommon.discardTitle')"
    width="380px"
    :close-on-overlay="false"
  >
    <p class="wcf-discard-msg">{{ t('newCommon.discardMsg') }}</p>
    <template #footer>
      <button type="button" class="wcf-btn wcf-btn-cancel" @click="resolveDiscard(false)">{{
        t('newCommon.cancel')
      }}</button>
      <button type="button" class="wcf-btn wcf-btn-primary" @click="resolveDiscard(true)">{{
        t('newCommon.discardConfirm')
      }}</button>
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
import type { FormWebData } from '@/types/formTypes'
import DefaultData from '@/constants/defaultData'
import { isValidConfigName } from '@/utils/configNameUtil'
import { cloneDeep } from 'lodash-es'

const { t } = useI18n()

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
// label for / 控件 id 一一对应，避免仅占位符充当可访问名称
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

.wcf-input,
.wcf-select {
  padding: 8px 14px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  outline: none;
  transition: border-color var(--theme-duration) var(--theme-ease-out);
}

.wcf-select {
  cursor: pointer;
}

.wcf-input:focus,
.wcf-select:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
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

.wcf-btn {
  padding: 6px 16px;
  margin-left: 8px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: var(--theme-transition-interactive);
}

.wcf-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.wcf-btn-cancel {
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-surface-secondary, #f5ede4);
  border-color: var(--theme-border, #e8ddd3);
}

.wcf-btn-cancel:hover:not(:disabled) {
  background: var(--theme-surface-hover, #efe5d9);
}

.wcf-btn-primary {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary, #d4a574);
}

.wcf-btn-primary:hover:not(:disabled) {
  background: var(--theme-accent-hover, #c9955f);
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
