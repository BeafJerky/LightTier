<template>
  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.basicConfig') }}</div>
    <div class="ed-form-grid">
      <div class="ed-form-field">
        <label class="ed-form-label" :for="fieldId('hostname')">{{
          t('newConfig.hostname')
        }}</label>
        <LtInput
          v-model="formData.hostname"
          variant="outline"
          :aria-label="t('newConfig.hostname')"
          placeholder="hostname"
        />
      </div>
      <div class="ed-form-field">
        <label class="ed-form-label" :for="fieldId('instance_name')">{{
          t('newConfig.instanceName')
        }}</label>
        <LtInput
          v-model="formData.instance_name"
          variant="outline"
          :aria-label="t('newConfig.instanceName')"
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
        <LtInput
          v-model="formDataNetworkName"
          variant="outline"
          :aria-label="t('newConfig.networkName')"
          placeholder="network_name"
        />
      </div>
      <div class="ed-form-field">
        <label class="ed-form-label" :for="fieldId('network_secret')">{{
          t('newEdit.networkSecret')
        }}</label>
        <LtInput
          v-model="formDataNetworkSecret"
          variant="outline"
          :aria-label="t('newEdit.networkSecret')"
          placeholder="network_secret"
        />
      </div>
      <div class="ed-form-field ed-form-field--switch">
        <label class="ed-form-label" :for="fieldId('dhcp')">DHCP</label>
        <div class="ed-form-switch-wrap">
          <LtSwitch v-model="formData.dhcp" aria-label="DHCP" />
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
        <LtInput
          v-model="formData.rpc_portal"
          variant="outline"
          :class="{ 'ed-input-unsupported': !rpcPortalSupported }"
          :aria-label="t('newConfig.rpcPortal')"
          placeholder="0.0.0.0:15888"
        />
      </div>
    </div>
  </div>

  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.listenSection') }}</div>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formListeners" :key="'l' + i">
        <LtInput
          v-model="formListeners[i]"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.listenSection')} ${i + 1}`"
          placeholder="tcp://0.0.0.0:11000"
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.listenSection') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.listenSection') })"
          @click="formListeners.splice(i, 1)"
        >
          ✕
        </LtButton>
      </div>
      <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="formListeners.push('')">{{
        t('newEdit.addListen')
      }}</LtButton>
    </div>
  </div>

  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.peerSection') }}</div>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formPeers" :key="'p' + i">
        <LtInput
          v-model="formPeers[i]"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.peerSection')} ${i + 1}`"
          placeholder="tcp://host:port"
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.peerSection') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.peerSection') })"
          @click="removePeer(i)"
        >
          ✕
        </LtButton>
      </div>
      <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="addPeer">{{
        t('newEdit.addPeer')
      }}</LtButton>
    </div>
  </div>

  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.routeSection') }}</div>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formRoutes" :key="'rt' + i">
        <LtInput
          v-model="formRoutes[i]"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.routeSection')} ${i + 1}`"
          placeholder="10.0.0.0/8"
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.routeSection') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.routeSection') })"
          @click="formRoutes.splice(i, 1)"
        >
          ✕
        </LtButton>
      </div>
      <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="formRoutes.push('')">{{
        t('newEdit.addRoute')
      }}</LtButton>
    </div>
  </div>

  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.exitSection') }}</div>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formExitNodes" :key="'en' + i">
        <LtInput
          v-model="formExitNodes[i]"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.exitSection')} ${i + 1}`"
          placeholder="10.0.0.0/24"
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.exitSection') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.exitSection') })"
          @click="formExitNodes.splice(i, 1)"
        >
          ✕
        </LtButton>
      </div>
      <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="formExitNodes.push('')">{{
        t('newEdit.addExit')
      }}</LtButton>
    </div>
  </div>

  <div class="ed-form-section" v-if="formFlagsKeys.length">
    <div class="ed-form-section-title">{{ t('newEdit.flagsSection') }}</div>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formFlagsKeys" :key="'f' + i">
        <LtInput
          v-model="formFlagsKeys[i]"
          class="ed-tag-input-short"
          variant="outline"
          :aria-label="`${t('newEdit.flagsSection')} ${i + 1} key`"
          placeholder="key"
        />
        <LtInput
          v-model="formFlagsVals[i]"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.flagsSection')} ${i + 1} value`"
          placeholder="value"
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.flagsSection') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.flagsSection') })"
          @click="removeFlag(i)"
        >
          ✕
        </LtButton>
      </div>
      <LtButton
        variant="ghost"
        size="sm"
        class="ed-tag-add"
        @click="(formFlagsKeys.push(''), formFlagsVals.push(''))"
        >{{ t('newEdit.addFlag') }}</LtButton
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput, LtSwitch } from '@/shared/ui'
import { injectRequired } from '@/shared/lib/inject'
import { CONFIG_EDITOR_KEY } from './context'

defineOptions({ name: 'ConfigBasicForm' })

const { t } = useI18n()
const {
  fieldId,
  formData,
  formDataNetworkName,
  formDataNetworkSecret,
  showRpcPortal,
  rpcPortalSupported,
  unsupportedTitle,
  formListeners,
  formPeers,
  formRoutes,
  formExitNodes,
  formFlagsKeys,
  formFlagsVals,
  removePeer,
  addPeer,
  removeFlag
} = injectRequired(CONFIG_EDITOR_KEY, 'ConfigBasicForm')
</script>

<style scoped lang="less">
@import url('./form.less');
</style>
