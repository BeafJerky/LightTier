<template>
  <!-- v2.7.1 Magic DNS：顶层 [dns] 表，按内核版本门控（旧内核由未兼容栏只读保留） -->
  <details v-if="dnsSupported" class="ed-adv-collapse ed-dns-section" open>
    <summary class="ed-form-section-title ed-adv-summary"
      >✦ {{ t('newEdit.magicDnsSection') }}</summary
    >
    <p class="ed-dns-hint">{{ t('newEdit.dnsTip') }}</p>

    <div class="ed-form-field">
      <label class="ed-form-label">{{ t('newEdit.dnsDomain') }}</label>
      <LtInput
        v-model="formDns.domain"
        variant="outline"
        :aria-label="t('newEdit.dnsDomain')"
        :placeholder="t('newEdit.dnsDomainPlaceholder')"
      />
    </div>

    <div v-for="(zone, zoneIndex) in formDns.zones" :key="zoneIndex" class="ed-dns-zone">
      <div class="ed-dns-zone-head">
        <div class="ed-form-field ed-dns-grow">
          <label class="ed-form-label">{{ t('newEdit.dnsOrigin') }}</label>
          <LtInput
            v-model="zone.origin"
            variant="outline"
            :aria-label="t('newEdit.dnsOrigin')"
            :placeholder="t('newEdit.dnsOriginPlaceholder')"
          />
        </div>
        <div class="ed-form-field ed-dns-ttl">
          <label class="ed-form-label">{{ t('newEdit.dnsTtl') }}</label>
          <LtInput
            v-model="zone.ttl"
            variant="outline"
            :aria-label="t('newEdit.dnsTtl')"
            placeholder="0"
          />
        </div>
        <LtButton
          variant="ghost"
          size="sm"
          :title="t('newEdit.dnsRemoveZone')"
          :aria-label="t('newEdit.dnsRemoveZone')"
          @click="removeZone(zoneIndex)"
          >✕</LtButton
        >
      </div>

      <div class="ed-dns-records">
        <div class="ed-dns-records-title">{{ t('newEdit.dnsRecords') }}</div>
        <div v-for="(record, recordIndex) in zone.records" :key="recordIndex" class="ed-dns-record">
          <LtInput
            v-model="record.name"
            variant="outline"
            :aria-label="t('newEdit.dnsRecordName')"
            :placeholder="t('newEdit.dnsRecordName')"
          />
          <LtSelect
            :model-value="record.type"
            :options="recordTypeOptions"
            variant="outline"
            size="sm"
            :aria-label="t('newEdit.dnsRecordType')"
            @update:model-value="onRecordTypeChange(record, $event)"
          />
          <LtInput
            v-model="record.ttl"
            variant="outline"
            :aria-label="t('newEdit.dnsTtl')"
            placeholder="0"
          />
          <LtInput
            v-model="record.value"
            variant="outline"
            :aria-label="t('newEdit.dnsRecordValue')"
            :placeholder="t('newEdit.dnsRecordValue')"
          />
          <LtButton
            variant="ghost"
            size="sm"
            :title="t('newEdit.dnsRemoveRecord')"
            :aria-label="t('newEdit.dnsRemoveRecord')"
            @click="removeRecord(zoneIndex, recordIndex)"
            >✕</LtButton
          >
        </div>
        <LtButton variant="ghost" size="sm" @click="zone.records.push(emptyDnsRecord())"
          >＋ {{ t('newEdit.dnsAddRecord') }}</LtButton
        >
      </div>
    </div>

    <div v-if="!formDns.zones.length" class="ed-compat-note">{{ t('newEdit.dnsEmptyHint') }}</div>
    <LtButton variant="ghost" size="sm" @click="formDns.zones.push(emptyDnsZone())"
      >＋ {{ t('newEdit.dnsAddZone') }}</LtButton
    >
  </details>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput, LtSelect } from '@/shared/ui'
import { injectRequired } from '@/shared/lib/inject'
import {
  emptyDnsRecord,
  emptyDnsZone,
  type DnsRecordForm
} from '@/features/configs/lib/configFormUtil'
import { CONFIG_EDITOR_KEY } from './context'

defineOptions({ name: 'ConfigMagicDnsEditor' })

const { t } = useI18n()
const { formDns, dnsSupported } = injectRequired(CONFIG_EDITOR_KEY, 'ConfigMagicDnsEditor')

/** 记录类型与内核支持的 DNS 记录类型保持一致（值为 RDATA 展示文本） */
const DNS_RECORD_TYPES = [
  'A',
  'AAAA',
  'ANAME',
  'CAA',
  'CERT',
  'CNAME',
  'CSYNC',
  'HINFO',
  'HTTPS',
  'MX',
  'NAPTR',
  'NS',
  'OPENPGPKEY',
  'PTR',
  'SOA',
  'SRV',
  'SSHFP',
  'SVCB',
  'TLSA',
  'TXT'
]
const recordTypeOptions = DNS_RECORD_TYPES.map((type) => ({ label: type, value: type }))

const onRecordTypeChange = (record: DnsRecordForm, value: string | number | null) => {
  record.type = typeof value === 'string' && value ? value : 'A'
}

const removeZone = (zoneIndex: number) => {
  formDns.value.zones.splice(zoneIndex, 1)
}

const removeRecord = (zoneIndex: number, recordIndex: number) => {
  formDns.value.zones[zoneIndex]?.records.splice(recordIndex, 1)
}
</script>

<style scoped lang="less">
@import url('./form.less');

.ed-dns-hint {
  margin-bottom: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-secondary, #7a6e5e);
}

.ed-dns-zone {
  padding: 10px 12px;
  margin-bottom: 10px;
  background: rgb(var(--theme-bg-card-rgb, 255, 255, 255), 0.55);
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
}

.ed-dns-zone-head {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.ed-dns-grow {
  flex: 1;
  min-width: 0;
}

.ed-dns-ttl {
  width: 80px;
  flex-shrink: 0;
}

.ed-dns-records {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.ed-dns-records-title {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-secondary, #7a6e5e);
}

.ed-dns-record {
  display: grid;
  grid-template-columns: 1.1fr 96px 64px 1.6fr auto;
  gap: 6px;
  align-items: center;
}

@media (width <= 640px) {
  .ed-dns-zone-head {
    flex-wrap: wrap;
  }

  .ed-dns-record {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
