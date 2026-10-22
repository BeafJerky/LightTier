<template>
  <CreamDialog
    ref="dialogRef"
    v-model="visible"
    :title="dialogMode === 'add' ? t('newEdit.addTitle') : t('newEdit.editTitle')"
    width="800px"
    :inline="inline"
    :before-close="handleBeforeClose"
  >
    <!-- 配置名称（仅新增模式显示） -->
    <div v-if="dialogMode === 'add'" class="ed-name-bar">
      <label class="ed-form-label" :for="fieldId('configName')">{{
        t('newEdit.configName')
      }}</label>
      <input
        :id="fieldId('configName')"
        class="ed-form-input ed-name-input"
        v-model="newConfigName"
        :placeholder="t('newEdit.configNamePlaceholder')"
      />
      <span v-if="nameError" class="ed-name-error" role="alert">{{ nameError }}</span>
      <!-- 模板选择：主题化下拉，选项附带用途说明；仅更新模板相关字段，不覆盖已填写的其他内容 -->
      <div class="ed-template-select">
        <button
          :id="fieldId('template-trigger')"
          ref="templateTriggerRef"
          type="button"
          class="ed-template-trigger"
          :aria-label="t('newEdit.templateLabel')"
          aria-haspopup="listbox"
          :aria-expanded="templateDropdownOpen"
          :aria-controls="fieldId('template-menu')"
          @click.stop="toggleTemplateDropdown"
          @keydown.down.prevent="openTemplateDropdown(1)"
          @keydown.up.prevent="openTemplateDropdown(-1)"
          @keydown.esc="closeTemplateDropdown()"
        >
          <span class="ed-template-trigger-label">{{ t(currentTemplate.labelKey) }}</span>
          <svg
            class="ed-template-caret"
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M1 1l4 4 4-4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
        <Teleport to="body">
          <Transition name="ed-template-drop">
            <div
              v-if="templateDropdownOpen"
              :id="fieldId('template-menu')"
              ref="templateMenuRef"
              class="ed-template-menu"
              :style="templateMenuStyle"
              role="listbox"
              :aria-label="t('newEdit.templateLabel')"
              @keydown.down.prevent="focusTemplateOption(templateHighlighted + 1)"
              @keydown.up.prevent="focusTemplateOption(templateHighlighted - 1)"
              @keydown.home.prevent="focusTemplateOption(0)"
              @keydown.end.prevent="focusTemplateOption(CONFIG_TEMPLATES.length - 1)"
              @keydown.esc.prevent="closeTemplateDropdown(true)"
              @keydown.tab="closeTemplateDropdown()"
            >
              <button
                v-for="(tpl, idx) in CONFIG_TEMPLATES"
                :key="tpl.id"
                type="button"
                role="option"
                class="ed-template-option"
                :class="{ active: tpl.id === templateId }"
                :aria-selected="tpl.id === templateId"
                @click="selectTemplate(tpl.id)"
                @focus="templateHighlighted = idx"
                @mouseenter="templateHighlighted = idx"
              >
                <span class="ed-template-option-text">
                  <span class="ed-template-option-label">{{ t(tpl.labelKey) }}</span>
                  <span class="ed-template-option-desc">{{ t(tpl.descriptionKey) }}</span>
                </span>
                <svg
                  v-if="tpl.id === templateId"
                  class="ed-template-check"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  aria-hidden="true"
                >
                  <path d="M20 6 9 17l-5-5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          </Transition>
        </Teleport>
      </div>
      <button
        type="button"
        class="ed-import-btn"
        @click="handleImportToml"
        :title="t('newEdit.importToml')"
      >
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
    <div class="ed-tabs" role="tablist" :aria-label="t('newEdit.editModeLabel')">
      <button
        id="ed-tab-code"
        ref="codeTabRef"
        type="button"
        class="ed-tab"
        role="tab"
        aria-controls="ed-panel-code"
        :aria-selected="editMode === 'code'"
        :tabindex="editMode === 'code' ? 0 : -1"
        :class="{ active: editMode === 'code' }"
        @click="switchToCode"
        @keydown="handleEditTabKeydown"
        >{{ t('newEdit.codeEdit') }}</button
      >
      <button
        id="ed-tab-form"
        ref="formTabRef"
        type="button"
        class="ed-tab"
        role="tab"
        aria-controls="ed-panel-form"
        :aria-selected="editMode === 'form'"
        :tabindex="editMode === 'form' ? 0 : -1"
        :class="{ active: editMode === 'form' }"
        @click="switchToForm"
        @keydown="handleEditTabKeydown"
        >{{ t('newEdit.formEdit') }}</button
      >
      <span v-if="store.detectedCoreVersion" class="ed-core-target">{{
        t('newEdit.adaptedTo', { version: store.detectedCoreVersion })
      }}</span>
    </div>

    <!-- 版本兼容提示：新建时错误会阻断启动，存量配置仅提示不丢字段 -->
    <div
      v-if="compatIssues.length"
      class="ed-compat-banner"
      :class="hasCompatError ? 'is-error' : 'is-warning'"
    >
      <div class="ed-compat-title">
        {{ hasCompatError ? t('coreCompat.bannerError') : t('coreCompat.bannerWarning') }}
      </div>
      <ul class="ed-compat-list">
        <li v-for="(issue, i) in compatIssues" :key="i">
          {{ t('coreCompat.' + issue.code, issue.params || {}) }}
        </li>
      </ul>
    </div>

    <div class="ed-body">
      <!-- 语法/保存错误条：代码模式实时校验，保存前同步复核 -->
      <div v-if="codeIssue" class="ed-code-error" role="alert">{{ codeIssue }}</div>
      <!-- 代码模式 -->
      <div
        v-show="editMode === 'code'"
        id="ed-panel-code"
        class="ed-code-wrap"
        role="tabpanel"
        aria-labelledby="ed-tab-code"
      >
        <CodeEditor v-model="tomlContent" language="toml" />
      </div>

      <!-- 表单模式 -->
      <div
        v-show="editMode === 'form'"
        id="ed-panel-form"
        class="ed-form-scroll"
        role="tabpanel"
        aria-labelledby="ed-tab-form"
      >
        <div class="ed-form-section">
          <div class="ed-form-section-title">{{ t('newEdit.basicConfig') }}</div>
          <div class="ed-form-grid">
            <div class="ed-form-field">
              <label class="ed-form-label" :for="fieldId('hostname')">{{
                t('newConfig.hostname')
              }}</label>
              <input
                :id="fieldId('hostname')"
                class="ed-form-input"
                v-model="formData.hostname"
                placeholder="hostname"
              />
            </div>
            <div class="ed-form-field">
              <label class="ed-form-label" :for="fieldId('instance_name')">{{
                t('newConfig.instanceName')
              }}</label>
              <input
                :id="fieldId('instance_name')"
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
              <label class="ed-form-label" :for="fieldId('network_name')">{{
                t('newConfig.networkName')
              }}</label>
              <input
                :id="fieldId('network_name')"
                class="ed-form-input"
                v-model="formDataNetworkName"
                placeholder="network_name"
              />
            </div>
            <div class="ed-form-field">
              <label class="ed-form-label" :for="fieldId('network_secret')">{{
                t('newEdit.networkSecret')
              }}</label>
              <input
                :id="fieldId('network_secret')"
                class="ed-form-input"
                v-model="formDataNetworkSecret"
                placeholder="network_secret"
              />
            </div>
            <div class="ed-form-field">
              <label class="ed-form-label" :for="fieldId('dhcp')">DHCP</label>
              <div class="ed-form-switch-wrap">
                <label class="ed-form-switch" :class="{ on: formData.dhcp }">
                  <input
                    :id="fieldId('dhcp')"
                    class="lt-sr-only"
                    type="checkbox"
                    v-model="formData.dhcp"
                  />
                  <span>{{
                    formData.dhcp ? t('newConfig.dhcpEnabled') : t('newConfig.dhcpDisabled')
                  }}</span>
                </label>
              </div>
            </div>
            <div v-if="showRpcPortal" class="ed-form-field">
              <label
                class="ed-form-label"
                :for="fieldId('rpc_portal')"
                :title="unsupportedTitle('rpc_portal')"
                >{{ t('newConfig.rpcPortal')
                }}<span v-if="!rpcPortalSupported" class="ed-field-warn">⚠</span></label
              >
              <input
                :id="fieldId('rpc_portal')"
                class="ed-form-input"
                :class="{ 'ed-input-unsupported': !rpcPortalSupported }"
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
                :aria-label="`${t('newEdit.listenSection')} ${i + 1}`"
                placeholder="tcp://0.0.0.0:11000"
              />
              <button
                type="button"
                class="ed-tag-del"
                :title="t('newEdit.removeItem', { label: t('newEdit.listenSection') })"
                :aria-label="t('newEdit.removeItem', { label: t('newEdit.listenSection') })"
                @click="formListeners.splice(i, 1)"
              >
                ✕
              </button>
            </div>
            <button type="button" class="ed-tag-add" @click="formListeners.push('')">{{
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
                :aria-label="`${t('newEdit.peerSection')} ${i + 1}`"
                placeholder="tcp://host:port"
              />
              <button
                type="button"
                class="ed-tag-del"
                :title="t('newEdit.removeItem', { label: t('newEdit.peerSection') })"
                :aria-label="t('newEdit.removeItem', { label: t('newEdit.peerSection') })"
                @click="removePeer(i)"
              >
                ✕
              </button>
            </div>
            <button type="button" class="ed-tag-add" @click="addPeer">{{
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
                :aria-label="`${t('newEdit.routeSection')} ${i + 1}`"
                placeholder="10.0.0.0/8"
              />
              <button
                type="button"
                class="ed-tag-del"
                :title="t('newEdit.removeItem', { label: t('newEdit.routeSection') })"
                :aria-label="t('newEdit.removeItem', { label: t('newEdit.routeSection') })"
                @click="formRoutes.splice(i, 1)"
              >
                ✕
              </button>
            </div>
            <button type="button" class="ed-tag-add" @click="formRoutes.push('')">{{
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
                :aria-label="`${t('newEdit.exitSection')} ${i + 1}`"
                placeholder="10.0.0.0/24"
              />
              <button
                type="button"
                class="ed-tag-del"
                :title="t('newEdit.removeItem', { label: t('newEdit.exitSection') })"
                :aria-label="t('newEdit.removeItem', { label: t('newEdit.exitSection') })"
                @click="formExitNodes.splice(i, 1)"
              >
                ✕
              </button>
            </div>
            <button type="button" class="ed-tag-add" @click="formExitNodes.push('')">{{
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
                :aria-label="`${t('newEdit.flagsSection')} ${i + 1} key`"
                placeholder="key"
              />
              <input
                class="ed-form-input ed-tag-input"
                v-model="formFlagsVals[i]"
                :aria-label="`${t('newEdit.flagsSection')} ${i + 1} value`"
                placeholder="value"
              />
              <button
                type="button"
                class="ed-tag-del"
                :title="t('newEdit.removeItem', { label: t('newEdit.flagsSection') })"
                :aria-label="t('newEdit.removeItem', { label: t('newEdit.flagsSection') })"
                @click="removeFlag(i)"
              >
                ✕
              </button>
            </div>
            <button
              type="button"
              class="ed-tag-add"
              @click="(formFlagsKeys.push(''), formFlagsVals.push(''))"
              >{{ t('newEdit.addFlag') }}</button
            >
          </div>
        </div>

        <!-- 5.6：高级选项（折叠分组，布尔开关 2 列 + 文本输入） -->
        <details class="ed-adv-collapse" open>
          <summary class="ed-form-section-title ed-adv-summary"
            >✦ {{ t('newEdit.advancedSection') }}</summary
          >
          <div class="ed-form-grid">
            <div class="ed-form-field" v-for="f in visibleAdvancedFlagDefs" :key="f.key">
              <label
                class="ed-form-label"
                :for="fieldId(f.key)"
                :title="f.tooltipKey ? t(f.tooltipKey) : f.key"
                >{{ t(f.labelKey) }}</label
              >
              <div class="ed-form-switch-wrap">
                <label class="ed-form-switch" :class="{ on: isAdvancedFlagOn(f) }">
                  <input
                    :id="fieldId(f.key)"
                    class="lt-sr-only"
                    type="checkbox"
                    :checked="isAdvancedFlagOn(f)"
                    @change="toggleAdvancedFlag(f)"
                  />
                  <span>{{
                    isAdvancedFlagOn(f) ? t('newConfig.dhcpEnabled') : t('newConfig.dhcpDisabled')
                  }}</span>
                </label>
              </div>
            </div>
            <div class="ed-form-field" v-for="f in visibleTopSwitchDefs" :key="f.key">
              <label
                class="ed-form-label"
                :for="fieldId(f.key)"
                :title="f.tooltipKey ? t(f.tooltipKey) : f.key"
                >{{ t(f.labelKey) }}</label
              >
              <div class="ed-form-switch-wrap">
                <label class="ed-form-switch" :class="{ on: formData[f.key] === true }">
                  <input
                    :id="fieldId(f.key)"
                    class="lt-sr-only"
                    type="checkbox"
                    :checked="formData[f.key] === true"
                    @change="toggleTopSwitch(f.key)"
                  />
                  <span>{{
                    formData[f.key] === true
                      ? t('newConfig.dhcpEnabled')
                      : t('newConfig.dhcpDisabled')
                  }}</span>
                </label>
              </div>
            </div>
            <div class="ed-form-field" v-for="f in visibleTopTextDefs" :key="f.key">
              <label
                class="ed-form-label"
                :for="fieldId(f.key)"
                :title="f.tooltipKey ? t(f.tooltipKey) : f.key"
                >{{ t(f.labelKey) }}</label
              >
              <input
                v-if="f.key === 'stun_servers'"
                :id="fieldId(f.key)"
                class="ed-form-input"
                v-model="formStunServers"
                :placeholder="f.key"
              />
              <input
                v-else
                :id="fieldId(f.key)"
                class="ed-form-input"
                v-model="formData[f.key]"
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
            <label class="ed-form-switch" :class="{ on: secureModeEnabled }">
              <input
                class="lt-sr-only"
                type="checkbox"
                v-model="secureModeEnabled"
                :aria-label="t('newEdit.securitySection')"
              />
              <span>{{
                secureModeEnabled ? t('newConfig.dhcpEnabled') : t('newConfig.dhcpDisabled')
              }}</span>
            </label>
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
                <input
                  :id="fieldId(f.key)"
                  class="ed-form-input"
                  :class="{ 'ed-secret-input': f.secret }"
                  :value="secretDisplays[f.key] ?? formData[f.key] ?? ''"
                  @input="onSecurityInput(f, ($event.target as HTMLInputElement).value)"
                  :placeholder="f.key"
                  :type="f.secret && !secretVisible[f.key] ? 'password' : 'text'"
                />
                <button
                  v-if="f.secret"
                  type="button"
                  class="ed-btn-sm"
                  :title="secretVisible[f.key] ? t('newEdit.hideSecret') : t('newEdit.showSecret')"
                  :aria-label="
                    secretVisible[f.key] ? t('newEdit.hideSecret') : t('newEdit.showSecret')
                  "
                  @click="toggleSecretVisible(f.key)"
                  >{{
                    secretVisible[f.key] ? t('newEdit.hideSecret') : t('newEdit.showSecret')
                  }}</button
                >
                <button
                  v-if="f.filePick"
                  type="button"
                  class="ed-btn-sm"
                  :title="t('newEdit.pickFile')"
                  :aria-label="t('newEdit.pickFile')"
                  @click="pickCredentialFile"
                  >📁 {{ t('newEdit.pickFile') }}</button
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
      </div>
    </div>

    <template #footer>
      <div class="ed-footer">
        <span class="ed-footer-info">{{
          dialogMode === 'add' ? t('newEdit.addFooter') : t('newEdit.editFooter')
        }}</span>
        <div class="ed-footer-btns">
          <button type="button" class="ed-btn ed-btn-cancel" @click="requestCloseFromButton">{{
            t('newCommon.cancel')
          }}</button>
          <button
            type="button"
            class="ed-btn ed-btn-primary"
            :disabled="saving || (editMode === 'code' && !!codeIssue)"
            :title="editMode === 'code' && codeIssue ? t('newEdit.codeInvalidSave') : undefined"
            @click="handleSave"
            >{{
              saving
                ? t('newCommon.saving')
                : dialogMode === 'add'
                  ? t('newEdit.create')
                  : t('newEdit.save')
            }}</button
          >
        </div>
      </div>
    </template>
  </CreamDialog>

  <!-- 放弃未保存修改的二次确认（Esc/遮罩/关闭按钮/取消按钮/Android 返回键共用） -->
  <CreamDialog
    v-model="discardVisible"
    :title="t('newCommon.discardTitle')"
    width="380px"
    :close-on-overlay="false"
  >
    <p class="ed-discard-msg">{{ t('newCommon.discardMsg') }}</p>
    <template #footer>
      <button type="button" class="ed-btn ed-btn-cancel" @click="resolveDiscard(false)">{{
        t('newCommon.cancel')
      }}</button>
      <button type="button" class="ed-btn ed-btn-danger" @click="resolveDiscard(true)">{{
        t('newCommon.discardConfirm')
      }}</button>
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
import { ref, watch, computed, onMounted, onBeforeUnmount, onUnmounted, useId, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { CodeEditor } from '@/components/CodeEditor'
import * as toml from 'smol-toml'
import { normalizeToml } from '@/utils/easyTierUtil'
import { validateToml } from '@/utils/tomlValidationUtil'
import { migrateLightTierConfig } from '@/utils/lighttierConfigUtil'
import { isValidConfigName } from '@/utils/configNameUtil'
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
  ADVANCED_TOP_SWITCH_DEFS,
  ADVANCED_TOP_TEXT_DEFS,
  type AdvancedFieldDef
} from '@/constants/defaultData'
import { useEasyTierStore } from '@/store/modules/easytier'
import {
  checkConfigCompat,
  collectUnsupportedConfigEntries,
  compareCoreVersion,
  isCoreFeatureSupported,
  isCoreFlagSupported
} from '@/utils/kernelCompatUtil'
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'

const { t } = useI18n()
const store = useEasyTierStore()

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
  // done 由父组件在写盘结束后回调：true 关闭弹窗，false 保留内容与弹窗
  saved: [name: string, content: string, done: (ok: boolean) => void]
}>()

const dialogRef = ref<InstanceType<typeof CreamDialog> | null>(null)

// 表单字段 id 前缀：label for 与控件的可访问名称一一对应
const uid = useId()
const fieldId = (key: string) => `ed-${uid}-${key}`
const codeTabRef = ref<HTMLButtonElement | null>(null)
const formTabRef = ref<HTMLButtonElement | null>(null)

const visible = ref(props.modelValue)
// 弹窗打开时重置内部状态（配置名 / 校验错误 / 模板选择 / 脏检查基线）
watch(
  () => props.modelValue,
  (v) => {
    visible.value = v
    if (v) {
      newConfigName.value = props.dialogMode === 'add' ? '' : props.configName
      nameError.value = ''
      templateId.value = 'custom'
      templateDropdownOpen.value = false
      codeIssue.value = ''
      saveError.value = ''
      tomlContent.value = props.tomlContent
      initialToml.value = props.tomlContent
      initialName.value = props.dialogMode === 'add' ? '' : props.configName
      formBaseline.value = ''
      // 默认表单模式：按传入 TOML 重新解析，避免沿用上一次打开留下的表单值；
      // 解析失败时 switchToForm 会回退代码模式并给出语法提示
      editMode.value = 'code'
      formParsedOk.value = false
      switchToForm()
    }
  }
)
watch(visible, (v) => {
  emit('update:modelValue', v)
  if (!v) closeTemplateDropdown()
})

const dialogMode = computed(() => props.dialogMode || 'edit')
const newConfigName = ref(props.configName || '')
const nameError = ref('')
// 编辑模式：code 代码直编 / form 结构化表单（默认表单模式）
const editMode = ref<'code' | 'form'>('form')
// 保存中标志：避免重复提交
const saving = ref(false)
// 代码语法问题（实时校验与保存前复核共用；空串表示无问题）
const codeIssue = ref('')
// 归一化/写盘结果错误提示
const saveError = ref('')
// 脏检查基线：打开时的名称/代码 + 进入表单模式时的表单快照
const initialToml = ref(props.tomlContent)
const initialName = ref(props.dialogMode === 'add' ? '' : props.configName)
const formBaseline = ref('')
// 代码区内容：外部传入的 TOML 原文，编辑期间以本地副本为准
const tomlContent = ref(props.tomlContent)
watch(
  () => props.tomlContent,
  (v) => {
    tomlContent.value = v
  }
)

// ===== TOML 实时校验（300ms 防抖）=====
let codeCheckTimer: ReturnType<typeof setTimeout> | null = null
const runCodeValidation = () => {
  const result = validateToml(tomlContent.value)
  codeIssue.value = result.ok
    ? ''
    : t('newEdit.codeInvalid', {
        line: result.error.line,
        column: result.error.column
      })
}
const scheduleCodeValidation = () => {
  if (codeCheckTimer) clearTimeout(codeCheckTimer)
  codeCheckTimer = setTimeout(() => {
    codeCheckTimer = null
    runCodeValidation()
  }, 300)
}
watch(tomlContent, () => {
  if (editMode.value !== 'code') return
  saveError.value = ''
  scheduleCodeValidation()
})
onUnmounted(() => {
  if (codeCheckTimer) clearTimeout(codeCheckTimer)
})

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
// 表单未建模的顶层键/表（vpn_portal_config、[lighttier] 等），保存时原样透传
const formPassthrough = ref<Record<string, any>>({})
// 当前内核不支持/已移除的配置项：只读展示，构建 TOML 时最后原样写回（表单无法修改）
const formLockedFlags = ref<Record<string, any>>({})
const formLockedTop = ref<Record<string, any>>({})

// 5.6：安全模式开关（表单最底部；开启后才渲染安全字段并写入 [secure_mode] 表）
const secureModeEnabled = ref(false)
// 5.6：安全字段掩码回显（真实值备份在 secretBackup，保存时写回）
const secretDisplays = ref<Record<string, string>>({})
const secretBackup = ref<Record<string, string>>({})
// 敏感字段显隐切换（默认使用 password 类型显示，点击“显示”后明文）
const secretVisible = ref<Record<string, boolean>>({})
// stun_servers 为数组，表单以逗号分隔文本展示
const formStunServers = ref('')

const formListeners = ref<string[]>([])
const formPeers = ref<string[]>([])
// 与 formPeers 索引对齐：保留 peer_public_key 等表单未建模字段
const formPeerExtras = ref<Record<string, any>[]>([])
const formRoutes = ref<string[]>([])
const formExitNodes = ref<string[]>([])
const formFlagsKeys = ref<string[]>([])
const formFlagsVals = ref<string[]>([])

const formDataNetworkName = ref('')
const formDataNetworkSecret = ref('')

// ===== 未保存修改检测 =====
// 表单模式以内容快照比较（避免逐事件接线）；代码模式直接比较原文；名称变化同样视为修改
const formSignature = (): string =>
  JSON.stringify({
    formData: formData.value,
    secureMode: secureModeEnabled.value,
    stun: formStunServers.value,
    listeners: formListeners.value,
    peers: formPeers.value,
    peerExtras: formPeerExtras.value,
    routes: formRoutes.value,
    exitNodes: formExitNodes.value,
    flagKeys: formFlagsKeys.value,
    flagVals: formFlagsVals.value,
    networkName: formDataNetworkName.value,
    networkSecret: formDataNetworkSecret.value,
    secretDisplays: secretDisplays.value
  })

const dirty = computed(() => {
  if (!visible.value) return false
  if (newConfigName.value !== initialName.value) return true
  if (editMode.value === 'form' && formParsedOk.value) {
    return formSignature() !== formBaseline.value
  }
  return tomlContent.value !== initialToml.value
})

// 放弃确认：Promise 供 CreamDialog before-close 与 Android 路由守卫共同等待
const discardVisible = ref(false)
let discardResolve: ((ok: boolean) => void) | null = null
const resolveDiscard = (ok: boolean) => {
  const resolve = discardResolve
  discardResolve = null
  discardVisible.value = false
  if (!ok) return resolve?.(false)
  // 用户明确放弃修改：重置基线，避免关闭动画/路由跳转再次触发提示
  initialToml.value = tomlContent.value
  initialName.value = newConfigName.value
  formBaseline.value = formSignature()
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
// 放弃确认框被 Esc/遮罩/返回键关闭时视为取消
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
  // 写盘期间不允许关闭，避免内容与结果状态错位
  if (saving.value) return false
  return confirmDiscard()
}

defineExpose({
  isDirty: () => dirty.value,
  confirmDiscard,
  requestClose: () => dialogRef.value?.requestClose()
})

// TOML 原文 → 表单模型：解析失败时保留空表单（用户切到表单模式不报错）
// @returns 是否解析成功（供代码/表单双向切换判断能否安全回写）
// 注：以当前代码区内容（tomlContent）为准而非 props 原文，保证代码区编辑/模板应用后表单同步
const parseFormData = (): boolean => {
  const model = parseConfigFormModel(tomlContent.value)
  if (!model) return false
  formLockedFlags.value = {}
  formLockedTop.value = {}
  try {
    // 以原文为准收集当前内核不支持的配置项：从可编辑表单剔除，改为只读展示 + 原样写回
    const raw = toml.parse(tomlContent.value) as Record<string, any>
    migrateLightTierConfig(raw)
    const locked = collectUnsupportedConfigEntries(raw, store.coreCaps)
    formLockedFlags.value = locked.flags
    formLockedTop.value = locked.topLevel
    const lockedFlagKeys = new Set(Object.keys(locked.flags))
    if (lockedFlagKeys.size) {
      if (model.formData.flags) {
        lockedFlagKeys.forEach((key) => delete model.formData.flags[key])
      }
      const keptIndexes = model.flagsKeys
        .map((_, i) => i)
        .filter((i) => !lockedFlagKeys.has(model.flagsKeys[i]))
      model.flagsKeys = keptIndexes.map((i) => model.flagsKeys[i])
      model.flagsVals = keptIndexes.map((i) => model.flagsVals[i])
    }
    const lockedTopKeys = new Set(Object.keys(locked.topLevel))
    if (lockedTopKeys.size) {
      lockedTopKeys.forEach((key) => {
        delete model.formData[key]
        delete model.passthrough[key]
      })
      // 安全模式表不可用时整段隐藏，避免编辑了写入时又被锁定值覆盖
      if (lockedTopKeys.has('secure_mode') || lockedTopKeys.has('credential_file')) {
        model.secureModeEnabled = false
        delete model.secretDisplays.local_private_key
        delete model.secretBackup.local_private_key
        delete model.formData.local_public_key
      }
    }
  } catch {
    /* parseConfigFormModel 已成功解析，忽略重复解析异常 */
  }
  formData.value = { ...model.formData } as FormData
  formPassthrough.value = { ...model.passthrough }
  secureModeEnabled.value = model.secureModeEnabled
  secretDisplays.value = model.secretDisplays
  secretBackup.value = model.secretBackup
  formStunServers.value = model.stunServers
  formListeners.value = [...model.listeners]
  formPeers.value = [...model.peers]
  formPeerExtras.value = model.peerExtras.map((e) => ({ ...e }))
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
  passthrough: formPassthrough.value,
  secretDisplays: secretDisplays.value,
  secretBackup: secretBackup.value,
  secureModeEnabled: secureModeEnabled.value,
  stunServers: formStunServers.value,
  listeners: formListeners.value,
  peers: formPeers.value,
  peerExtras: formPeerExtras.value,
  routes: formRoutes.value,
  exitNodes: formExitNodes.value,
  flagsKeys: formFlagsKeys.value,
  flagsVals: formFlagsVals.value,
  networkName: formDataNetworkName.value,
  networkSecret: formDataNetworkSecret.value,
  lockedFlags: formLockedFlags.value,
  lockedTopLevel: formLockedTop.value
})

// 表单模型 → TOML 文本：空值剔除、安全字段按掩码规则写回、flags 类型推断（bool/number/string）
// assignBackup=false 供兼容性预览等只读场景使用，避免计算属性写入状态
const buildFormToml = (assignBackup = true): string => {
  const { toml: content, secretBackup: backup } = buildConfigFormModel(collectFormModel())
  if (assignBackup) secretBackup.value = backup
  return content
}

// ===== 内核版本适配 =====
const isAddMode = computed(() => dialogMode.value === 'add')

// 当前内核不支持的字段一律不渲染可编辑控件：
// 新建时隐藏；编辑时若配置文件中存在，则归入底部只读“当前内核未兼容”栏
const lockedTopKeys = computed(() => new Set(Object.keys(formLockedTop.value)))
const supportsDef = (f: AdvancedFieldDef): boolean =>
  (!f.feature || isCoreFeatureSupported(f.feature, store.coreCaps)) &&
  !lockedTopKeys.value.has(f.key)

const visibleAdvancedFlagDefs = computed(() =>
  ADVANCED_FLAG_DEFS.filter((f) => isCoreFlagSupported(f.key, store.coreCaps))
)
const visibleTopSwitchDefs = computed(() => ADVANCED_TOP_SWITCH_DEFS.filter(supportsDef))
const visibleTopTextDefs = computed(() => ADVANCED_TOP_TEXT_DEFS.filter(supportsDef))
const visibleSecurityFieldDefs = computed(() =>
  SECURITY_FIELD_DEFS.filter((f) => !lockedTopKeys.value.has(f.key))
)
const securitySectionVisible = computed(
  () =>
    isCoreFeatureSupported('secureMode', store.coreCaps) && !lockedTopKeys.value.has('secure_mode')
)

// 未兼容配置项只读展示（flags 加前缀区分顶层字段）
const formatLockedValue = (value: unknown): string => {
  if (typeof value === 'string') return value || '""'
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
const lockedEntries = computed(() => [
  ...Object.entries(formLockedFlags.value).map(([key, value]) => ({
    key: `flags.${key}`,
    value: formatLockedValue(value)
  })),
  ...Object.entries(formLockedTop.value).map(([key, value]) => ({
    key,
    value: formatLockedValue(value)
  }))
])
// rpc_portal 自 v2.5.0 起不再从配置文件读取（需改走 CLI --rpc-portal）
const rpcPortalSupported = computed(
  () => !store.detectedCoreVersion || compareCoreVersion(store.detectedCoreVersion, 'v2.5.0') < 0
)
const showRpcPortal = computed(() => !isAddMode.value || rpcPortalSupported.value)
const unsupportedTitle = (key: string) =>
  t('newEdit.fieldUnsupported', {
    version: store.detectedCoreVersion || t('newSettings.notInstalled'),
    field: key
  })

// 兼容性提示：代码模式直接解析原文；表单模式先构建再解析（只读，不写 secretBackup）
const compatIssues = computed(() => {
  try {
    const raw = editMode.value === 'form' ? buildFormToml(false) : tomlContent.value
    const parsed = toml.parse(raw) as Record<string, any>
    migrateLightTierConfig(parsed)
    return checkConfigCompat(parsed, store.detectedCoreVersion)
  } catch {
    return []
  }
})
const hasCompatError = computed(() => compatIssues.value.some((i) => i.level === 'error'))

// 删除某行自定义 Flag（key/value 同步移除，保持两数组索引对齐）
const removeFlag = (i: number) => {
  formFlagsKeys.value.splice(i, 1)
  formFlagsVals.value.splice(i, 1)
}

// 对等节点：URI 与额外字段（peer_public_key 等）同步增删，保持索引对齐
const addPeer = () => {
  formPeers.value.push('')
  formPeerExtras.value.push({})
}
const removePeer = (i: number) => {
  formPeers.value.splice(i, 1)
  formPeerExtras.value.splice(i, 1)
}

// === 5.6 高级字段交互 ===
// 缺省未写时按内核默认值显示（如 bind_device 默认开启）；
// 切回默认值时删除该键，保持配置文件简洁
const isAdvancedFlagOn = (f: AdvancedFieldDef): boolean => {
  const value = formData.value.flags?.[f.key]
  if (value === undefined || value === null) return f.defaultValue === true
  return value === true
}

const toggleAdvancedFlag = (f: AdvancedFieldDef) => {
  if (!formData.value.flags) formData.value.flags = {}
  const flags = formData.value.flags
  const next = !isAdvancedFlagOn(f)
  if (next === (f.defaultValue === true)) delete flags[f.key]
  else flags[f.key] = next
}

// 顶层布尔字段（如 ipv6_public_addr_provider）：false 时不落盘
const toggleTopSwitch = (key: string) => {
  formData.value[key] = formData.value[key] !== true
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
// formParsedOk 记录解析是否成功；解析失败不进入表单，避免空表单覆盖原文件
const formParsedOk = ref(false)
const switchToForm = () => {
  if (editMode.value === 'form') return
  const ok = parseFormData()
  formParsedOk.value = ok
  if (!ok) {
    const result = validateToml(tomlContent.value)
    codeIssue.value = result.ok
      ? t('newEdit.formParseFailed')
      : t('newEdit.codeInvalid', {
          line: result.error.line,
          column: result.error.column
        })
    return
  }
  codeIssue.value = ''
  saveError.value = ''
  // 进入表单时记录基线：切回代码时仅在有实际修改时回写，避免无意义的格式变化
  formBaseline.value = formSignature()
  editMode.value = 'form'
}

// 切到代码模式：先把表单改动回写到代码区，避免“表单改完切代码再保存”路径丢失修改
const switchToCode = () => {
  if (editMode.value === 'form' && formParsedOk.value && formSignature() !== formBaseline.value) {
    tomlContent.value = buildFormToml()
  }
  editMode.value = 'code'
  runCodeValidation()
}

// 编辑模式 tab 键盘操作：左右方向键切换，Home/End 定位首尾
const handleEditTabKeydown = (e: KeyboardEvent) => {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(e.key)) return
  e.preventDefault()
  if (e.key === 'ArrowLeft' || e.key === 'Home') switchToCode()
  else switchToForm()
  nextTick(() => {
    ;(editMode.value === 'code' ? codeTabRef.value : formTabRef.value)?.focus()
  })
}

// === 配置模板（5.8） ===
type TemplateId = 'server' | 'client' | 'custom'
const templateId = ref<TemplateId>('custom')
const currentTemplate = computed(
  () => CONFIG_TEMPLATES.find((tpl) => tpl.id === templateId.value) ?? CONFIG_TEMPLATES[0]
)

// 模板接管的字段：切换模板时先清空再合并，保留主机名 / 网络身份 / Peer 等已填内容
const TEMPLATE_TOP_LEVEL_KEYS = new Set(
  CONFIG_TEMPLATES.flatMap((tpl) => Object.keys(tpl.values).filter((key) => key !== 'flags'))
)
const TEMPLATE_FLAG_KEYS = new Set(
  CONFIG_TEMPLATES.flatMap((tpl) => Object.keys(tpl.values.flags ?? {}))
)

const templateTriggerRef = ref<HTMLButtonElement | null>(null)
const templateMenuRef = ref<HTMLElement | null>(null)
const templateDropdownOpen = ref(false)
const templateHighlighted = ref(0)
const templateMenuStyle = ref<Record<string, string>>({})

// 弹层 Teleport 到 body，用 fixed 坐标贴合触发器；空间不足时向上展开
const positionTemplateMenu = () => {
  const trigger = templateTriggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const menuHeight = templateMenuRef.value?.offsetHeight || CONFIG_TEMPLATES.length * 54 + 8
  // WebView 在极端情况下可能报告 0 视口，回退到触发器尺寸避免负数宽度
  const viewportWidth = window.innerWidth || rect.width + 16
  const viewportHeight = window.innerHeight || rect.bottom + menuHeight + 8
  const openUp = viewportHeight - rect.bottom < menuHeight + 8 && rect.top > menuHeight + 8
  const width = Math.min(Math.max(rect.width, 260), viewportWidth - 16)
  templateMenuStyle.value = {
    left: `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`,
    width: `${width}px`,
    ...(openUp ? { bottom: `${viewportHeight - rect.top + 4}px` } : { top: `${rect.bottom + 4}px` })
  }
}

const focusTemplateOption = (idx: number) => {
  const options = templateMenuRef.value?.querySelectorAll<HTMLElement>('[role="option"]')
  if (!options?.length) return
  const next = ((idx % options.length) + options.length) % options.length
  templateHighlighted.value = next
  options[next].focus()
}

const openTemplateDropdown = async (direction = 0) => {
  templateDropdownOpen.value = true
  const selectedIdx = Math.max(
    0,
    CONFIG_TEMPLATES.findIndex((tpl) => tpl.id === templateId.value)
  )
  templateHighlighted.value =
    direction === 0
      ? selectedIdx
      : (selectedIdx + direction + CONFIG_TEMPLATES.length) % CONFIG_TEMPLATES.length
  await nextTick()
  positionTemplateMenu()
  focusTemplateOption(templateHighlighted.value)
}

const closeTemplateDropdown = (restoreFocus = false) => {
  if (!templateDropdownOpen.value) return
  templateDropdownOpen.value = false
  if (restoreFocus) nextTick(() => templateTriggerRef.value?.focus())
}

const toggleTemplateDropdown = () => {
  if (templateDropdownOpen.value) closeTemplateDropdown()
  else void openTemplateDropdown()
}

const handleTemplateOutsideClick = (e: MouseEvent) => {
  if (!templateDropdownOpen.value) return
  const target = e.target as Node
  if (templateTriggerRef.value?.contains(target) || templateMenuRef.value?.contains(target)) return
  closeTemplateDropdown()
}

// 内容区滚动或窗口尺寸变化时关闭，避免弹层与触发器分离
const handleTemplateViewportChange = () => closeTemplateDropdown()

onMounted(() => {
  document.addEventListener('click', handleTemplateOutsideClick)
  window.addEventListener('resize', handleTemplateViewportChange)
  window.addEventListener('scroll', handleTemplateViewportChange, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleTemplateOutsideClick)
  window.removeEventListener('resize', handleTemplateViewportChange)
  window.removeEventListener('scroll', handleTemplateViewportChange, true)
})

// 应用模板：只替换模板接管的字段，保留用户已填写的主机名 / 网络身份 / Peer 等
const applyTemplate = (id: TemplateId) => {
  const tpl = CONFIG_TEMPLATES.find((item) => item.id === id)
  if (!tpl) return
  templateId.value = id
  // 以当前内容为底：表单模式先收集表单改动，避免模板覆盖尚未回写的输入
  let base: Record<string, any> = {}
  try {
    const current =
      editMode.value === 'form' && formParsedOk.value ? buildFormToml() : tomlContent.value
    if (current.trim()) base = toml.parse(current) as Record<string, any>
  } catch {
    base = {}
  }
  // 清空上一个模板接管的字段，再合并新模板值
  TEMPLATE_TOP_LEVEL_KEYS.forEach((key) => delete base[key])
  const flags =
    base.flags && typeof base.flags === 'object' && !Array.isArray(base.flags)
      ? { ...base.flags }
      : {}
  TEMPLATE_FLAG_KEYS.forEach((key) => delete flags[key])
  Object.entries(tpl.values).forEach(([key, value]) => {
    if (key === 'flags' && value && typeof value === 'object') Object.assign(flags, value)
    else base[key] = value
  })
  if (Object.keys(flags).length) base.flags = flags
  else delete base.flags
  tomlContent.value = Object.keys(base).length ? toml.stringify(base) : ''
  if (editMode.value === 'form') {
    formParsedOk.value = parseFormData()
  }
  codeIssue.value = ''
  saveError.value = ''
}

const selectTemplate = (id: TemplateId) => {
  applyTemplate(id)
  closeTemplateDropdown(true)
}

// 校验配置名：非空、仅字母数字下划线连字符、新增时不得与现有配置重名
const validateName = (): boolean => {
  newConfigName.value = newConfigName.value.trim()
  if (!newConfigName.value) {
    nameError.value = t('newEdit.nameEmpty')
    return false
  }
  if (!isValidConfigName(newConfigName.value)) {
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

// 保存：按当前模式取内容 → 语法校验 → normalizeToml 清洗 → 等待父组件写盘结果后再关闭
const handleSave = async () => {
  if (saving.value) return
  saveError.value = ''
  if (editMode.value === 'code') {
    const check = validateToml(tomlContent.value)
    if (!check.ok) {
      codeIssue.value = t('newEdit.codeInvalid', {
        line: check.error.line,
        column: check.error.column
      })
      return
    }
    codeIssue.value = ''
  } else if (!formParsedOk.value) {
    codeIssue.value = t('newEdit.formParseFailed')
    return
  }
  if (dialogMode.value === 'add' && !validateName()) return

  const rawContent = editMode.value === 'code' ? tomlContent.value : buildFormToml()
  // 表单构建结果再校验一次：任何非法 TOML 都不得进入写盘流程
  const check = validateToml(rawContent)
  if (!check.ok) {
    codeIssue.value = t('newEdit.codeInvalid', {
      line: check.error.line,
      column: check.error.column
    })
    return
  }

  saving.value = true
  try {
    let content = rawContent
    try {
      // 5.7：保存前统一清洗（默认值合并 + 空值剔除），双模式均不落空参数
      const parsed = toml.parse(rawContent) as Record<string, any>
      // 旧版 LightTier 私有标记迁移到 [lighttier]，保存后不再污染 [flags]
      migrateLightTierConfig(parsed)
      const normalized = normalizeToml(parsed, { mergeDefaults: false })
      if (editMode.value === 'form') {
        // 未兼容配置项在清洗后再写回一次：防止空值清洗等步骤改动其原值
        if (Object.keys(formLockedFlags.value).length) {
          const flags =
            normalized.flags && typeof normalized.flags === 'object' ? normalized.flags : {}
          normalized.flags = { ...flags, ...formLockedFlags.value }
        }
        Object.assign(normalized, formLockedTop.value)
      }
      content = toml.stringify(normalized)
    } catch {
      // 归一化失败：不写坏原文件，保留用户输入
      saveError.value = t('newCommon.saveFail')
      return
    }

    const name = dialogMode.value === 'add' ? newConfigName.value : props.configName
    const ok = await new Promise<boolean>((resolve) => {
      emit('saved', name, content, resolve)
    })
    if (!ok) return
    // 写盘成功才重置基线并关闭；失败时保留弹窗与内容
    initialToml.value = tomlContent.value
    initialName.value = newConfigName.value
    formParsedOk.value = true
    formBaseline.value = formSignature()
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
    // 表单模式下同步重解析，避免表单仍显示旧值并在保存时覆盖导入内容
    if (editMode.value === 'form') {
      formParsedOk.value = parseFormData()
      if (formParsedOk.value) codeIssue.value = ''
    }
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
  font-size: 12px;
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
  transition: var(--theme-transition-interactive);
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.ed-import-btn:hover {
  color: var(--theme-accent-primary, #e8a0a0);
  border-color: var(--theme-accent-primary, #e8a0a0);
  border-style: solid;
}

/* 模板下拉：触发器沿用胶囊边框，菜单 Teleport 到 body 避免被弹窗裁剪 */
.ed-template-select {
  position: relative;
  flex-shrink: 0;
}

.ed-template-trigger {
  display: flex;
  height: 29px;
  padding: 0 10px 0 12px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition:
    color var(--theme-duration-fast) var(--theme-ease-out),
    border-color var(--theme-duration) var(--theme-ease-out);
  align-items: center;
  gap: 6px;
}

.ed-template-trigger:hover,
.ed-template-trigger:focus-visible,
.ed-template-trigger[aria-expanded='true'] {
  color: var(--theme-text-primary, #4a3728);
  border-color: var(--theme-accent-primary, #e8a0a0);
  outline: none;
}

.ed-template-caret {
  color: var(--theme-text-muted, #c8bdb2);
  transition: transform var(--theme-duration-fast) var(--theme-ease-out);
  flex-shrink: 0;
}

.ed-template-trigger[aria-expanded='true'] .ed-template-caret {
  transform: rotate(180deg);
}

.ed-template-menu {
  position: fixed;
  z-index: 2100;
  display: flex;
  max-height: 300px;
  padding: 4px;
  overflow-y: auto;
  background: var(--theme-bg-card, #fff);
  border: 1px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-md, 12px);
  box-shadow: var(--theme-shadow-md);
  box-sizing: border-box;
  flex-direction: column;
  gap: 2px;
  overscroll-behavior: contain;
}

.ed-template-option {
  display: flex;
  width: 100%;
  padding: 8px 10px;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-sm, 6px);
  transition: background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  gap: 8px;
}

.ed-template-option:hover,
.ed-template-option:focus-visible {
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  outline: none;
}

.ed-template-option.active {
  background: var(--theme-bg-active, rgb(232 160 160 / 10%));
}

.ed-template-option-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.ed-template-option-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--theme-text-primary, #4a3728);
}

.ed-template-option.active .ed-template-option-label {
  color: var(--theme-accent-primary, #e8a0a0);
}

.ed-template-option-desc {
  font-size: 11px;
  line-height: 1.45;
  color: var(--theme-text-muted, #c8bdb2);
  white-space: normal;
}

.ed-template-check {
  color: var(--theme-accent-primary, #e8a0a0);
  flex-shrink: 0;
}

.ed-template-drop-enter-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-out),
    transform var(--theme-duration-fast) var(--theme-ease-out);
}

.ed-template-drop-leave-active {
  transition:
    opacity var(--theme-duration-fast) var(--theme-ease-in),
    transform var(--theme-duration-fast) var(--theme-ease-in);
}

.ed-template-drop-enter-from,
.ed-template-drop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.ed-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  align-items: center;
  flex-wrap: wrap;
}

.ed-core-target {
  padding: 3px 10px;
  margin-left: auto;
  font-family: var(--theme-font-body, 'Sora', monospace);
  font-size: 11px;
  color: var(--theme-text-muted, #c8bdb2);
  background: var(--theme-bg-hover, rgb(232 160 160 / 6%));
  border-radius: var(--theme-radius-pill, 100px);
}

/* 版本兼容提示：error 阻断启动，warning 仅提示字段会被忽略 */
.ed-compat-banner {
  padding: 10px 12px;
  margin-bottom: 14px;
  font-size: 12px;
  line-height: 1.6;
  border: 1px solid transparent;
  border-radius: var(--theme-radius-md, 10px);
}

.ed-compat-banner.is-error {
  color: var(--theme-accent-primary, #b4544f);
  background: color-mix(in srgb, var(--theme-accent-primary, #b4544f) 8%, transparent);
  border-color: color-mix(in srgb, var(--theme-accent-primary, #b4544f) 25%, transparent);
}

.ed-compat-banner.is-warning {
  color: var(--theme-text-secondary, #8b7355);
  background: color-mix(in srgb, var(--theme-color-warning, #d9a441) 8%, transparent);
  border-color: color-mix(in srgb, var(--theme-color-warning, #d9a441) 22%, transparent);
}

.ed-compat-title {
  margin-bottom: 4px;
  font-weight: 600;
}

.ed-compat-list {
  padding-left: 18px;
  margin: 0;
}

.ed-compat-note {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
}

.ed-field-warn {
  margin-left: 4px;
  color: var(--theme-color-warning, #d9a441);
  cursor: help;
}

.ed-field-unsupported .ed-form-label {
  color: var(--theme-color-warning, #d9a441);
}

.ed-input-unsupported {
  border-color: color-mix(in srgb, var(--theme-color-warning, #d9a441) 45%, transparent);
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
  transition: var(--theme-transition-interactive);
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

.ed-code-error {
  padding: 8px 12px;
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-accent-primary, #e8a0a0);
  background: var(--theme-bg-tag, rgb(232 160 160 / 6%));
  border: 1px solid var(--theme-accent-primary, #e8a0a0);
  border-radius: var(--theme-radius-sm, 10px);
}

.ed-discard-msg {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--theme-text-secondary, #7a6e5e);
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
  font-size: 12px;
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
  transition: border-color var(--theme-duration) var(--theme-ease-out);
}

.ed-form-input:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.ed-form-switch-wrap {
  padding: 4px 0;
}

.ed-form-switch {
  display: inline-flex;
  padding: 4px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: color-mix(in srgb, var(--theme-text-muted, #c8bdb2) 10%, transparent);
  border-radius: var(--theme-radius-pill, 100px);
  transition: var(--theme-transition-interactive);
  align-items: center;
}

/* 隐藏的原生 checkbox 键盘聚焦时给整个开关画焦点环 */
.ed-form-switch:focus-within {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
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
  width: 32px;
  height: 32px;
  font-size: 12px;
  color: var(--theme-text-muted, #c8bdb2);
  cursor: pointer;
  background: none;
  border: none;
  border-radius: 50%;
  transition: var(--theme-transition-interactive);
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
  transition: var(--theme-transition-interactive);
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

/* 当前内核未兼容：表单最后方，默认收起，只读展示 */
.ed-locked-collapse {
  padding: 10px 12px;
  background: color-mix(in srgb, var(--theme-color-warning, #d9a441) 5%, transparent);
  border: 1px dashed color-mix(in srgb, var(--theme-color-warning, #d9a441) 35%, transparent);
  border-radius: var(--theme-radius-md, 10px);
}

.ed-locked-collapse .ed-form-section-title {
  margin-bottom: 8px;
  color: var(--theme-color-warning, #d9a441);
  border-bottom-color: color-mix(in srgb, var(--theme-color-warning, #d9a441) 25%, transparent);
}

.ed-locked-hint {
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
}

.ed-locked-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ed-locked-row {
  display: flex;
  gap: 10px;
  padding: 5px 8px;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  background: color-mix(in srgb, var(--theme-bg-card, #fff) 55%, transparent);
  border-radius: var(--theme-radius-sm, 6px);
  align-items: baseline;
}

.ed-locked-key {
  color: var(--theme-color-warning, #d9a441);
  word-break: break-all;
  flex-shrink: 0;
}

.ed-locked-value {
  color: var(--theme-text-secondary, #7a6e5e);
  word-break: break-all;
}

/* 安全模式：表单最底部，开关常显、字段按需展开 */
.ed-secure-section {
  padding-top: 4px;
  border-top: 1px dashed var(--theme-border-light, #f5ede6);
}

.ed-secure-head {
  display: flex;
  gap: 12px;
  padding-bottom: 6px;
  margin-bottom: 10px;
  border-bottom: 1px solid var(--theme-border-light, #f5ede6);
  align-items: center;
  justify-content: space-between;
}

.ed-secure-title {
  font-family: var(--theme-font-display, 'Quicksand', sans-serif);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--theme-accent-primary, #e8a0a0);
}

.ed-form-field-wide {
  grid-column: 1 / -1;
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
  font-size: 12px;
  color: var(--theme-text-secondary, #7a6e5e);
  white-space: nowrap;
  cursor: pointer;
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: var(--theme-transition-interactive);
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
  transition: var(--theme-transition-interactive);
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

.ed-btn-danger {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-hover, #c9955f);
}

.ed-btn-danger:hover:not(:disabled) {
  background: var(--theme-accent-primary, #d4a574);
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
