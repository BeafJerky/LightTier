<template>
  <div class="ntv-page">
    <ThemeDialog v-model="visible" inline />
  </div>
</template>

<script setup lang="ts">
/** theme-view — 主题二级页面（Android 专属）：将 ThemeDialog 以 inline 卡片形式承载 */
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ThemeDialog from '@/features/themes/components/ThemeDialog.vue'

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
  overflow: hidden;
}

/* 页面内自行分配高度：主题列表滚动，预览固定在底部操作栏上方 */
.ntv-page :deep(.td-body) {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: var(--theme-space-3);
}

.ntv-page :deep(.td-sidebar) {
  width: 100%;
  min-height: 0;
  flex: 1;
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
  color: var(--theme-text-secondary);
  text-transform: uppercase;
}

.ntv-page :deep(.td-refresh-btn) {
  height: 32px;
  padding: 0 12px;
  font-size: 11.5px;
  background: var(--theme-bg-card);
  border-radius: var(--theme-radius-pill);
}

/* 主题选择：分组卡片行；列表独立滚动，预览与底部按钮始终可见 */
.ntv-page :deep(.td-list) {
  display: block;
  min-height: 0;
  padding: 0 0 8px;
  overflow-y: auto;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
  overscroll-behavior: contain;
  scroll-padding-bottom: 8px;
  flex: 1;
}

/* 分组标题：卡片内吸顶，背景取卡片色遮住滚动条目 */
.ntv-page :deep(.td-group) {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 10px 14px 6px;
  font-family: var(--theme-font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.2px;
  color: var(--theme-text-muted);
  background: var(--theme-bg-card);
}

/* 窄屏规则隐藏计数是为桌面横向条带降级，安卓纵向卡片列表保留计数 */
.ntv-page :deep(.td-group-count) {
  display: inline;
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
  background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.05);
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

/* 预览区：固定高度贴底，不随主题列表滚动 */
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
  /* 移动端预览骨架的自然高度约 293px：定高 300 保证整块预览完整可见 */
  height: 300px;
  border-width: 1px;
  border-radius: var(--theme-radius-lg, 14px);
  flex: none;
}

/* 矮屏（小屏手机 / 分屏）：压缩预览，给主题列表保留可滚动空间 */
@media (height <= 720px) {
  .ntv-page :deep(.td-preview-wrap) {
    height: 200px;
  }
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

/* 宽屏 / 横屏 / 平板：左右布局（主题列表在左、预览在右），与桌面弹窗一致；
   竖屏手机维持上下布局，列表滚动、预览固定贴底 */
@media (width >= 641px) {
  .ntv-page :deep(.td-body) {
    flex-direction: row;
  }

  .ntv-page :deep(.td-sidebar) {
    width: 220px;
    min-height: 0;
    flex: none;
  }

  /* 侧栏变窄：导入 / 指南改为单列，避免按钮文案挤压 */
  .ntv-page :deep(.td-tools) {
    grid-template-columns: 1fr;
  }

  .ntv-page :deep(.td-tool-btn) {
    height: 44px;
    justify-content: flex-start;
  }

  .ntv-page :deep(.td-preview-block) {
    height: 100%;
    min-width: 0;
    flex: 1;
  }

  /* 预览占满右侧剩余高度（覆盖上下的定高与矮屏压缩） */
  .ntv-page :deep(.td-preview-wrap) {
    height: auto;
    min-height: 0;
    flex: 1;
  }
}

/* 手机竖屏：主题列表改双列卡片，预览缩为缩略图，列表可见更多主题 */
@media (width <= 640px) and (aspect-ratio <= 3 / 5) {
  .ntv-page :deep(.td-tool-btn) {
    height: 44px;
  }

  .ntv-page :deep(.td-preview-wrap) {
    height: 150px;
  }

  .ntv-page :deep(.td-list) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-content: start;
    gap: 8px;
    padding: 8px;
    box-shadow: inset 0 -18px 16px -16px var(--theme-bg-card);
  }

  .ntv-page :deep(.td-group) {
    grid-column: 1 / -1;
    top: -8px;
    padding: 4px 6px 0;
  }

  .ntv-page :deep(.td-item) {
    min-height: 50px;
    padding: 0 10px;
    background: transparent;
    border: 1px solid var(--theme-border-light);
    border-radius: 10px;
    gap: 8px;
  }

  .ntv-page :deep(.td-item + .td-item) {
    border-top: 1px solid var(--theme-border-light);
  }

  .ntv-page :deep(.td-item.active) {
    background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.07);
    border-color: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.35);
  }

  .ntv-page :deep(.td-item-dot) {
    width: 18px;
    height: 18px;
  }

  .ntv-page :deep(.td-item-label) {
    font-size: 13px;
  }

  .ntv-page :deep(.td-item-badge) {
    padding: 1px 5px;
    font-size: 10px;
  }
}

/* 横屏手机（矮屏）：保留左列表 + 右预览，压缩左侧工具栏给列表让出高度；
   平板横屏高度更大，不命中本段，维持现有左右布局 */
@media (width >= 641px) and (height <= 520px) {
  .ntv-page :deep(.td-body) {
    gap: 12px;
  }

  .ntv-page :deep(.td-sidebar) {
    width: 260px;
    height: 100%;
    min-height: 0;
    gap: 8px;
  }

  .ntv-page :deep(.td-sidebar-header) {
    height: auto;
    min-height: 40px;
  }

  .ntv-page :deep(.td-sidebar-title) {
    font-size: 11px;
    letter-spacing: 0.8px;
  }

  .ntv-page :deep(.td-total) {
    margin-left: 4px;
    font-size: 11px;
  }

  .ntv-page :deep(.td-refresh-btn) {
    height: 40px;
    padding: 0 10px;
    font-size: 11.5px;
  }

  .ntv-page :deep(.td-tools) {
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .ntv-page :deep(.td-tool-btn) {
    height: 44px;
    padding: 0 6px;
    font-size: 11.5px;
    justify-content: center;
    gap: 4px;
  }

  .ntv-page :deep(.td-tool-btn svg) {
    width: 12px;
    height: 12px;
  }

  .ntv-page :deep(.td-list) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-content: start;
    gap: 3px;
    padding: 6px;
    box-shadow: inset 0 -16px 14px -14px var(--theme-bg-card);
  }

  .ntv-page :deep(.td-group) {
    grid-column: 1 / -1;
    top: -6px;
    padding: 0 4px;
    font-size: 11px;
    line-height: 1.2;
  }

  .ntv-page :deep(.td-item) {
    min-height: 40px;
    padding: 0 7px;
    background: transparent;
    border: 1px solid var(--theme-border-light);
    border-radius: 8px;
    gap: 6px;
  }

  .ntv-page :deep(.td-item + .td-item) {
    border-top: 1px solid var(--theme-border-light);
  }

  .ntv-page :deep(.td-item.active) {
    background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.07);
    border-color: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.35);
  }

  .ntv-page :deep(.td-item-dot) {
    width: 14px;
    height: 14px;
  }

  .ntv-page :deep(.td-item-label) {
    overflow: hidden;
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ntv-page :deep(.td-item-badge) {
    padding: 0 4px;
    font-size: 8px;
  }

  .ntv-page :deep(.td-item-check) {
    width: 13px;
    height: 13px;
  }

  /* 恢复默认移到底部操作栏，侧栏只保留列表 */
  .ntv-page :deep(.td-inline-reset) {
    display: none;
  }

  .ntv-page :deep(.td-preview-block) {
    height: 100%;
  }

  .ntv-page :deep(.td-preview-label) {
    margin: 0 2px 5px;
    font-size: 11px;
    letter-spacing: 1px;
  }

  .ntv-page :deep(.td-preview-wrap) {
    height: auto;
    min-height: 0;
    flex: 1;
  }

  .ntv-page :deep(.td-preview) {
    min-height: 0;
  }

  .ntv-page :deep(.cd-footer) {
    padding: 6px 0 calc(6px + var(--lt-safe-area-bottom, 0px));
  }

  .ntv-page :deep(.td-footer-inline) {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .ntv-page :deep(.td-footer-reset) {
    display: flex;
    height: 40px;
    padding: 0 4px;
    font-size: 11px;
    color: var(--theme-text-secondary);
    flex: none;
    gap: 5px;
  }

  .ntv-page :deep(.td-footer-inline .td-footer-actions) {
    display: grid;
    width: auto;
    grid-template-columns: 1fr 1.35fr;
    flex: 1;
    gap: 8px;
  }

  .ntv-page :deep(.td-btn) {
    height: 40px;
    font-size: 12.5px;
  }
}
</style>
