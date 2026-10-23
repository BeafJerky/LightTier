<template>
  <div class="nss-page">
    <SettingsDialog v-model="visible" inline :section="section" />
  </div>
</template>

<script setup lang="ts">
/** SectionView — Android 设置分类子页：复用 SettingsDialog 单页模式，全屏承载 */
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import SettingsDialog from '@/components/SettingsDialog/index.vue'

defineOptions({ name: 'NewSettingsSectionView' })

type SettingsSection = 'general' | 'core' | 'data' | 'security' | 'about'

const route = useRoute()
const section = ref<SettingsSection>((route.meta.section as SettingsSection) || 'general')
const visible = ref(false)

onMounted(() => {
  // 先关后开：触发面板内部 watch(visible) 的版本/偏好加载
  visible.value = true
})

// 分类路由共用同一组件实例：切换分类时重新打开以重跑初始化
watch(
  () => route.meta.section,
  async (value) => {
    const next = (value as SettingsSection) || 'general'
    if (next === section.value) return
    visible.value = false
    section.value = next
    await nextTick()
    visible.value = true
  }
)
</script>

<style scoped>
.nss-page {
  min-height: 100%;
}

/* 分类子页：卡片随内容收缩，避免单项设置撑出一整屏空白卡片 */
.nss-page :deep(.cd-overlay-inline),
.nss-page :deep(.cd-dialog-inline),
.nss-page :deep(.cd-body) {
  height: auto;
}

.nss-page :deep(.cd-body) {
  padding: var(--theme-space-4);
  overflow: visible;
}

.nss-page :deep(.sd-body) {
  flex: none;
}
</style>
