<template>
  <div class="nm-section">
    <div class="nm-section-title">{{ t('newMonitor.nodeInfo') }}</div>
    <div class="nm-grid">
      <div class="nm-field"
        ><span class="nm-label">{{ t('newMonitor.hostname') }}</span
        ><span class="nm-val">{{ nodeInfo?.hostname || '—' }}</span></div
      >
      <div class="nm-field"
        ><span class="nm-label">{{ t('newMonitor.instanceName') }}</span
        ><span class="nm-val">{{ nodeInfo?._instance_name || nodeInfo?.inst_id || '—' }}</span></div
      >
      <div class="nm-field"
        ><span class="nm-label">IPv4</span
        ><span class="nm-val">{{ nodeInfo?.ipv4_addr || '—' }}</span></div
      >
      <div class="nm-field"
        ><span class="nm-label">{{ t('newCommon.version') }}</span
        ><span class="nm-val">{{ nodeInfo?.version || '—' }}</span></div
      >
      <div class="nm-field"
        ><span class="nm-label">{{ t('newMonitor.networkName') }}</span
        ><span class="nm-val">{{ nodeInfo?._network_name || '—' }}</span></div
      >
      <div class="nm-field"
        ><span class="nm-label">{{ t('newMonitor.natType') }}</span
        ><span class="nm-val">{{
          nodeInfo?.stun_info?._udp_nat_type || nodeInfo?.stun_info?.udp_nat_type || '—'
        }}</span></div
      >
      <div class="nm-field"
        ><span class="nm-label">DHCP</span
        ><span class="nm-val">{{
          nodeInfo?._dhcp ? t('newMonitor.dhcpOn') : t('newMonitor.dhcpOff')
        }}</span></div
      >
      <div class="nm-field"
        ><span class="nm-label">{{ t('newMonitor.exitNodes') }}</span
        ><span class="nm-val">{{
          (nodeInfo?._exit_nodes?.length || 0) > 0
            ? nodeInfo._exit_nodes.join(', ')
            : t('newMonitor.none')
        }}</span></div
      >
      <div class="nm-field"
        ><span class="nm-label">{{ t('newMonitor.portForward') }}</span
        ><span class="nm-val">{{
          (nodeInfo?._port_forward?.length || 0) > 0
            ? nodeInfo._port_forward.join(', ')
            : t('newMonitor.none')
        }}</span></div
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  nodeInfo: Record<string, any>
}>()

const { t } = useI18n()
</script>

<style scoped lang="less">
@import url('./styles/node.less');
</style>
