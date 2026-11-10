<template>
  <div
    class="nw-root"
    :class="{
      'nw-android': isAndroidPlatform,
      'nw-list-empty': isListEmpty,
      'nw-detail-open': isAndroidPlatform
        ? isAndroidDetailRoute || (isWideLandscape && !!selectedConfig)
        : !!selectedDetail
    }"
  >
    <ConfigList />
    <ConfigDetail />
  </div>
  <!-- 配置编辑弹窗：仅桌面端；Android 进入独立编辑页面（config-edit-view） -->
  <EditDialog
    v-if="!isAndroidPlatform"
    v-model="editVisible"
    :config-name="editConfigName"
    :toml-content="editTomlContent"
    :dialog-mode="editDialogMode"
    :existing-config-names="configNameList"
    @saved="handleSaved"
  />
  <ServiceDialog
    v-if="!isAndroidPlatform"
    v-model="svcDialogVisible"
    :config-name="svcConfigName"
    @installed="handleServiceInstalled"
  />
  <!-- 自定义确认弹窗（替代原生 confirm） -->
  <CreamDialog v-model="cfmVisible" :title="cfmTitle" width="400px">
    <p class="cfm-msg">{{ cfmMessage }}</p>
    <template #footer>
      <div class="cfm-footer">
        <LtButton variant="ghost" size="md" @click="resolveConfirm(false)">{{
          t('newCommon.cancel')
        }}</LtButton>
        <LtButton variant="primary" size="md" @click="resolveConfirm(true)">{{
          t('newCommon.confirm')
        }}</LtButton>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * config-view — 配置管理主页面（壳组件）
 *
 * 列表与详情拆分为 ConfigList / ConfigDetail，状态与业务逻辑收敛在 useConfigList；
 * 本组件只负责整体布局（master-detail 容器）、编辑/服务弹窗挂载与页面级确认弹窗。
 * 平台差异由 useConfigList 提供：桌面宽屏左右分栏，Android 列表与详情互斥展示。
 */
import { onMounted, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import CreamDialog from '@/shared/ui/CreamDialog.vue'
import { LtButton } from '@/shared/ui'
import { usePageConfirm } from '@/shared/ui/usePageConfirm'
import { useConfigList } from '@/features/configs/composables/useConfigList'
import ConfigList from './ConfigList.vue'
import ConfigDetail from './ConfigDetail.vue'
import EditDialog from './EditDialog.vue'
import ServiceDialog from './ServiceDialog.vue'
import { CONFIG_LIST_KEY } from './context'

defineOptions({ name: 'NewConfigView' })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// ===== 页面级确认弹窗 =====
const {
  visible: cfmVisible,
  title: cfmTitle,
  message: cfmMessage,
  show: showConfirm,
  resolve: resolveConfirm
} = usePageConfirm()

const listApi = useConfigList({ confirm: showConfirm })
provide(CONFIG_LIST_KEY, listApi)

const {
  isAndroidPlatform,
  isWideLandscape,
  isAndroidDetailRoute,
  isListEmpty,
  selectedConfig,
  selectedDetail,
  editVisible,
  editConfigName,
  editTomlContent,
  editDialogMode,
  configNameList,
  handleSaved,
  svcDialogVisible,
  svcConfigName,
  handleServiceInstalled,
  openAdd
} = listApi

// ===== 支持空态/引导一键新建 =====
// ?create=1 打开新增后清除 query，避免刷新重复弹出
onMounted(() => {
  if (route.query.create !== '1') return
  const query = { ...route.query }
  delete query.create
  router.replace({ query })
  openAdd()
})
</script>

<style scoped>
.nw-root {
  display: flex;
  gap: var(--theme-space-4);
  height: 100%;
  min-height: 0;
  font-family: var(--theme-font-body);
}

.nw-left {
  display: flex;
  width: 240px;
  min-height: 0;
  flex-shrink: 0;
  flex-direction: column;
  gap: var(--theme-space-2);
}

.nw-right {
  min-height: 0;
  padding: var(--theme-space-5) var(--theme-space-6);
  overflow-y: auto;
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  flex: 1;
}

/* 移动端适配：master-detail 互斥，列表与详情单独展示 */
@media (width <= 900px) {
  .nw-root {
    flex-direction: column;
  }

  .nw-left {
    width: 100%;
    flex: 1;
  }

  /* 选中详情后隐藏列表，仅展示详情 */
  .nw-detail-open .nw-left {
    display: none;
  }

  /* 清单态隐藏空占位面板 */
  .nw-root:not(.nw-detail-open) .nw-right {
    display: none;
  }

  /* 提高特异性，覆盖基础 display:none，确保窄屏详情态返回按钮可见 */
  .nw-detail-open :deep(.nw-back-btn) {
    display: inline-flex;
  }

  .nw-right {
    flex: 1;
    padding: var(--theme-space-4);
  }
}

/* 手机尺寸：字段网格降为单列，避免长值被挤成两行 */
@media (width <= 480px) {
  .nw-root :deep(.nw-grid) {
    grid-template-columns: 1fr;
  }
}

/* Android：详情为独立路由，任何宽度下列表与详情都互斥展示 */
.nw-root.nw-android {
  display: block;
  height: auto;
  min-height: auto;
}

.nw-root.nw-android .nw-left {
  display: flex;
  width: 100%;
  flex: none;
  flex-direction: column;
}

.nw-root.nw-android :deep(.nw-left-header) {
  padding: 0;
  gap: var(--theme-space-2);
}

.nw-root.nw-android :deep(.nw-left-scroll) {
  display: block;
  padding: 0;
  overflow: visible;
  background: transparent;
  border-radius: 0;
  flex: none;
}

/* --- 配置分组列表 --- */
.nw-root.nw-android :deep(.nw-card-list) {
  overflow: hidden;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
}

.nw-root.nw-android :deep(.nw-card-list:empty) {
  display: none;
}

/* 安卓行过渡保持在同一列表容器内，不做绝对定位离场 */
.nw-root.nw-android :deep(.nw-card-leave-active) {
  position: relative;
  right: auto;
  left: auto;
}

/* --- 空状态 --- */
.nw-root.nw-android :deep(.nw-empty-cards) {
  padding: 34px var(--theme-space-5);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  gap: 6px;
}

.nw-root.nw-android :deep(.nw-empty-icon) {
  display: flex;
  width: 54px;
  height: 54px;
  margin-bottom: 2px;
  font-size: 24px;
  color: var(--theme-accent-primary);
  background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.1);
  border-radius: var(--theme-radius-round);
  align-items: center;
  justify-content: center;
}

.nw-root.nw-android :deep(.nw-empty-title) {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.nw-root.nw-android :deep(.nw-empty-desc) {
  font-size: 11.5px;
}

/* --- 详情页 --- */
.nw-root.nw-android .nw-right {
  display: none;
  padding: 0;
  overflow: visible;
  background: transparent;
  border: none;
  border-radius: 0;
}

.nw-root.nw-android.nw-detail-open .nw-left {
  display: none;
}

.nw-root.nw-android.nw-detail-open .nw-right {
  display: block;
}

.nw-root.nw-android :deep(.nw-detail-header) {
  display: flex;
  padding: var(--theme-space-5);
  margin: 0 0 var(--theme-space-4);

  /* 停用态不铺强调色光晕：奶油主题 accent 与 danger 同值，光晕留给运行态 */
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xxl);
  flex-direction: column;
  align-items: stretch;
  gap: var(--theme-space-3);
}

.nw-root.nw-android :deep(.nw-detail-header.nw-detail-hero-on) {
  background:
    radial-gradient(
      120% 90% at 100% 0%,
      rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.15),
      transparent 62%
    ),
    var(--theme-bg-card);
  border-color: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.28);
}

.nw-root.nw-android :deep(.nw-detail-title-row) {
  gap: 8px;
}

.nw-root.nw-android :deep(.nw-detail-title) {
  font-size: 21px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.2px;
}

.nw-root.nw-android :deep(.nw-badge) {
  padding: 3px 9px;
  font-size: 10.5px;
}

.nw-root.nw-android :deep(.nw-detail-actions) {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.nw-root.nw-android :deep(.nw-detail-actions .nw-detail-btn) {
  height: 42px;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 600;
}

/* --- 详情分组：标题在外，字段为分隔行 --- */
.nw-root.nw-android :deep(.nw-section) {
  margin-bottom: var(--theme-space-4);
}

.nw-root.nw-android :deep(.nw-section-title) {
  margin: 0 2px var(--theme-space-2);
  font-family: var(--theme-font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  color: var(--theme-text-secondary);
  text-transform: uppercase;
  gap: 0;
}

.nw-root.nw-android :deep(.nw-section-title::after) {
  display: none;
}

.nw-root.nw-android :deep(.nw-grid) {
  display: block;
  overflow: hidden;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
}

.nw-root.nw-android :deep(.nw-field),
.nw-root.nw-android :deep(.nw-field-full) {
  display: flex;
  padding: 12px 14px;
  background: transparent;
  border-top: 1px solid var(--theme-border-light);
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--theme-space-3);
}

.nw-root.nw-android :deep(.nw-field-full) {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}

.nw-root.nw-android :deep(.nw-grid > :first-child) {
  border-top: none;
}

.nw-root.nw-android :deep(.nw-label) {
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--theme-text-secondary);
  text-transform: none;
  flex-shrink: 0;
}

.nw-root.nw-android :deep(.nw-val) {
  min-width: 0;
  font-size: 12.5px;
  text-align: right;
  overflow-wrap: anywhere;
  word-break: normal;
}

.nw-root.nw-android :deep(.nw-field-full .nw-val) {
  text-align: left;
}

.nw-root.nw-android :deep(.nw-tag) {
  padding: 4px 10px;
  font-size: 11.5px;
}

.nw-root.nw-android :deep(.nw-route-filter) {
  width: calc(100% - 28px);
  margin: 12px 14px 0;
}

.nw-root.nw-android :deep(.nw-route-grid) {
  display: block;
  margin-top: 8px;
}

.nw-root.nw-android :deep(.nw-route-card) {
  display: flex;
  padding: 11px 14px;
  background: transparent;
  border: none;
  border-top: 1px solid var(--theme-border-light);
  border-radius: 0;
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--theme-space-3);
}

.nw-root.nw-android :deep(.nw-route-target) {
  font-family: var(--theme-font-body);
  font-size: 12.5px;
  font-weight: 500;
}

.nw-root.nw-android :deep(.nw-route-gw) {
  flex-shrink: 0;
}

.nw-root.nw-android :deep(.nw-route-empty) {
  display: block;
  padding: 12px 14px;
}

/* 加载/错误态也使用卡片容器 */
.nw-root.nw-android :deep(.nw-empty) {
  height: auto;
  padding: 44px var(--theme-space-5);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xxl);
  opacity: 1;
}

.cfm-msg {
  max-height: 260px;
  padding: var(--theme-space-1) 0 0;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  color: var(--theme-text-secondary);
  white-space: pre-line;
}

.cfm-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--theme-space-3);
  margin-top: var(--theme-space-4);
}

/* Android 横屏宽屏：列表与详情常驻左右分栏，两栏各自滚动 */
@media (width >= 700px) and (orientation: landscape) {
  .nw-root.nw-android {
    display: grid;
    grid-template-columns: minmax(240px, 300px) minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    align-items: stretch;
    gap: var(--theme-space-4);
  }

  /* 空列表：详情区没有可展示内容，空态卡片独占整行 */
  .nw-root.nw-android.nw-list-empty {
    grid-template-columns: minmax(0, 1fr);
  }

  .nw-root.nw-android.nw-list-empty .nw-right {
    display: none;
  }

  .nw-root.nw-android .nw-left,
  .nw-root.nw-android.nw-detail-open .nw-left {
    display: flex;
    width: auto;
    min-height: 0;
  }

  .nw-root.nw-android :deep(.nw-left-scroll) {
    display: block;
    min-height: 0;
    padding-right: 2px;
    overflow-y: auto;
    flex: 1;
  }

  .nw-root.nw-android .nw-right {
    display: block;
    min-height: 0;
    padding: var(--theme-space-4);
    overflow-y: auto;
    background: var(--theme-bg-card);
    border: 1px solid var(--theme-border);
    border-radius: var(--theme-radius-xl);
  }

  /* 右栏本身已是卡片，内部占位/加载态不再套一层卡片 */
  .nw-root.nw-android :deep(.nw-right > .nw-empty) {
    height: 100%;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 0;
  }
}
</style>
