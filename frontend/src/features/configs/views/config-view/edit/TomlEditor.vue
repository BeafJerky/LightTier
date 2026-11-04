<template>
  <CodeEditor v-model="model" language="toml" />
</template>

<script setup lang="ts">
import CodeEditor from '@/features/configs/components/CodeEditor.vue'

defineOptions({ name: 'ConfigTomlEditor' })

const model = defineModel<string>({ required: true })
</script>
