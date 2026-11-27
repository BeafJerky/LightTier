<template>
  <div class="ed-form-section">
    <div class="ed-form-section-title">{{ t('newEdit.aclSection') }}</div>
    <div class="ed-form-field ed-form-field--switch">
      <label class="ed-form-label" :for="fieldId('acl_enabled')">{{
        t('newEdit.aclEnable')
      }}</label>
      <div class="ed-form-switch-wrap">
        <LtSwitch v-model="formAcl.enabled" :aria-label="t('newEdit.aclEnable')" />
      </div>
    </div>
    <p class="ed-section-hint">{{ t('newEdit.aclHint') }}</p>

    <template v-if="formAcl.enabled">
      <details class="ed-adv-collapse" open>
        <summary class="ed-form-section-title ed-adv-summary">{{
          t('newEdit.aclGroupSection')
        }}</summary>
        <div class="ed-tag-list">
          <div class="ed-tag-row" v-for="(declare, i) in formAcl.declares" :key="'gd' + i">
            <LtInput
              v-model="declare.groupName"
              class="ed-tag-input-short"
              variant="outline"
              :aria-label="`${t('newEdit.aclGroupName')} ${i + 1}`"
              placeholder="group_name"
            />
            <LtInput
              v-model="declare.groupSecret"
              class="ed-tag-input"
              variant="outline"
              :aria-label="`${t('newEdit.aclGroupSecret')} ${i + 1}`"
              placeholder="group_secret"
              type="password"
            />
            <LtButton
              variant="text"
              size="md"
              circle
              :title="t('newEdit.removeItem', { label: t('newEdit.aclGroupSection') })"
              :aria-label="t('newEdit.removeItem', { label: t('newEdit.aclGroupSection') })"
              @click="formAcl.declares.splice(i, 1)"
            >
              ✕
            </LtButton>
          </div>
          <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="addDeclare">{{
            t('newEdit.aclAddGroup')
          }}</LtButton>
          <div class="ed-form-field">
            <label class="ed-form-label">{{ t('newEdit.aclMembers') }}</label>
            <LtInput
              v-model="formAcl.members"
              variant="outline"
              :aria-label="t('newEdit.aclMembers')"
              placeholder="peer public keys"
            />
          </div>
        </div>
      </details>

      <div class="ed-acl-chains">
        <div class="ed-form-label">{{ t('newEdit.aclChains') }}</div>
        <div v-for="(chain, ci) in formAcl.chains" :key="'ch' + ci" class="ed-acl-chain">
          <div class="ed-acl-head">
            <LtInput
              v-model="chain.name"
              variant="outline"
              :aria-label="`${t('newEdit.aclChainName')} ${ci + 1}`"
              :placeholder="t('newEdit.aclChainName')"
            />
            <LtSelect
              :model-value="chain.chainType"
              :options="chainTypeOptions"
              variant="outline"
              size="sm"
              :aria-label="`${t('newEdit.aclChainType')} ${ci + 1}`"
              @update:model-value="chain.chainType = Number($event)"
            />
            <LtSelect
              :model-value="chain.defaultAction"
              :options="actionOptions"
              variant="outline"
              size="sm"
              :aria-label="`${t('newEdit.aclDefaultAction')} ${ci + 1}`"
              @update:model-value="chain.defaultAction = Number($event)"
            />
            <div class="ed-acl-switch">
              <span class="ed-acl-switch-label">{{ t('newEdit.aclEnabled') }}</span>
              <LtSwitch v-model="chain.enabled" :aria-label="t('newEdit.aclEnabled')" />
            </div>
            <LtButton
              variant="text"
              size="md"
              circle
              :title="t('newEdit.removeItem', { label: t('newEdit.aclChains') })"
              :aria-label="t('newEdit.removeItem', { label: t('newEdit.aclChains') })"
              @click="formAcl.chains.splice(ci, 1)"
            >
              ✕
            </LtButton>
          </div>
          <LtInput
            v-model="chain.description"
            variant="outline"
            :aria-label="`${t('newEdit.aclDescription')} ${ci + 1}`"
            :placeholder="t('newEdit.aclDescription')"
          />

          <details
            v-for="(rule, ri) in chain.rules"
            :key="'rl' + ci + '-' + ri"
            class="ed-acl-rule"
          >
            <summary class="ed-acl-rule-summary">
              <span class="ed-acl-rule-name">{{ rule.name || t('newEdit.aclUnnamedRule') }}</span>
              <span class="ed-acl-rule-actions">
                <LtSwitch v-model="rule.enabled" :aria-label="t('newEdit.aclEnabled')" />
                <LtButton
                  variant="text"
                  size="sm"
                  circle
                  :title="t('newEdit.removeItem', { label: t('newEdit.aclRules') })"
                  :aria-label="t('newEdit.removeItem', { label: t('newEdit.aclRules') })"
                  @click.stop.prevent="chain.rules.splice(ri, 1)"
                >
                  ✕
                </LtButton>
              </span>
            </summary>
            <div class="ed-form-grid">
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclRuleName') }}</label>
                <LtInput
                  v-model="rule.name"
                  variant="outline"
                  :aria-label="t('newEdit.aclRuleName')"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclPriority') }}</label>
                <LtInput
                  v-model="rule.priority"
                  variant="outline"
                  inputmode="numeric"
                  :aria-label="t('newEdit.aclPriority')"
                  placeholder="0"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclProtocol') }}</label>
                <LtSelect
                  :model-value="rule.protocol"
                  :options="protocolOptions"
                  variant="outline"
                  size="sm"
                  :aria-label="t('newEdit.aclProtocol')"
                  @update:model-value="rule.protocol = Number($event)"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclDefaultAction') }}</label>
                <LtSelect
                  :model-value="rule.action"
                  :options="actionOptions"
                  variant="outline"
                  size="sm"
                  :aria-label="t('newEdit.aclDefaultAction')"
                  @update:model-value="rule.action = Number($event)"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclPorts') }}</label>
                <LtInput
                  v-model="rule.ports"
                  variant="outline"
                  :aria-label="t('newEdit.aclPorts')"
                  placeholder="80 443 8000-9000"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclSourcePorts') }}</label>
                <LtInput
                  v-model="rule.sourcePorts"
                  variant="outline"
                  :aria-label="t('newEdit.aclSourcePorts')"
                  placeholder="1024-65535"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclSourceIps') }}</label>
                <LtInput
                  v-model="rule.sourceIps"
                  variant="outline"
                  :aria-label="t('newEdit.aclSourceIps')"
                  placeholder="10.0.0.0/8"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclDestIps') }}</label>
                <LtInput
                  v-model="rule.destinationIps"
                  variant="outline"
                  :aria-label="t('newEdit.aclDestIps')"
                  placeholder="10.1.0.0/16"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclSourceGroups') }}</label>
                <LtInput
                  v-model="rule.sourceGroups"
                  variant="outline"
                  :aria-label="t('newEdit.aclSourceGroups')"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclDestGroups') }}</label>
                <LtInput
                  v-model="rule.destinationGroups"
                  variant="outline"
                  :aria-label="t('newEdit.aclDestGroups')"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclRateLimit') }}</label>
                <LtInput
                  v-model="rule.rateLimit"
                  variant="outline"
                  inputmode="numeric"
                  :aria-label="t('newEdit.aclRateLimit')"
                  placeholder="0"
                />
              </div>
              <div class="ed-form-field">
                <label class="ed-form-label">{{ t('newEdit.aclBurstLimit') }}</label>
                <LtInput
                  v-model="rule.burstLimit"
                  variant="outline"
                  inputmode="numeric"
                  :aria-label="t('newEdit.aclBurstLimit')"
                  placeholder="0"
                />
              </div>
              <div class="ed-form-field ed-form-field--switch">
                <label class="ed-form-label">{{ t('newEdit.aclStateful') }}</label>
                <div class="ed-form-switch-wrap">
                  <LtSwitch v-model="rule.stateful" :aria-label="t('newEdit.aclStateful')" />
                </div>
              </div>
              <div class="ed-form-field ed-form-field-wide">
                <label class="ed-form-label">{{ t('newEdit.aclDescription') }}</label>
                <LtInput
                  v-model="rule.description"
                  variant="outline"
                  :aria-label="t('newEdit.aclDescription')"
                />
              </div>
            </div>
          </details>
          <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="addRule(chain)">{{
            t('newEdit.aclAddRule')
          }}</LtButton>
        </div>
        <LtButton variant="ghost" size="sm" class="ed-tag-add" @click="addChain">{{
          t('newEdit.aclAddChain')
        }}</LtButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput, LtSelect, LtSwitch } from '@/shared/ui'
import { injectRequired } from '@/shared/lib/inject'
import {
  emptyAclChain,
  emptyAclRule,
  type AclChainForm
} from '@/features/configs/lib/configFormUtil'
import { CONFIG_EDITOR_KEY } from './context'

defineOptions({ name: 'ConfigAclForm' })

const { t } = useI18n()
const { fieldId, formAcl } = injectRequired(CONFIG_EDITOR_KEY, 'ConfigAclForm')

const protocolOptions = [
  { label: 'Any', value: 5 },
  { label: 'TCP', value: 1 },
  { label: 'UDP', value: 2 },
  { label: 'ICMP', value: 3 },
  { label: 'ICMPv6', value: 4 }
]
const actionOptions = [
  { label: t('newEdit.aclActionAllow'), value: 1 },
  { label: t('newEdit.aclActionDrop'), value: 2 },
  { label: t('newEdit.aclActionNoop'), value: 0 }
]
const chainTypeOptions = [
  { label: t('newEdit.aclChainInbound'), value: 1 },
  { label: t('newEdit.aclChainOutbound'), value: 2 },
  { label: t('newEdit.aclChainForward'), value: 3 }
]

const addDeclare = () => formAcl.value.declares.push({ groupName: '', groupSecret: '' })
const addChain = () => formAcl.value.chains.push(emptyAclChain())
const addRule = (chain: AclChainForm) => chain.rules.push(emptyAclRule())
</script>

<style scoped lang="less">
@import url('./form.less');

.ed-acl-chains {
  display: flex;
  margin-top: 12px;
  flex-direction: column;
  gap: 8px;
}

.ed-acl-chain {
  padding: 10px;
  border: 1px solid var(--theme-border-light, #f5ede6);
  border-radius: var(--theme-radius-md, 10px);
}

.ed-acl-head {
  display: grid;
  margin-bottom: 8px;
  gap: 6px;
  align-items: center;
  grid-template-columns: minmax(120px, 1fr) 110px 110px auto auto;
}

.ed-acl-switch {
  display: flex;
  gap: 6px;
  align-items: center;
}

.ed-acl-switch-label {
  font-size: 11px;
  color: var(--theme-text-muted, #c8bdb2);
  white-space: nowrap;
}

.ed-acl-rule {
  padding: 6px 0 10px;
  border-top: 1px dashed var(--theme-border-light, #f5ede6);
}

.ed-acl-rule summary {
  list-style: none;
  cursor: pointer;
}

.ed-acl-rule summary::-webkit-details-marker {
  display: none;
}

.ed-acl-rule-summary {
  display: flex;
  padding: 4px 0;
  align-items: center;
  justify-content: space-between;
}

.ed-acl-rule-name {
  font-size: 12px;
  color: var(--theme-text-secondary, #7a6e5e);
}

.ed-acl-rule-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

@media (width <= 640px) {
  .ed-acl-head {
    grid-template-columns: 1fr;
  }
}
</style>
