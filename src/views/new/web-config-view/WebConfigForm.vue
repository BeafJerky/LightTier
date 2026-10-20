<template>
  <CreamDialog
    v-model="visible"
    :title="mode === 'add' ? t('newWebForm.addTitle') : t('newWebForm.editTitle')"
    width="520px"
  >
    <!-- 配置名称（仅新增模式） -->
    <div v-if="mode === 'add'" class="wcf-field-bar">
      <label class="wcf-label">{{ t('newWebForm.configName') }}</label>
      <input
        class="wcf-input"
        v-model="form.configFileName"
        :placeholder="t('newWebForm.configNamePlaceholder')"
      />
      <span v-if="nameError" class="wcf-error">{{ nameError }}</span>
    </div>

    <!-- 服务器信息 -->
    <div class="wcf-section">
      <div class="wcf-section-title">{{ t('newWebForm.serverInfo') }}</div>
      <div class="wcf-grid">
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.protocol') }}</label>
          <select class="wcf-select" v-model="form.protocol">
            <option value="udp">udp</option>
            <option value="tcp">tcp</option>
          </select>
        </div>
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.host') }}</label>
          <input
            class="wcf-input"
            v-model="form.host"
            :placeholder="t('newWebForm.hostPlaceholder')"
          />
          <span v-if="hostError" class="wcf-error">{{ hostError }}</span>
        </div>
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.port') }}</label>
          <input
            class="wcf-input"
            type="number"
            v-model.number="form.port"
            min="1"
            max="65535"
            placeholder="22020"
          />
        </div>
      </div>
    </div>

    <!-- 用户名 + 控制台地址 -->
    <div class="wcf-section">
      <div class="wcf-section-title">{{ t('newWebForm.account') }}</div>
      <div class="wcf-grid">
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.username') }}</label>
          <input
            class="wcf-input"
            v-model="form.userName"
            maxlength="36"
            :placeholder="t('newWebForm.usernamePlaceholder')"
          />
          <span v-if="userError" class="wcf-error">{{ userError }}</span>
        </div>
        <div class="wcf-field">
          <label class="wcf-label">{{ t('newWebForm.consoleAddr') }}</label>
          <input
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
          <button class="wcf-btn wcf-btn-cancel" @click="visible = false">{{
            t('newCommon.cancel')
          }}</button>
          <button class="wcf-btn wcf-btn-primary" :disabled="saving" @click="handleSave">{{
            saving
              ? t('newCommon.saving')
              : mode === 'add'
                ? t('newWebForm.create')
                : t('newWebForm.save')
          }}</button>
        </div>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * WebConfigForm — Web 控制台配置表单（新增 / 编辑双模式，web-config-view 专用弹窗）
 *
 * 字段：配置名（仅新增）、协议/主机/端口、用户名与控制台地址。
 * 校验规则与 config-view 的 EditDialog 不同：用户名允许 @ 与点号（EasyTier 用户名语义），
 * 端口越界自动回退默认值 22020；保存时深拷贝表单，避免外部修改引用。
 */
import { ref, watch } from 'vue'
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
  saved: [data: FormWebData]
}>()

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
const saving = ref(false)

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
}

// 校验：新增模式校验配置名（非空/字符/重名）；用户名与主机始终必填；端口越界回退默认值
const validate = (): boolean => {
  nameError.value = ''
  hostError.value = ''
  userError.value = ''
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
  if (!form.value.port || form.value.port < 1 || form.value.port > 65535) {
    form.value.port = 22020
  }

  return ok
}

// 保存：校验通过后 emit saved（父组件负责落盘），并关闭弹窗
const handleSave = () => {
  if (!validate()) return
  saving.value = true
  try {
    emit('saved', cloneDeep(form.value))
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
  font-size: 11px;
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
  transition: border-color 0.2s;
}

.wcf-select {
  cursor: pointer;
}

.wcf-input:focus,
.wcf-select:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.wcf-error {
  font-size: 11px;
  color: var(--theme-accent-primary, #e8a0a0);
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
  transition: all 0.15s;
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
</style>
