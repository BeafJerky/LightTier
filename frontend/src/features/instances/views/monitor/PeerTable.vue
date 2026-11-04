<template>
  <div class="nm-section">
    <div class="nm-section-title"
      >{{ t('newMonitor.peerSection') }}
      <span class="nm-section-count">({{ peers.length }})</span></div
    >
    <div class="nm-peer-grid">
      <div v-for="(peer, idx) in peers" :key="peer.id || idx" class="nm-peer-card">
        <div class="nmp-top">
          <span class="nmp-hostname">{{ peer.hostname || '—' }}</span>
          <span class="nmp-lat" :style="{ color: peer.delayColor }">{{
            formatMetric(peer.lat_ms, 'ms')
          }}</span>
        </div>
        <div class="nmp-detail">
          <div class="nmp-row"
            ><span class="nmp-key">IPv4</span
            ><span class="nmp-val">{{ peer.ipv4 || '—' }}</span></div
          >
          <div class="nmp-row"
            ><span class="nmp-key">{{ t('newMonitor.connection') }}</span
            ><span class="nmp-val">{{ peer.cost || '—' }}</span></div
          >
          <div class="nmp-row"
            ><span class="nmp-key">NAT</span
            ><span class="nmp-val">{{ peer.nat_type || '—' }}</span></div
          >
          <div class="nmp-row"
            ><span class="nmp-key">{{ t('newMonitor.protocol') }}</span
            ><span class="nmp-val">{{ peer.tunnel_proto || '—' }}</span></div
          >
          <div class="nmp-row"
            ><span class="nmp-key">{{ t('newMonitor.packetLoss') }}</span
            ><span
              class="nmp-val"
              :class="peer.loss_rate && parseFloat(peer.loss_rate) > 5 ? 'warn' : ''"
              >{{ formatMetric(peer.loss_rate, '%') }}</span
            ></div
          >
          <div class="nmp-row"
            ><span class="nmp-key">{{ t('newMonitor.upload') }}</span
            ><span class="nmp-val">{{ formatBytes(peer.tx_bytes) }}</span></div
          >
          <div class="nmp-row"
            ><span class="nmp-key">{{ t('newMonitor.download') }}</span
            ><span class="nmp-val">{{ formatBytes(peer.rx_bytes) }}</span></div
          >
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatBytes, formatMetric } from '@/shared/lib/monitorFormat'

defineProps<{
  peers: PeerInfo[]
}>()

const { t } = useI18n()
</script>

<style scoped lang="less">
@import url('./styles/peer.less');
</style>
