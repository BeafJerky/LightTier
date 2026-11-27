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
        <div class="ed-secret-row">
          <LtInput
            v-model="formDataNetworkSecret"
            variant="outline"
            :aria-label="t('newEdit.networkSecret')"
            :type="networkSecretVisible ? 'text' : 'password'"
            placeholder="network_secret"
          />
          <LtButton
            variant="ghost"
            size="sm"
            :title="networkSecretVisible ? t('newEdit.hideSecret') : t('newEdit.showSecret')"
            :aria-label="networkSecretVisible ? t('newEdit.hideSecret') : t('newEdit.showSecret')"
            @click="networkSecretVisible = !networkSecretVisible"
            >{{
              networkSecretVisible ? t('newEdit.hideSecret') : t('newEdit.showSecret')
            }}</LtButton
          >
        </div>
      </div>
      <div class="ed-form-field">
        <label class="ed-form-label" :for="fieldId('ipv4')" :title="t('newEdit.tipIpv4')">{{
          t('newEdit.lblIpv4')
        }}</label>
        <LtInput
          v-model="formData.ipv4"
          variant="outline"
          :disabled="formData.dhcp === true"
          :aria-label="t('newEdit.lblIpv4')"
          placeholder="10.126.126.1"
        />
      </div>
      <div v-if="!dhcpLocked" class="ed-form-field ed-form-field--switch">
        <label class="ed-form-label" :for="fieldId('dhcp')">DHCP</label>
        <div class="ed-form-switch-wrap">
          <LtSwitch v-model="formData.dhcp" aria-label="DHCP" />
        </div>
      </div>
      <!-- v2.7.1：DHCP 网段写法（留空使用内核默认地址池） -->
      <div v-if="dhcpCidrSupported && formData.dhcp" class="ed-form-field">
        <label
          class="ed-form-label"
          :for="fieldId('dhcp_cidr')"
          :title="t('newEdit.tipDhcpCidr')"
          >{{ t('newEdit.lblDhcpCidr') }}</label
        >
        <LtInput
          v-model="formDhcpCidr"
          variant="outline"
          :aria-label="t('newEdit.lblDhcpCidr')"
          :aria-describedby="dhcpCidrIssue ? `${fieldId('dhcp_cidr')}-hint` : undefined"
          placeholder="10.0.0.0/24"
        />
        <p v-if="dhcpCidrIssue" :id="`${fieldId('dhcp_cidr')}-hint`" class="ed-form-hint">
          {{ t('newEdit.dhcpCidrInvalid') }}
        </p>
      </div>
      <!-- v2.7.1：DHCPv6（顶层 dhcpv6 字段） -->
      <div v-if="dhcpv6Supported" class="ed-form-field ed-form-field--switch">
        <label class="ed-form-label" :for="fieldId('dhcpv6')" :title="t('newEdit.tipDhcpv6')">{{
          t('newEdit.lblDhcpv6')
        }}</label>
        <div class="ed-form-switch-wrap">
          <LtSwitch v-model="formDhcpv6Enabled" :aria-label="t('newEdit.lblDhcpv6')" />
        </div>
      </div>
      <div v-if="dhcpv6Supported && formDhcpv6Enabled" class="ed-form-field">
        <label
          class="ed-form-label"
          :for="fieldId('dhcpv6_cidr')"
          :title="t('newEdit.tipDhcpv6Cidr')"
          >{{ t('newEdit.lblDhcpv6Cidr') }}</label
        >
        <LtInput
          v-model="formDhcpv6Cidr"
          variant="outline"
          :aria-label="t('newEdit.lblDhcpv6Cidr')"
          :aria-describedby="dhcpv6CidrIssue ? `${fieldId('dhcpv6_cidr')}-hint` : undefined"
          placeholder="fc00::/64"
        />
        <p v-if="dhcpv6CidrIssue" :id="`${fieldId('dhcpv6_cidr')}-hint`" class="ed-form-hint">
          {{ t('newEdit.dhcpv6CidrInvalid') }}
        </p>
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
    <p v-if="androidLocalKernel" class="ed-section-hint">
      {{ t('newEdit.androidListenUnsupported') }}
    </p>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formListeners" :key="'l' + i">
        <LtSelect
          class="ed-proto-select"
          :model-value="uriProto(formListeners[i])"
          :options="protocolOptionsFor(formListeners[i])"
          variant="outline"
          size="sm"
          :aria-label="`${t('newEdit.listenSection')} ${i + 1} ${t('newEdit.protocolLabel')}`"
          @update:model-value="formListeners[i] = joinUri($event, uriRest(formListeners[i]))"
        />
        <LtInput
          :model-value="uriRest(formListeners[i])"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.listenSection')} ${i + 1}`"
          placeholder="0.0.0.0:11000"
          @update:model-value="formListeners[i] = joinUri(uriProto(formListeners[i]), $event)"
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
      <LtButton
        variant="ghost"
        size="sm"
        class="ed-tag-add"
        :disabled="androidLocalKernel"
        @click="formListeners.push('')"
        >{{ t('newEdit.addListen') }}</LtButton
      >
    </div>
  </div>

  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.mappedSection') }}</div>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formMappedListeners" :key="'ml' + i">
        <LtSelect
          class="ed-proto-select"
          :model-value="uriProto(formMappedListeners[i])"
          :options="protocolOptionsFor(formMappedListeners[i])"
          variant="outline"
          size="sm"
          :aria-label="`${t('newEdit.mappedSection')} ${i + 1} ${t('newEdit.protocolLabel')}`"
          @update:model-value="
            formMappedListeners[i] = joinUri($event, uriRest(formMappedListeners[i]))
          "
        />
        <LtInput
          :model-value="uriRest(formMappedListeners[i])"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.mappedSection')} ${i + 1}`"
          placeholder="public.example.com:11010"
          @update:model-value="
            formMappedListeners[i] = joinUri(uriProto(formMappedListeners[i]), $event)
          "
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.mappedSection') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.mappedSection') })"
          @click="formMappedListeners.splice(i, 1)"
        >
          ✕
        </LtButton>
      </div>
      <LtButton
        variant="ghost"
        size="sm"
        class="ed-tag-add"
        @click="formMappedListeners.push('')"
        >{{ t('newEdit.addMapped') }}</LtButton
      >
    </div>
  </div>

  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.peerSection') }}</div>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formPeers" :key="'p' + i">
        <LtSelect
          class="ed-proto-select"
          :model-value="uriProto(formPeers[i])"
          :options="protocolOptionsFor(formPeers[i])"
          variant="outline"
          size="sm"
          :aria-label="`${t('newEdit.peerSection')} ${i + 1} ${t('newEdit.protocolLabel')}`"
          @update:model-value="formPeers[i] = joinUri($event, uriRest(formPeers[i]))"
        />
        <LtInput
          :model-value="uriRest(formPeers[i])"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.peerSection')} ${i + 1}`"
          placeholder="host:port"
          @update:model-value="formPeers[i] = joinUri(uriProto(formPeers[i]), $event)"
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
    <div class="ed-form-section-title">{{ t('newEdit.proxySection') }}</div>
    <p class="ed-section-hint">{{ t('newEdit.proxyHint') }}</p>
    <p v-if="proxyKernelUnsupported" class="ed-section-hint">
      {{ t('newEdit.proxyUnsupported') }}
    </p>
    <div class="ed-tag-list">
      <div class="ed-tag-row" v-for="(_, i) in formProxies" :key="'px' + i">
        <LtInput
          v-model="formProxies[i]"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.proxySection')} ${i + 1}`"
          :aria-describedby="proxyIssues[i] ? `${fieldId('proxy')}-hint` : undefined"
          placeholder="192.168.1.0/24 或 192.168.1.0/24->10.0.0.0/24"
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.proxySection') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.proxySection') })"
          @click="removeProxy(i)"
        >
          ✕
        </LtButton>
      </div>
      <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="addProxy">{{
        t('newEdit.addProxy')
      }}</LtButton>
      <p v-if="hasProxyIssue" :id="`${fieldId('proxy')}-hint`" class="ed-form-hint">
        {{ t('newEdit.proxyCidrInvalid') }}
      </p>
    </div>
  </div>

  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.routeSection') }}</div>
    <p class="ed-section-hint">{{ t('newEdit.routeHint') }}</p>
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

  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.portForwardSection') }}</div>
    <p class="ed-section-hint">{{ t('newEdit.portForwardHint') }}</p>
    <p v-if="androidLocalKernel" class="ed-section-hint">
      {{ t('newEdit.androidPortForwardUnsupported') }}
    </p>
    <div class="ed-tag-list">
      <div class="ed-tag-row ed-port-row" v-for="(row, i) in formPortForwards" :key="'pf' + i">
        <LtSelect
          class="ed-proto-select"
          :model-value="row.proto"
          :options="portForwardProtoOptions(row.proto)"
          variant="outline"
          size="sm"
          :aria-label="`${t('newEdit.portForwardProto')} ${i + 1}`"
          @update:model-value="row.proto = String($event)"
        />
        <LtInput
          v-model="row.bind_addr"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.portForwardBind')} ${i + 1}`"
          placeholder="0.0.0.0:12345"
        />
        <span class="ed-port-arrow" aria-hidden="true">→</span>
        <LtInput
          v-model="row.dst_addr"
          class="ed-tag-input"
          variant="outline"
          :aria-label="`${t('newEdit.portForwardDst')} ${i + 1}`"
          placeholder="10.126.126.1:23456"
        />
        <LtButton
          variant="text"
          size="md"
          circle
          :title="t('newEdit.removeItem', { label: t('newEdit.portForwardSection') })"
          :aria-label="t('newEdit.removeItem', { label: t('newEdit.portForwardSection') })"
          @click="formPortForwards.splice(i, 1)"
        >
          ✕
        </LtButton>
      </div>
      <LtButton
        variant="ghost"
        size="sm"
        class="ed-tag-add"
        :disabled="androidLocalKernel"
        @click="addPortForward"
        >{{ t('newEdit.addPortForward') }}</LtButton
      >
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
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput, LtSelect, LtSwitch } from '@/shared/ui'
import { injectRequired } from '@/shared/lib/inject'
import { joinTunnelUri, splitTunnelUri, TUNNEL_PROTOCOLS } from '@/features/configs/lib/tunnelUri'
import { validateDhcpCidr, validateDhcpv6Cidr, validateProxyCidr } from '@/entities/config/cidr'
import { isAndroid } from '@/shared/platform/platformUtil'
import { backendMode } from '@/shared/platform/backend'
import { CONFIG_EDITOR_KEY } from './context'

defineOptions({ name: 'ConfigBasicForm' })

const { t } = useI18n()
// 网络密钥默认掩码；显隐状态是纯 UI，不参与表单签名
const networkSecretVisible = ref(false)
const {
  fieldId,
  formData,
  formDataNetworkName,
  formDataNetworkSecret,
  formDhcpCidr,
  formDhcpv6Enabled,
  formDhcpv6Cidr,
  dhcpLocked,
  dhcpCidrSupported,
  dhcpv6Supported,
  showRpcPortal,
  rpcPortalSupported,
  unsupportedTitle,
  formListeners,
  formPeers,
  formProxies,
  formMappedListeners,
  formPortForwards,
  androidLocalKernel,
  formRoutes,
  formExitNodes,
  formFlagsKeys,
  formFlagsVals,
  removePeer,
  addPeer,
  removeProxy,
  addProxy,
  removeFlag
} = injectRequired(CONFIG_EDITOR_KEY, 'ConfigBasicForm')

const uriProto = (uri: string) => splitTunnelUri(uri).proto
const uriRest = (uri: string) => splitTunnelUri(uri).rest
const joinUri = (proto: string | number | null, rest: string) =>
  joinTunnelUri(String(proto ?? ''), rest)

const toOptions = (values: string[]) => values.map((value) => ({ label: value, value }))

// 当前行使用非常用协议时动态补一项，避免只改协议下拉就把原值改坏
const protocolOptionsFor = (uri: string) => {
  const protocols = [...TUNNEL_PROTOCOLS] as string[]
  const current = uriProto(uri)
  if (current && !protocols.includes(current)) protocols.push(current)
  return toOptions(protocols)
}

const portForwardProtoOptions = (current: string) => {
  const protocols = ['tcp', 'udp']
  if (current && !protocols.includes(current)) protocols.push(current)
  return toOptions(protocols)
}

const addPortForward = () =>
  formPortForwards.value.push({ proto: 'tcp', bind_addr: '', dst_addr: '' })

const dhcpCidrIssue = computed(() => validateDhcpCidr(formDhcpCidr.value))
const dhcpv6CidrIssue = computed(() => validateDhcpv6Cidr(formDhcpv6Cidr.value))
const proxyIssues = computed(() => formProxies.value.map((row) => validateProxyCidr(row)))
const hasProxyIssue = computed(() => proxyIssues.value.some(Boolean))
// 进程内内核（Android 本地运行）忽略 proxy_network；Android 连远程 agent 时配置仍生效
const proxyKernelUnsupported = computed(() => isAndroid() && backendMode() !== 'agent')
</script>

<style scoped lang="less">
@import url('./form.less');
</style>
