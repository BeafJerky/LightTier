<template>
  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.wireguardSection') }}</div>
    <div class="ed-form-field ed-form-field--switch">
      <label class="ed-form-label ed-label-preserve" :for="fieldId('vpn_portal_enabled')">{{
        t('newEdit.wireguardEnable')
      }}</label>
      <div class="ed-form-switch-wrap">
        <LtSwitch
          v-model="formVpnPortal.enabled"
          :disabled="androidLocalKernel && !formVpnPortal.enabled"
          :aria-label="t('newEdit.wireguardEnable')"
        />
      </div>
    </div>
    <p class="ed-section-hint">{{ t('newEdit.wireguardHint') }}</p>
    <p v-if="androidLocalKernel" class="ed-section-hint">
      {{ t('newEdit.androidWireguardUnsupported') }}
    </p>
    <p v-if="isLegacy && vpnPortalFormat === 'v2.7'" class="ed-section-hint">
      {{ t('newEdit.wireguardLegacyOnNew') }}
    </p>

    <div v-if="formVpnPortal.enabled" class="ed-form-grid">
      <div v-if="isLegacy" class="ed-form-field">
        <label class="ed-form-label" :for="fieldId('vpn_client_cidr')">{{
          t('newEdit.vpnClientCidr')
        }}</label>
        <LtInput
          v-model="formVpnPortal.legacyClientCidr"
          variant="outline"
          :aria-label="t('newEdit.vpnClientCidr')"
          placeholder="10.44.0.0/16"
        />
      </div>
      <div class="ed-form-field">
        <label class="ed-form-label ed-label-preserve" :for="fieldId('vpn_wireguard_listen')">{{
          t('newEdit.vpnWireguardListen')
        }}</label>
        <LtInput
          v-model="formVpnPortal.wireguardListen"
          variant="outline"
          :aria-label="t('newEdit.vpnWireguardListen')"
          placeholder="0.0.0.0:51820"
        />
      </div>
      <div v-if="!isLegacy" class="ed-form-field ed-form-field-wide">
        <label class="ed-form-label ed-label-preserve" :for="fieldId('vpn_private_key')">{{
          t('newEdit.vpnPrivateKey')
        }}</label>
        <div class="ed-secret-row">
          <LtInput
            v-model="formVpnPortal.privateKey"
            variant="outline"
            :aria-label="t('newEdit.vpnPrivateKey')"
            :type="privateKeyVisible ? 'text' : 'password'"
            placeholder="base64 private key"
          />
          <LtButton
            variant="ghost"
            size="sm"
            :title="privateKeyVisible ? t('newEdit.hideSecret') : t('newEdit.showSecret')"
            :aria-label="privateKeyVisible ? t('newEdit.hideSecret') : t('newEdit.showSecret')"
            @click="privateKeyVisible = !privateKeyVisible"
            >{{ privateKeyVisible ? t('newEdit.hideSecret') : t('newEdit.showSecret') }}</LtButton
          >
        </div>
      </div>
    </div>

    <div v-if="formVpnPortal.enabled && !isLegacy" class="ed-tag-list ed-vpn-clients">
      <div class="ed-form-label">{{ t('newEdit.vpnClients') }}</div>
      <div class="ed-tag-row" v-for="(client, i) in formVpnPortal.clients" :key="'vc' + i">
        <LtInput
          v-model="client.name"
          class="ed-tag-input-short"
          variant="outline"
          :aria-label="`${t('newEdit.vpnClientName')} ${i + 1}`"
          placeholder="name"
        />
        <LtInput
          v-model="client.virtual_ip"
          class="ed-tag-input-short"
          variant="outline"
          :aria-label="`${t('newEdit.vpnClientIp')} ${i + 1}`"
          placeholder="10.44.0.2/24"
        />
        <LtInput
          v-model="client.groups"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.vpnClientGroups')} ${i + 1}`"
          placeholder="groups"
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.vpnClients') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.vpnClients') })"
          @click="formVpnPortal.clients.splice(i, 1)"
        >
          ✕
        </LtButton>
      </div>
      <p v-if="clientIpIssue" class="ed-form-hint">{{ t('newEdit.vpnClientIpNeedsCidr') }}</p>
      <p v-if="undeclaredGroups.length" class="ed-form-hint">
        {{ t('newEdit.vpnClientGroupsUndeclared', { groups: undeclaredGroups.join(', ') }) }}
      </p>
      <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="addClient">{{
        t('newEdit.addVpnClient')
      }}</LtButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput, LtSwitch } from '@/shared/ui'
import { injectRequired } from '@/shared/lib/inject'
import { CONFIG_EDITOR_KEY } from './context'

defineOptions({ name: 'ConfigWireGuardForm' })

const { t } = useI18n()
const { fieldId, formVpnPortal, formAcl, vpnPortalFormat, androidLocalKernel } = injectRequired(
  CONFIG_EDITOR_KEY,
  'ConfigWireGuardForm'
)

const privateKeyVisible = ref(false)
const isLegacy = computed(() => formVpnPortal.value.legacy || vpnPortalFormat.value === 'legacy')
// 内核按 Ipv4Inet 校验：无前缀会被当作 /32，首末地址即自身而判为不可用
const clientIpIssue = computed(() =>
  formVpnPortal.value.clients.some(
    (client) => client.virtual_ip.trim() !== '' && !client.virtual_ip.includes('/')
  )
)
// 客户端 groups 必须能在 ACL 组里找到；否则内核拒绝创建实例
const undeclaredGroups = computed(() => {
  const declared = new Set(
    (formAcl.value.enabled ? formAcl.value.declares : [])
      .map((item) => item.groupName.trim())
      .filter(Boolean)
  )
  const used = new Set<string>()
  formVpnPortal.value.clients.forEach((client) => {
    client.groups
      .split(/[\s,]+/)
      .map((group) => group.trim())
      .filter(Boolean)
      .forEach((group) => used.add(group))
  })
  return [...used].filter((group) => !declared.has(group))
})

const addClient = () => formVpnPortal.value.clients.push({ name: '', virtual_ip: '', groups: '' })
</script>

<style scoped lang="less">
@import url('./form.less');

.ed-vpn-clients {
  margin-top: 10px;
}
</style>
