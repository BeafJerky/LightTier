<template>
  <!-- 5.6：高级选项（折叠分组，布尔开关 2 列 + 文本输入） -->
  <details class="ed-adv-collapse" open>
    <summary class="ed-form-section-title ed-adv-summary"
      >✦ {{ t('newEdit.advancedSection') }}</summary
    >
    <div class="ed-form-grid">
      <div
        class="ed-form-field ed-form-field--switch"
        v-for="f in visibleAdvancedFlagDefs"
        :key="f.key"
      >
        <label
          class="ed-form-label"
          :for="fieldId(f.key)"
          :title="f.tooltipKey ? t(f.tooltipKey) : f.key"
          >{{ t(f.labelKey) }}</label
        >
        <div class="ed-form-switch-wrap">
          <LtSwitch
            :model-value="isAdvancedFlagOn(f)"
            :aria-label="t(f.labelKey)"
            @update:model-value="toggleAdvancedFlag(f)"
          />
        </div>
      </div>
      <div
        class="ed-form-field ed-form-field--switch"
        v-for="f in visibleTopSwitchDefs"
        :key="f.key"
      >
        <label
          class="ed-form-label"
          :for="fieldId(f.key)"
          :title="f.tooltipKey ? t(f.tooltipKey) : f.key"
          >{{ t(f.labelKey) }}</label
        >
        <div class="ed-form-switch-wrap">
          <LtSwitch
            :model-value="formData[f.key] === true"
            :aria-label="t(f.labelKey)"
            @update:model-value="toggleTopSwitch(f.key)"
          />
        </div>
      </div>
      <div class="ed-form-field" v-for="f in visibleTopTextDefs" :key="f.key">
        <label
          class="ed-form-label"
          :for="fieldId(f.key)"
          :title="f.tooltipKey ? t(f.tooltipKey) : f.key"
          >{{ t(f.labelKey) }}</label
        >
        <LtInput
          v-if="f.key === 'stun_servers'"
          v-model="formStunServers"
          variant="outline"
          :aria-label="t(f.labelKey)"
          :placeholder="f.key"
        />
        <LtInput
          v-else
          v-model="formData[f.key]"
          variant="outline"
          :aria-label="t(f.labelKey)"
          :placeholder="f.key"
        />
      </div>
    </div>
    <div v-if="isAddMode" class="ed-compat-note">
      {{
        store.detectedCoreVersion
          ? t('newEdit.adaptedHint', { version: store.detectedCoreVersion })
          : t('newEdit.adaptedUnknown')
      }}
    </div>
  </details>

  <!-- 安全模式：位于未兼容栏之前，开启后才展开字段并写入 [secure_mode] 表 -->
  <div v-if="securitySectionVisible" class="ed-form-section ed-secure-section">
    <div class="ed-secure-head" :title="t('newEdit.tipSecureMode')">
      <span class="ed-secure-title">🔒 {{ t('newEdit.securitySection') }}</span>
      <LtSwitch v-model="secureModeEnabled" :aria-label="t('newEdit.securitySection')" />
    </div>
    <div v-if="secureModeEnabled" class="ed-form-grid">
      <div
        class="ed-form-field"
        :class="{ 'ed-form-field-wide': f.filePick }"
        v-for="f in visibleSecurityFieldDefs"
        :key="f.key"
      >
        <label
          class="ed-form-label"
          :for="fieldId(f.key)"
          :title="f.tooltipKey ? t(f.tooltipKey) : f.key"
          >{{ t(f.labelKey) }}</label
        >
        <div class="ed-secret-row">
          <LtInput
            :class="{ 'ed-secret-input': f.secret }"
            :model-value="secretDisplays[f.key] ?? formData[f.key] ?? ''"
            variant="outline"
            :aria-label="t(f.labelKey)"
            :placeholder="f.key"
            :type="f.secret && !secretVisible[f.key] ? 'password' : 'text'"
            @update:model-value="onSecurityInput(f, $event)"
          />
          <LtButton
            v-if="f.secret"
            variant="ghost"
            size="sm"
            :title="secretVisible[f.key] ? t('newEdit.hideSecret') : t('newEdit.showSecret')"
            :aria-label="secretVisible[f.key] ? t('newEdit.hideSecret') : t('newEdit.showSecret')"
            @click="toggleSecretVisible(f.key)"
            >{{
              secretVisible[f.key] ? t('newEdit.hideSecret') : t('newEdit.showSecret')
            }}</LtButton
          >
          <LtButton
            v-if="f.filePick"
            variant="ghost"
            size="sm"
            :title="t('newEdit.pickFile')"
            :aria-label="t('newEdit.pickFile')"
            @click="pickCredentialFile"
            >📁 {{ t('newEdit.pickFile') }}</LtButton
          >
        </div>
      </div>
    </div>
  </div>

  <!-- 当前内核未兼容：配置文件中有、但当前内核不支持/已移除的配置项（只读，保存原样保留） -->
  <details v-if="lockedEntries.length" class="ed-adv-collapse ed-locked-collapse">
    <summary class="ed-form-section-title ed-adv-summary">
      ⚠ {{ t('newEdit.unsupportedSection') }} ({{ lockedEntries.length }})
    </summary>
    <div class="ed-locked-hint">
      {{
        store.detectedCoreVersion
          ? t('newEdit.unsupportedHint', { version: store.detectedCoreVersion })
          : t('newEdit.adaptedUnknown')
      }}
    </div>
    <div class="ed-locked-list">
      <div class="ed-locked-row" v-for="entry in lockedEntries" :key="entry.key">
        <span class="ed-locked-key">{{ entry.key }}</span>
        <span class="ed-locked-value">{{ entry.value }}</span>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput, LtSwitch } from '@/shared/ui'
import { useEasyTierStore } from '@/shared/store/easytier'
import { injectRequired } from '@/shared/lib/inject'
import { CONFIG_EDITOR_KEY } from './context'

defineOptions({ name: 'ConfigAdvancedForm' })

const { t } = useI18n()
const store = useEasyTierStore()
const {
  fieldId,
  formData,
  isAddMode,
  visibleAdvancedFlagDefs,
  visibleTopSwitchDefs,
  visibleTopTextDefs,
  formStunServers,
  isAdvancedFlagOn,
  toggleAdvancedFlag,
  toggleTopSwitch,
  securitySectionVisible,
  secureModeEnabled,
  visibleSecurityFieldDefs,
  secretDisplays,
  secretVisible,
  onSecurityInput,
  toggleSecretVisible,
  pickCredentialFile,
  lockedEntries
} = injectRequired(CONFIG_EDITOR_KEY, 'ConfigAdvancedForm')
</script>

<style scoped lang="less">
@import url('./form.less');
</style>
