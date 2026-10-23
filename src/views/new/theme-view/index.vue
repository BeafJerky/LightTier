<template>
  <div class="ntv-page">
    <ThemeDialog v-model="visible" inline />
  </div>
</template>

<script setup lang="ts">
/** theme-view — 主题二级页面（Android 专属）：将 ThemeDialog 以 inline 卡片形式承载 */
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ThemeDialog from '@/components/ThemeDialog/index.vue'

defineOptions({ name: 'NewThemeView' })

const router = useRouter()
// 先关后开：触发面板内部 watch(visible) 的初始化逻辑（主题列表与预览渲染，与点击入口打开弹窗时一致）
const visible = ref(false)
onMounted(() => {
  visible.value = true
})

// 面板关闭（取消/应用主题后）→ 回退设置首页；无历史时同样回设置
watch(visible, (v) => {
  if (!v) {
    if (window.history.state?.back) router.back()
    else router.push('/new/settings')
  }
})
</script>

<style scoped>
.ntv-page {
  height: 100%;
}

.ntv-page :deep(.cd-dialog-inline) {
  background: var(--theme-bg);
  border: none;
  border-radius: 0;
}

/* 壳层已提供页面级留白，内容区不再叠加，保证与其他二级页左缘一致 */
.ntv-page :deep(.cd-body) {
  padding: 0;
}

.ntv-page :deep(.td-body) {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: var(--theme-space-4);
}

.ntv-page :deep(.td-sidebar) {
  width: 100%;
  gap: var(--theme-space-3);
}

.ntv-page :deep(.td-sidebar-header) {
  padding: 0 2px;
}

.ntv-page :deep(.td-sidebar-title) {
  font-family: var(--theme-font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.ntv-page :deep(.td-refresh-btn) {
  height: 30px;
  padding: 0 12px;
  font-size: 11.5px;
  background: var(--theme-bg-card);
  border-radius: var(--theme-radius-pill);
}

/* 主题选择：分组卡片行 */
.ntv-page :deep(.td-list) {
  display: block;
  padding: 0;
  overflow: hidden;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
  gap: 0;
}

.ntv-page :deep(.td-item) {
  min-height: 60px;
  padding: 0 14px;
  background: transparent;
  border-radius: 0;
  gap: 12px;
}

.ntv-page :deep(.td-item + .td-item) {
  border-top: 1px solid var(--theme-border-light);
}

.ntv-page :deep(.td-item.active) {
  background: color-mix(in srgb, var(--theme-accent-primary) 5%, transparent);
}

.ntv-page :deep(.td-item-dot) {
  width: 22px;
  height: 22px;
  border: 1px solid var(--theme-border);
  box-shadow: inset 0 0 0 3px var(--theme-bg-card);
}

.ntv-page :deep(.td-item-label) {
  font-family: var(--theme-font-body);
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  flex: 1;
}

.ntv-page :deep(.td-item-badge) {
  padding: 2px 7px;
  margin-left: 0;
  font-size: 10px;
  border-radius: var(--theme-radius-pill);
}

.ntv-page :deep(.td-item-check) {
  margin-left: 0;
}

/* 导入 / 指南：列表上方的两张并列操作卡 */
.ntv-page :deep(.td-tools) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.ntv-page :deep(.td-tool-btn) {
  display: flex;
  width: 100%;
  height: 52px;
  padding: 0 12px;
  font-family: var(--theme-font-body);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--theme-text-primary);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
  justify-content: center;
  gap: 8px;
}

.ntv-page :deep(.td-tool-btn:active) {
  background: var(--theme-bg-hover);
}

.ntv-page :deep(.td-tool-btn svg) {
  width: 17px;
  height: 17px;
  color: var(--theme-accent-primary);
  flex-shrink: 0;
}

.ntv-page :deep(.td-inline-reset) {
  display: flex;
  width: 100%;
  height: 44px;
  margin-top: 2px;
  font-family: var(--theme-font-body);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  cursor: pointer;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
  align-items: center;
  justify-content: center;
  gap: 6px;
  -webkit-tap-highlight-color: transparent;
}

.ntv-page :deep(.td-inline-reset:active) {
  background: var(--theme-bg-hover);
}

/* 预览区 */
.ntv-page :deep(.td-preview-block) {
  flex: none;
}

.ntv-page :deep(.td-preview-label) {
  display: block;
  margin: 0 2px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.ntv-page :deep(.td-preview-wrap) {
  height: 300px;
  border-width: 1px;
  border-radius: var(--theme-radius-lg, 14px);
  flex: none;
}

.ntv-page :deep(.td-preview) {
  height: 100%;
  min-height: 0;
}

/* 底部操作栏 */
.ntv-page :deep(.cd-footer) {
  padding: 10px 0 calc(10px + var(--lt-safe-area-bottom, 0px));
  background: var(--theme-bg);
  border-top: 1px solid var(--theme-border-light);
}

.ntv-page :deep(.td-footer-inline) {
  width: 100%;
}

.ntv-page :deep(.td-footer-inline .td-footer-actions) {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr 1.35fr;
  gap: 10px;
}
</style>
