<script setup lang="ts">
/**
 * LtInput — Naive UI Input 封装
 * 统一使用主题变量的填充色、边框与圆角；filled 为浅底描边，outline 为卡片底描边。
 */
import { computed, ref } from 'vue'
import { NInput } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    modelValue?: string | null
    placeholder?: string
    type?: 'text' | 'password' | 'textarea'
    variant?: 'filled' | 'outline'
    size?: 'sm' | 'md' | 'lg'
    round?: boolean
    clearable?: boolean
    disabled?: boolean
    readonly?: boolean
    ariaLabel?: string
    ariaInvalid?: boolean
    ariaDescribedby?: string
    inputId?: string
    autocomplete?: string
    maxlength?: number
    inputmode?: 'text' | 'numeric' | 'decimal' | 'url' | 'email' | 'search' | 'tel'
    spellcheck?: boolean
  }>(),
  {
    modelValue: '',
    placeholder: '',
    type: 'text',
    variant: 'filled',
    size: 'md',
    round: true,
    clearable: false,
    disabled: false,
    readonly: false,
    ariaLabel: undefined,
    ariaInvalid: undefined,
    ariaDescribedby: undefined,
    inputId: undefined,
    autocomplete: undefined,
    maxlength: undefined,
    inputmode: undefined,
    spellcheck: undefined
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  input: [value: string]
  keydown: [event: KeyboardEvent]
  keyup: [event: KeyboardEvent]
  focus: [event: FocusEvent]
  blur: [event: FocusEvent]
}>()

const naiveSize = computed(() =>
  props.size === 'sm' ? 'small' : props.size === 'lg' ? 'large' : 'medium'
)
const inputRef = ref<InstanceType<typeof NInput> | null>(null)

defineExpose({
  focus: () => inputRef.value?.focus(),
  select: () => inputRef.value?.select()
})
</script>

<template>
  <NInput
    ref="inputRef"
    class="lt-input"
    :class="[`lt-input--${variant}`, `lt-input--${size}`, { 'lt-input--invalid': ariaInvalid }]"
    :value="modelValue ?? ''"
    :placeholder="placeholder"
    :type="type"
    :size="naiveSize"
    :round="round && type !== 'textarea'"
    :clearable="clearable"
    :disabled="disabled"
    :readonly="readonly"
    :maxlength="maxlength"
    :input-props="{
      id: inputId,
      'aria-label': ariaLabel,
      'aria-invalid': ariaInvalid,
      'aria-describedby': ariaDescribedby,
      autocomplete,
      inputmode,
      spellcheck
    }"
    @update:value="emit('update:modelValue', $event)"
    @input="emit('input', $event)"
    @keydown="emit('keydown', $event)"
    @keyup="emit('keyup', $event)"
    @focus="emit('focus', $event)"
    @blur="emit('blur', $event)"
  />
</template>

<style scoped>
.lt-input {
  width: 100%;
  font-family: var(--theme-font-body, 'Sora', sans-serif);
}

/* filled：浅底 + 1px 描边，用于设置项与轻量筛选 */
.lt-input--filled {
  background-color: var(--theme-bg-tag, #f5ede6) !important;
}

/* outline：卡片底色 + 1.5px 描边，用于编辑表单 */
.lt-input--outline :deep(.n-input__border),
.lt-input--outline :deep(.n-input__state-border) {
  border-width: 1.5px !important;
}

.lt-input--outline :deep(.n-input__input-el),
.lt-input--outline :deep(.n-input__textarea-el) {
  font-size: 13px;
}

.lt-input--invalid :deep(.n-input__border),
.lt-input--invalid :deep(.n-input__state-border) {
  border-color: var(--theme-color-danger, #e8a0a0);
}
</style>
