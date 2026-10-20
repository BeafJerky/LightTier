<template>
  <CreamDialog
    v-model="visible"
    :title="dialogMode === 'add' ? t('newEdit.addTitle') : t('newEdit.editTitle')"
    width="800px"
    :inline="inline"
  >
    <!-- 配置名称（仅新增模式显示） -->
    <div v-if="dialogMode === 'add'" class="ed-name-bar">
      <label class="ed-form-label">{{ t('newEdit.configName') }}</label>
      <input
        class="ed-form-input ed-name-input"
        v-model="newConfigName"
        :placeholder="t('newEdit.configNamePlaceholder')"
      />
      <span v-if="nameError" class="ed-name-error">{{ nameError }}</span>
      <!-- 模板下拉（5.8）：仅派生表单初始值，不落入 TOML 序列化管线 -->
      <div class="ed-select-wrapper" ref="templateDropdownRef">
        <button
          class="ed-select-trigger"
          ref="templateTriggerRef"
          @click="templateDropdownOpen = !templateDropdownOpen"
        >
          <span>✦ {{ t(currentTemplateLabel) }}</span>
          <svg
            class="ed-select-arrow"
            :class="{ open: templateDropdownOpen }"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <Teleport to="body">
          <div
            v-if="templateDropdownOpen"
            class="ed-select-dropdown ed-select-dropdown-fixed"
            :style="templateDropdownStyle"
          >
            <div
              v-for="tpl in CONFIG_TEMPLATES"
              :key="tpl.id"
              class="ed-select-option"
              :class="{ active: templateId === tpl.id }"
              @click="(applyTemplate(tpl.id), (templateDropdownOpen = false))"
              >✦ {{ t(tpl.labelKey) }}</div
            >
          </div>
        </Teleport>
      </div>
      <button class="ed-import-btn" @click="handleImportToml" :title="t('newEdit.importToml')">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        {{ t('newEdit.importToml') }}
      </button>
    </div>

    <!-- 双模式切换：代码直编 / 表单结构化（切表单自动重解析；切代码先回写表单改动） -->
    <div class="ed-tabs">
      <button class="ed-tab" :class="{ active: editMode === 'code' }" @click="switchToCode">{{
        t('newEdit.codeEdit')
      }}</button>
      <button class="ed-tab" :class="{ active: editMode === 'form' }" @click="switchToForm">{{
        t('newEdit.formEdit')
      }}</button>
    </div>

    <div class="ed-body">
      <!-- 代码模式 -->
      <div v-show="editMode === 'code'" class="ed-code-wrap">
        <CodeEditor v-model="tomlContent" language="toml" />
      </div>

      <!-- 表单模式 -->
      <div v-show="editMode === 'form'" class="ed-form-scroll">
        <div class="ed-form-section">
          <div class="ed-form-section-title">{{ t('newEdit.basicConfig') }}</div>
          <div class="ed-form-grid">
            <div class="ed-form-field">
              <label class="ed-form-label">{{ t('newConfig.hostname') }}</label>
              <input class="ed-form-input" v-model="formData.hostname" placeholder="hostname" />
            </div>
            <div class="ed-form-field">
              <label class="ed-form-label">{{ t('newConfig.instanceName') }}</label>
              <input
                class="ed-form-input"
                v-model="formData.instance_name"
                placeholder="instance_name"
              />
            </div>
          </div>
        </div>

        <div class="ed-form-section">
          <div class="ed-form-section-title">{{ t('newEdit.network') }}</div>
          <div class="ed-form-grid">
            <div class="ed-form-field">
              <label class="ed-form-label">{{ t('newConfig.networkName') }}</label>
              <input
                class="ed-form-input"
                v-model="formDataNetworkName"
                placeholder="network_name"
              />
            </div>
            <div class="ed-form-field">
              <label class="ed-form-label">{{ t('newEdit.networkSecret') }}</label>
              <input
                class="ed-form-input"
                v-model="formDataNetworkSecret"
                placeholder="network_secret"
              />
            </div>
            <div class="ed-form-field">
              <label class="ed-form-label">DHCP</label>
              <div class="ed-form-switch-wrap">
                <span
                  class="ed-form-switch"
                  :class="{ on: formData.dhcp }"
                  @click="formData.dhcp = !formData.dhcp"
                >
                  {{ formData.dhcp ? t('newConfig.dhcpEnabled') : t('newConfig.dhcpDisabled') }}
                </span>
              </div>
            </div>
            <div class="ed-form-field">
              <label class="ed-form-label">{{ t('newConfig.rpcPortal') }}</label>
              <input
                class="ed-form-input"
                v-model="formData.rpc_portal"
                placeholder="0.0.0.0:15888"
              />
            </div>
          </div>
        </div>

        <div class="ed-form-section">
          <div class="ed-form-section-title">{{ t('newEdit.listenSection') }}</div>
          <div class="ed-tag-list">
            <div class="ed-tag-row" v-for="(_, i) in formListeners" :key="'l' + i">
              <input
                class="ed-form-input ed-tag-input"
                v-model="formListeners[i]"
                placeholder="tcp://0.0.0.0:11000"
              />
              <button class="ed-tag-del" @click="formListeners.splice(i, 1)">✕</button>
            </div>
            <button class="ed-tag-add" @click="formListeners.push('')">{{
              t('newEdit.addListen')
            }}</button>
          </div>
        </div>

        <div class="ed-form-section">
          <div class="ed-form-section-title">{{ t('newEdit.peerSection') }}</div>
          <div class="ed-tag-list">
            <div class="ed-tag-row" v-for="(_, i) in formPeers" :key="'p' + i">
              <input
                class="ed-form-input ed-tag-input"
                v-model="formPeers[i]"
                placeholder="tcp://host:port"
              />
              <button class="ed-tag-del" @click="formPeers.splice(i, 1)">✕</button>
            </div>
            <button class="ed-tag-add" @click="formPeers.push('')">{{
              t('newEdit.addPeer')
            }}</button>
          </div>
        </div>

        <div class="ed-form-section">
          <div class="ed-form-section-title">{{ t('newEdit.routeSection') }}</div>
          <div class="ed-tag-list">
            <div class="ed-tag-row" v-for="(_, i) in formRoutes" :key="'rt' + i">
              <input
                class="ed-form-input ed-tag-input"
                v-model="formRoutes[i]"
                placeholder="10.0.0.0/8"
              />
              <button class="ed-tag-del" @click="formRoutes.splice(i, 1)">✕</button>
            </div>
            <button class="ed-tag-add" @click="formRoutes.push('')">{{
              t('newEdit.addRoute')
            }}</button>
          </div>
        </div>

        <div class="ed-form-section">
          <div class="ed-form-section-title">{{ t('newEdit.exitSection') }}</div>
          <div class="ed-tag-list">
            <div class="ed-tag-row" v-for="(_, i) in formExitNodes" :key="'en' + i">
              <input
                class="ed-form-input ed-tag-input"
                v-model="formExitNodes[i]"
                placeholder="10.0.0.0/24"
              />
              <button class="ed-tag-del" @click="formExitNodes.splice(i, 1)">✕</button>
            </div>
            <button class="ed-tag-add" @click="formExitNodes.push('')">{{
              t('newEdit.addExit')
            }}</button>
          </div>
        </div>

        <div class="ed-form-section" v-if="formFlagsKeys.length">
          <div class="ed-form-section-title">{{ t('newEdit.flagsSection') }}</div>
          <div class="ed-tag-list">
            <div class="ed-tag-row" v-for="(_, i) in formFlagsKeys" :key="'f' + i">
              <input
                class="ed-form-input ed-tag-input-short"
                v-model="formFlagsKeys[i]"
                placeholder="key"
              />
              <input
                class="ed-form-input ed-tag-input"
                v-model="formFlagsVals[i]"
                placeholder="value"
              />
              <button class="ed-tag-del" @click="removeFlag(i)">✕</button>
            </div>
            <button class="ed-tag-add" @click="(formFlagsKeys.push(''), formFlagsVals.push(''))">{{
              t('newEdit.addFlag')
            }}</button>
          </div>
        </div>

        <!-- 5.6：安全模式（折叠分组，敏感字段掩码回显） -->
        <details class="ed-adv-collapse" open>
          <summary class="ed-form-section-title ed-adv-summary"
            >🔒 {{ t('newEdit.securitySection') }}</summary
          >
          <div class="ed-form-grid">
            <div class="ed-form-field" v-for="f in SECURITY_FIELD_DEFS" :key="f.key">
              <label class="ed-form-label" :title="f.tooltipKey ? t(f.tooltipKey) : f.key">{{
                t(f.labelKey)
              }}</label>
              <div class="ed-secret-row">
                <input
                  class="ed-form-input"
                  :class="{ 'ed-secret-input': f.secret }"
                  :value="secretDisplays[f.key] ?? formData[f.key] ?? ''"
                  @input="onSecurityInput(f, ($event.target as HTMLInputElement).value)"
                  :placeholder="f.key"
                  :type="f.secret && !secretVisible[f.key] ? 'password' : 'text'"
                />
                <button
                  v-if="f.secret"
                  class="ed-btn-sm"
                  :title="secretVisible[f.key] ? t('newEdit.hideSecret') : t('newEdit.showSecret')"
                  @click="toggleSecretVisible(f.key)"
                  >{{
                    secretVisible[f.key] ? t('newEdit.hideSecret') : t('newEdit.showSecret')
                  }}</button
                >
                <button
                  v-if="f.filePick"
                  class="ed-btn-sm"
                  :title="t('newEdit.pickFile')"
                  @click="pickCredentialFile"
                  >📁 {{ t('newEdit.pickFile') }}</button
                >
              </div>
            </div>
          </div>
        </details>

        <!-- 5.6：高级选项（折叠分组，布尔开关 2 列 + 文本输入） -->
        <details class="ed-adv-collapse" open>
          <summary class="ed-form-section-title ed-adv-summary"
            >✦ {{ t('newEdit.advancedSection') }}</summary
          >
          <div class="ed-form-grid">
            <div class="ed-form-field" v-for="f in ADVANCED_FLAG_DEFS" :key="f.key">
              <label class="ed-form-label" :title="f.tooltipKey ? t(f.tooltipKey) : f.key">{{
                t(f.labelKey)
              }}</label>
              <div class="ed-form-switch-wrap">
                <span
                  class="ed-form-switch"
                  :class="{ on: formData.flags?.[f.key] === true }"
                  @click="toggleAdvancedFlag(f.key)"
                >
                  {{
                    formData.flags?.[f.key] === true
                      ? t('newConfig.dhcpEnabled')
                      : t('newConfig.dhcpDisabled')
                  }}
                </span>
              </div>
            </div>
            <div class="ed-form-field" v-for="f in ADVANCED_TEXT_DEFS" :key="f.key">
              <label class="ed-form-label" :title="f.tooltipKey ? t(f.tooltipKey) : f.key">{{
                t(f.labelKey)
              }}</label>
              <input class="ed-form-input" v-model="advFlags[f.key]" :placeholder="f.key" />
            </div>
            <div class="ed-form-field" v-for="f in ADVANCED_TOP_TEXT_DEFS" :key="f.key">
              <label class="ed-form-label" :title="f.tooltipKey ? t(f.tooltipKey) : f.key">{{
                t(f.labelKey)
              }}</label>
              <input
                v-if="f.key === 'stun_servers'"
                class="ed-form-input"
                v-model="formStunServers"
                :placeholder="f.key"
              />
              <input v-else class="ed-form-input" v-model="formData[f.key]" :placeholder="f.key" />
            </div>
          </div>
        </details>
      </div>
    </div>

    <template #footer>
      <div class="ed-footer">
        <span class="ed-footer-info">{{
          dialogMode === 'add' ? t('newEdit.addFooter') : t('newEdit.editFooter')
        }}</span>
        <div class="ed-footer-btns">
          <button class="ed-btn ed-btn-cancel" @click="visible = false">{{
            t('newCommon.cancel')
          }}</button>
          <button class="ed-btn ed-btn-primary" :disabled="saving" @click="handleSave">{{
            saving
              ? t('newCommon.saving')
              : dialogMode === 'add'
                ? t('newEdit.create')
                : t('newEdit.save')
          }}</button>
        </div>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * EditDialog — 配置编辑弹窗（新增 / 编辑双模式，桌面端使用；Android 走 config-edit-view 页面）
 *
 * 双模式编辑：代码模式直接编辑 TOML 文本（CodeEditor），表单模式由 parseFormData /
 * buildFormToml 双向转换（含 5.8 模板下拉、5.6 安全字段掩码回显 + 高级选项折叠分组）。
 * 保存前统一经 normalizeToml 清洗（合并默认值、剔除空参数，5.7），保证落盘 TOML 简洁。
 * 关键点：secret 字段以掩码展示、真实值暂存 secretBackup，未改动则原值写回。
 */
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { onClickOutside } from '@vueuse/core'
import { CodeEditor } from '@/components/CodeEditor'
import * as toml from 'smol-toml'
import { normalizeToml } from '@/utils/easyTierUtil'
import {
  buildConfigFormModel,
  parseConfigFormModel,
  type ConfigFormModel
} from '@/utils/configFormUtil'
import CreamDialog from '@/components/CreamDialog/index.vue'
import {
  CONFIG_TEMPLATES,
  SECURITY_FIELD_DEFS,
  ADVANCED_FLAG_DEFS,
  ADVANCED_TEXT_DEFS,
  ADVANCED_TOP_TEXT_DEFS,
  type AdvancedFieldDef
} from '@/constants/defaultData'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'

const { t } = useI18n()

// 非 Tauri 环境优雅降级（浏览器预览）；withGlobalTauri 已关闭，用 isTauri() 检测
const isTauri = isTauriRuntime()

// configName / tomlContent 由父组件传入；existingConfigNames 用于新增时的重名校验
const props = defineProps<{
  modelValue: boolean
  configName: string
  tomlContent: string
  dialogMode?: 'add' | 'edit'
  existingConfigNames?: string[]
  // 内联模式：透传 CreamDialog，作为页面级卡片渲染（移动端二级页面用）
  inline?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  saved: [name: string, content: string]
}>()

const visible = ref(props.modelValue)
// 弹窗打开时重置内部状态（配置名 / 校验错误 / 模板选择）
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
    if (v) {
      newConfigName.value = props.dialogMode === 'add' ? '' : props.configName
      nameError.value = ''
      templateId.value = 'custom'
      templateDropdownOpen.value = false
      // 重新打开时回到代码模式：避免上一次打开留下的表单值被保存到新配置
      editMode.value = 'code'
      formParsedOk.value = false
    }
  }
)
watch(visible, (v) => {
  emit('update:modelValue', v)
})

const dialogMode = computed(() => props.dialogMode || 'edit')
const newConfigName = ref(props.configName || '')
const nameError = ref('')
// 编辑模式：code 代码直编 / form 结构化表单（默认代码模式）
const editMode = ref<'code' | 'form'>('code')
// 保存中标志：避免重复提交
const saving = ref(false)
// 代码区内容：外部传入的 TOML 原文，编辑期间以本地副本为准
const tomlContent = ref(props.tomlContent)
watch(
  () => props.tomlContent,
  (v) => {
    tomlContent.value = v
  }
)

interface FormData {
  hostname: string
  instance_name: string
  dhcp: boolean
  rpc_portal: string
  network_identity?: { network_name?: string; network_secret?: string }
  listeners?: string[]
  peer?: { uri: string }[]
  routes?: string[]
  exit_nodes?: string[]
  flags?: Record<string, any>
  [key: string]: any
}

const formData = ref<FormData>({
  hostname: '',
  instance_name: '',
  dhcp: true,
  rpc_portal: '',
  flags: {}
})

// 5.6：flags 兜底对象（模板 v-model 需非空）
const advFlags = computed(() => formData.value.flags || {})

// 5.6：安全字段掩码回显（真实值备份在 secretBackup，保存时写回）
const secretDisplays = ref<Record<string, string>>({})
const secretBackup = ref<Record<string, string>>({})
// 敏感字段显隐切换（默认使用 password 类型显示，点击“显示”后明文）
const secretVisible = ref<Record<string, boolean>>({})
// stun_servers 为数组，表单以逗号分隔文本展示
const formStunServers = ref('')

const formListeners = ref<string[]>([])
const formPeers = ref<string[]>([])
const formRoutes = ref<string[]>([])
const formExitNodes = ref<string[]>([])
const formFlagsKeys = ref<string[]>([])
const formFlagsVals = ref<string[]>([])

const formDataNetworkName = ref('')
const formDataNetworkSecret = ref('')

// TOML 原文 → 表单模型：解析失败时保留空表单（用户切到表单模式不报错）
// @returns 是否解析成功（供代码/表单双向切换判断能否安全回写）
// 注：以当前代码区内容（tomlContent）为准而非 props 原文，保证代码区编辑/模板应用后表单同步
const parseFormData = (): boolean => {
  const model = parseConfigFormModel(tomlContent.value)
  if (!model) return false
  formData.value = { ...model.formData } as FormData
  secretDisplays.value = model.secretDisplays
  secretBackup.value = model.secretBackup
  formStunServers.value = model.stunServers
  formListeners.value = [...model.listeners]
  formPeers.value = [...model.peers]
  formRoutes.value = [...model.routes]
  formExitNodes.value = [...model.exitNodes]
  formFlagsKeys.value = [...model.flagsKeys]
  formFlagsVals.value = [...model.flagsVals]
  formDataNetworkName.value = model.networkName
  formDataNetworkSecret.value = model.networkSecret
  return true
}

// 当前表单状态 → 模型（供构建 TOML 使用）
const collectFormModel = (): ConfigFormModel => ({
  formData: formData.value as Record<string, any>,
  secretDisplays: secretDisplays.value,
  secretBackup: secretBackup.value,
  stunServers: formStunServers.value,
  listeners: formListeners.value,
  peers: formPeers.value,
  routes: formRoutes.value,
  exitNodes: formExitNodes.value,
  flagsKeys: formFlagsKeys.value,
  flagsVals: formFlagsVals.value,
  networkName: formDataNetworkName.value,
  networkSecret: formDataNetworkSecret.value
})

// 表单模型 → TOML 文本：空值剔除、安全字段按掩码规则写回、flags 类型推断（bool/number/string）
const buildFormToml = (): string => {
  const { toml: content, secretBackup: backup } = buildConfigFormModel(collectFormModel())
  secretBackup.value = backup
  return content
}

// 删除某行自定义 Flag（key/value 同步移除，保持两数组索引对齐）
const removeFlag = (i: number) => {
  formFlagsKeys.value.splice(i, 1)
  formFlagsVals.value.splice(i, 1)
}

// === 5.6 高级字段交互 ===
const toggleAdvancedFlag = (key: string) => {
  if (!formData.value.flags) formData.value.flags = {}
  const flags = formData.value.flags
  flags[key] = flags[key] === true ? false : true
}

// 敏感字段输入：掩码未被修改时保持占位，用户输入即视为新值
const onSecurityInput = (f: AdvancedFieldDef, value: string) => {
  if (f.secret) {
    secretDisplays.value[f.key] = value
  } else {
    formData.value[f.key] = value
  }
}

// credential_file 📁 选择（Tauri 文件选择）
const pickCredentialFile = async () => {
  if (!isTauri) return
  try {
    const selected = await open({
      multiple: false,
      title: t('newEdit.pickFile')
    })
    if (selected) {
      formData.value.credential_file = selected
    }
  } catch {
    /* ignore */
  }
}

// 敏感字段显隐切换（password ↔ text）
const toggleSecretVisible = (key: string) => {
  secretVisible.value[key] = !secretVisible.value[key]
}

// 切到表单模式：以当前代码区内容重新解析，保证两种模式数据一致
// formParsedOk 记录解析是否成功，失败时禁止表单 → 代码回写（避免覆盖用户无法解析的代码）
const formParsedOk = ref(false)
const switchToForm = () => {
  formParsedOk.value = parseFormData()
  editMode.value = 'form'
}

// 切到代码模式：先把表单改动回写到代码区，避免“表单改完切代码再保存”路径丢失修改
const switchToCode = () => {
  if (editMode.value === 'form' && formParsedOk.value) {
    tomlContent.value = buildFormToml()
  }
  editMode.value = 'code'
}

// === 配置模板（5.8） ===
const templateId = ref<'server' | 'client' | 'custom'>('custom')
const templateDropdownOpen = ref(false)
const templateDropdownRef = ref<HTMLElement | null>(null)
const templateTriggerRef = ref<HTMLButtonElement | null>(null)
onClickOutside(templateDropdownRef, () => {
  templateDropdownOpen.value = false
})

const currentTemplateLabel = computed(() => {
  const tpl = CONFIG_TEMPLATES.find((t) => t.id === templateId.value)
  return tpl ? tpl.labelKey : 'newEdit.templateCustom'
})

const templateDropdownStyle = computed(() => {
  if (!templateTriggerRef.value) return {}
  const rect = templateTriggerRef.value.getBoundingClientRect()
  const dropdownWidth = Math.max(rect.width, 140)
  // 窄屏下拉不超出视口右缘
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8))
  return {
    position: 'fixed' as const,
    top: `${rect.bottom + 4}px`,
    left: `${left}px`,
    width: `${dropdownWidth}px`,
    zIndex: 9999
  }
})

// 应用模板：覆写代码区 TOML，表单模式下同步重解析（模板不落盘、仅影响初始值）
const applyTemplate = (id: 'server' | 'client' | 'custom') => {
  const tpl = CONFIG_TEMPLATES.find((t) => t.id === id)
  if (!tpl) return
  templateId.value = id
  tomlContent.value = Object.keys(tpl.values).length ? toml.stringify(tpl.values) : ''
  if (editMode.value === 'form') {
    formParsedOk.value = parseFormData()
  }
}

// 校验配置名：非空、仅字母数字下划线连字符、新增时不得与现有配置重名
const validateName = (): boolean => {
  if (!newConfigName.value.trim()) {
    nameError.value = t('newEdit.nameEmpty')
    return false
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(newConfigName.value)) {
    nameError.value = t('newEdit.nameInvalid')
    return false
  }
  if (props.dialogMode === 'add' && props.existingConfigNames?.includes(newConfigName.value)) {
    nameError.value = t('newEdit.nameExists')
    return false
  }
  nameError.value = ''
  return true
}

// 保存：按当前模式取内容 → normalizeToml 清洗 → emit saved（父组件负责写盘）
const handleSave = async () => {
  saving.value = true
  try {
    // 5.7：保存前统一清洗（默认值合并 + 空值剔除），双模式均不落空参数
    const rawContent = editMode.value === 'code' ? tomlContent.value : buildFormToml()
    let content = rawContent
    try {
      content = toml.stringify(
        normalizeToml(toml.parse(rawContent) as Record<string, any>, { mergeDefaults: false })
      )
    } catch {
      /* 解析失败按原样保存 */
    }
    if (dialogMode.value === 'add') {
      if (!validateName()) return
      emit('saved', newConfigName.value, content)
    } else {
      emit('saved', props.configName, content)
    }
    visible.value = false
  } finally {
    saving.value = false
  }
}

// 从 TOML 文件导入（校验格式后填充代码区；文件名可用时自动作为配置名）
const handleImportToml = async () => {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'TOML', extensions: ['toml'] }]
    })
    if (!selected) return
    const content = await readTextFile(selected)
    // 校验 TOML 格式
    toml.parse(content)
    tomlContent.value = content
    // 从文件名提取配置名
    const fileName = selected.split(/[\\/]/).pop() || ''
    const nameWithoutExt = fileName.replace(/\.toml$/i, '')
    if (nameWithoutExt && !props.existingConfigNames?.includes(nameWithoutExt)) {
      newConfigName.value = nameWithoutExt
      nameError.value = ''
    }
  } catch (e: any) {
    // 如果是解析错误，提示用户
    if (e?.message) {
      nameError.value = t('newEdit.importFail')
    }
  }
}
</script>

<style scoped>
.ed-name-bar {
  display: flex;
  padding: 12px 16px;
  margin-bottom: 14px;
  background: var(--theme-bg-tag, rgb(232 160 160 / 4%));
  border: 1.5px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
  align-items: center;
  gap: 10px;
}

.ed-name-input {
  flex: 1;
}

.ed-name-error {
  font-size: 11px;
  color: var(--theme-accent-primary, #e8a0a0);
  white-space: nowrap;
}

.ed-import-btn {
  display: flex;
  padding: 6px 14px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-muted, #c8bdb2);
  white-space: nowrap;
  cursor: pointer;
  background: none;
  border: 1.5px dashed var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: all 0.2s;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.ed-import-btn:hover {
  color: var(--theme-accent-primary, #e8a0a0);
  border-color: var(--theme-accent-primary, #e8a0a0);
  border-style: solid;
}

/* 模板下拉（复用 SettingsDialog 已验证的 trigger + Teleport + fixed 模式） */
.ed-select-wrapper {
  position: relative;
  flex-shrink: 0;
}

.ed-select-trigger {
  display: flex;
  min-width: 110px;
  padding: 6px 10px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: border-color 0.2s;
  align-items: center;
  gap: 6px;
}

.ed-select-trigger:hover {
  color: var(--theme-accent-primary, #e8a0a0);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.ed-select-arrow {
  margin-left: auto;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.ed-select-arrow.open {
  transform: rotate(180deg);
}

.ed-select-dropdown {
  max-height: 160px;
  padding: 4px;
  overflow-y: auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-sm, 6px);
  box-shadow: var(--theme-shadow-sm, 0 4px 12px rgb(0 0 0 / 12%));
}

.ed-select-dropdown-fixed {
  position: fixed !important;
}

.ed-select-option {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.12s;
}

.ed-select-option:hover {
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
}

.ed-select-option.active {
  font-weight: 500;
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

.ed-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
}

.ed-tab {
  padding: 6px 18px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary, #7a6e5e);
  cursor: pointer;
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border: 1.5px solid transparent;
  border-radius: var(--theme-radius-pill, 100px);
  transition: all 0.2s;
}

.ed-tab.active {
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-card, #fff);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.ed-tab:hover {
  color: var(--theme-text-primary, #4a3728);
}

.ed-body {
  min-height: 350px;
}

.ed-code-wrap {
  height: 400px;
  overflow: hidden;
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-md, 12px);
}

.ed-form-scroll {
  max-height: 400px;
  padding-right: 4px;
  overflow-y: auto;
}

.ed-form-scroll::-webkit-scrollbar {
  width: 4px;
}

.ed-form-scroll::-webkit-scrollbar-thumb {
  background: var(--theme-color-scrollbar, #e8d5c4);
  border-radius: 4px;
}

.ed-form-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.ed-form-section {
  margin-bottom: 20px;
}

.ed-form-section-title {
  padding-bottom: 6px;
  margin-bottom: 10px;
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--theme-accent-primary, #e8a0a0);
  border-bottom: 1px solid var(--theme-border-light, #f5ede6);
}

.ed-form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.ed-form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ed-form-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-muted, #c8bdb2);
  text-transform: uppercase;
}

.ed-form-input {
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

.ed-form-input:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.ed-form-switch-wrap {
  padding: 4px 0;
}

.ed-form-switch {
  display: inline-block;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: color-mix(in srgb, var(--theme-text-muted, #c8bdb2) 10%, transparent);
  border-radius: var(--theme-radius-pill, 100px);
  transition: all 0.2s;
}

.ed-form-switch.on {
  color: var(--theme-color-success, #7fba8a);
  background: color-mix(in srgb, var(--theme-color-success, #7fba8a) 12%, transparent);
}

.ed-tag-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ed-tag-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.ed-tag-input {
  flex: 1;
}

.ed-tag-input-short {
  width: 120px;
  flex-shrink: 0;
}

.ed-tag-del {
  display: flex;
  width: 26px;
  height: 26px;
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 50%;
  transition: all 0.2s;
  align-items: center;
  justify-content: center;
}

.ed-tag-del:hover {
  color: var(--theme-accent-primary, #e8a0a0);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 10%, transparent);
}

.ed-tag-add {
  padding: 6px 14px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: none;
  border: 1.5px dashed var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: all 0.2s;
  align-self: flex-start;
}

.ed-tag-add:hover {
  color: var(--theme-accent-primary, #e8a0a0);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

/* 5.6：折叠分组 + 安全字段 */
.ed-adv-collapse {
  margin-bottom: 20px;
}

.ed-adv-collapse summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
}

.ed-adv-collapse summary::-webkit-details-marker {
  display: none;
}

.ed-adv-collapse[open] .ed-adv-summary::before {
  content: '▾ ';
}

.ed-adv-collapse:not([open]) .ed-adv-summary::before {
  content: '▸ ';
}

.ed-secret-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.ed-secret-row .ed-form-input {
  flex: 1;
}

.ed-secret-input {
  font-family: 'Cascadia Code', Consolas, monospace;
  letter-spacing: 2px;
}

.ed-btn-sm {
  padding: 6px 12px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 11px;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: all 0.2s;
}

.ed-btn-sm:hover {
  color: var(--theme-accent-primary, #e8a0a0);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.ed-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.ed-footer-info {
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
}

.ed-footer-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ed-btn {
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: var(--theme-radius-sm, 10px);
  transition: all 0.15s;
}

.ed-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.ed-btn-cancel {
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-surface-secondary, #f5ede4);
  border-color: var(--theme-border, #e8ddd3);
}

.ed-btn-cancel:hover:not(:disabled) {
  background: var(--theme-surface-hover, #efe5d9);
}

.ed-btn-primary {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary, #d4a574);
}

.ed-btn-primary:hover:not(:disabled) {
  background: var(--theme-accent-hover, #c9955f);
}

/* 移动端窄屏：名称栏换行、表单单列、编辑区降矮、底部按钮可换行 */
@media (width <= 640px) {
  .ed-name-bar {
    flex-wrap: wrap;
  }

  .ed-name-input {
    flex: 1 1 100%;
  }

  .ed-body {
    min-height: 0;
  }

  .ed-code-wrap {
    height: 280px;
  }

  .ed-form-scroll {
    max-height: 320px;
  }

  .ed-form-grid {
    grid-template-columns: 1fr;
  }

  .ed-footer {
    flex-wrap: wrap;
    gap: 8px;
  }
}
</style>
