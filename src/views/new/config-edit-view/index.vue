<template>
  <div class="nce-page">
    <EditDialog
      ref="editRef"
      v-model="visible"
      :config-name="configName"
      :toml-content="tomlContent"
      :dialog-mode="dialogMode"
      :existing-config-names="configNameList"
      inline
      @saved="handleSaved"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * config-edit-view — 配置编辑/新增二级页面（Android 专属入口，等价于桌面端的编辑弹窗）
 *
 * 包装 EditDialog 的 inline 模式：进入页面时按路由参数（name）加载 TOML，
 * 关闭面板统一 goBack 回退（保存成功/取消均走同一出口），保持移动端返回语义一致。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import EditDialog from '@/views/new/config-view/EditDialog.vue'
import { useEasyTierStore } from '@/store/modules/easytier'
import { useMockData } from '@/hooks/useMockData'
import { useCreamToast } from '@/hooks/useCreamToast'
import { CONFIG_PATH } from '@/constants/easytier'

defineOptions({ name: 'NewConfigEditView' })

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const easyTierStore = useEasyTierStore()
const { readFileContent, writeFileContent } = useMockData()
const { show: toast } = useCreamToast()
const editRef = ref<InstanceType<typeof EditDialog> | null>(null)

// 页面模式在挂载时捕获：路由回退后，在途异步流程（保存 toast）仍使用正确模式
const dialogMode: 'add' | 'edit' = route.name === 'NewConfigAddView' ? 'add' : 'edit'

const configName = ref('')
const tomlContent = ref('')
const visible = ref(false)
// 配置名列表（新增模式查重，与列表页弹窗入口一致）
const configNameList = computed(() => easyTierStore.configList.map((c) => c.configFileName))

// 返回列表页；无历史记录（直达）时回退到配置列表路由
const goBack = () => {
  if (window.history.state?.back) router.back()
  else router.replace('/new/config')
}

onMounted(async () => {
  if (dialogMode === 'add') {
    // 与列表页新增入口一致的初始模板（rpc_portal 自 v2.5.0 起不再写入配置）
    tomlContent.value = 'hostname = ""\ninstance_name = ""\ndhcp = true\n'
  } else {
    if (!easyTierStore.configListLoaded) await easyTierStore.loadConfigFiles()
    const name = String(route.query.name || '')
    const item = easyTierStore.configList.find((c) => c.configFileName === name)
    if (!item?.fileName) {
      goBack()
      return
    }
    try {
      tomlContent.value = (await readFileContent(`${CONFIG_PATH}/${item.fileName}`)) as string
      configName.value = name
    } catch {
      toast(t('newConfig.readFail'), 'error')
      goBack()
      return
    }
  }
  // 先关后开：触发 EditDialog 内部 watch(modelValue) 的打开初始化
  visible.value = true
})

// 面板请求关闭（取消按钮/保存后自动关闭）→ 统一回退入口
watch(visible, (v) => {
  if (!v) goBack()
})

// 物理返回键与页面返回都会经过路由守卫：有未保存修改时复用弹窗自身的放弃确认
onBeforeRouteLeave(async () => {
  const edit = editRef.value
  if (!edit || !edit.isDirty()) return true
  return edit.confirmDiscardOnLeave()
})

// 保存回调：写盘后按模式提示成功/失败（移动端由本页直接完成落盘）
// 覆盖前先备份；写盘成功才让 EditDialog 关闭，失败时保留内容
const handleSaved = async (name: string, content: string, done: (ok: boolean) => void) => {
  const isAdd = dialogMode === 'add'
  let backupFailed = false
  try {
    if (!isAdd) {
      try {
        const previous = (await readFileContent(`${CONFIG_PATH}/${name}.toml`)) as string
        await writeFileContent(`${CONFIG_PATH}/${name}.toml.bak`, previous)
      } catch {
        backupFailed = true
        throw new Error('backup failed')
      }
    }
    await writeFileContent(`${CONFIG_PATH}/${name}.toml`, content)
    toast(isAdd ? t('newCommon.addSuccess') : t('newCommon.saveSuccess'), 'success')
    await easyTierStore.loadConfigFiles()
    done(true)
  } catch {
    toast(
      isAdd
        ? t('newCommon.addFail')
        : backupFailed
          ? t('newConfig.backupFailed')
          : t('newCommon.saveFail'),
      'error'
    )
    done(false)
  }
}
</script>

<style scoped>
.nce-page {
  display: flex;
  height: 100%;
  flex-direction: column;
}

/* 全屏编辑页：去掉内联卡片的外框，页面本身即编辑容器 */
.nce-page :deep(.cd-dialog-inline) {
  background: var(--theme-bg);
  border: none;
  border-radius: 0;
}

.nce-page :deep(.cd-body) {
  padding: var(--theme-space-3) var(--theme-space-4) var(--theme-space-2);
}

/* --- 顶部配置名与模板区 --- */
.nce-page :deep(.ed-name-bar) {
  display: grid;
  padding: 14px;
  margin-bottom: var(--theme-space-3);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: center;
  gap: 8px;
}

.nce-page :deep(.ed-name-bar .ed-form-label) {
  grid-column: 1 / -1;
}

.nce-page :deep(.ed-name-bar .ed-name-input) {
  height: 42px;
  grid-column: 1 / -1;
}

.nce-page :deep(.ed-name-error) {
  width: auto;
  font-size: 11.5px;
  grid-column: 1 / -1;
}

.nce-page :deep(.ed-template-select) {
  min-width: 0;
}

.nce-page :deep(.ed-template-trigger) {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  font-size: 12.5px;
  border: 1px solid var(--theme-border);
  border-radius: 10px;
  box-sizing: border-box;
  justify-content: space-between;
}

.nce-page :deep(.ed-import-btn) {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  font-size: 12.5px;
  border: 1px dashed var(--theme-border);
  border-radius: 10px;
  box-sizing: border-box;
  justify-content: center;
}

/* --- 编辑模式分段控件 --- */
.nce-page :deep(.ed-tabs) {
  gap: 8px;
  margin-bottom: var(--theme-space-3);
  flex-flow: row wrap;
}

.nce-page :deep(.ed-tabs-track) {
  display: flex;
  width: 100%;
  padding: 4px;
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border-light);
  border-radius: var(--theme-radius-pill);
  box-sizing: border-box;
  gap: 4px;
}

.nce-page :deep(.ed-tab) {
  height: 36px;
  padding: 0 12px;
  font-size: 12.5px;
  font-weight: 600;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--theme-radius-pill);
  flex: 1;
}

.nce-page :deep(.ed-tab.active) {
  color: var(--theme-text-primary);
  background: var(--theme-bg-card);
  border-color: var(--theme-border);
  box-shadow: var(--theme-shadow-sm);
}

.nce-page :deep(.ed-core-target) {
  width: 100%;
  padding: 0 2px;
  margin-left: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--theme-text-secondary);
  text-align: right;
  background: transparent;
  border-radius: 0;
}

/* --- 表单卡片 --- */
.nce-page :deep(.ed-form-scroll) {
  padding-right: 0;
}

.nce-page :deep(.ed-form-section),
.nce-page :deep(.ed-adv-collapse) {
  padding: 14px;
  margin-bottom: var(--theme-space-3);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
}

.nce-page :deep(.ed-form-section-title) {
  padding: 0;
  margin-bottom: 10px;
  font-family: var(--theme-font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
  border-bottom: none;
}

.nce-page :deep(.ed-form-grid) {
  grid-template-columns: 1fr;
  gap: 12px;
}

.nce-page :deep(.ed-form-field) {
  gap: 6px;
}

.nce-page :deep(.ed-form-label) {
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--theme-text-secondary);
  text-transform: none;
}

.nce-page :deep(.ed-form-input) {
  height: 42px;
  padding: 0 12px;
  font-size: 13.5px;
  background: var(--theme-bg);
  border: 1px solid var(--theme-border);
  border-radius: 10px;
}

.nce-page :deep(.ed-form-input:focus) {
  background: var(--theme-bg-card);
  border-color: var(--theme-accent-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--theme-accent-primary) 12%, transparent);
}

.nce-page :deep(.ed-form-switch) {
  height: 34px;
  padding: 0 14px;
  font-size: 12px;
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border-light);
}

.nce-page :deep(.ed-form-switch.on) {
  border-color: color-mix(in srgb, var(--theme-color-success) 26%, transparent);
}

/* 标签型字段行 */
.nce-page :deep(.ed-tag-row) {
  gap: 8px;
}

.nce-page :deep(.ed-tag-del) {
  width: 40px;
  height: 40px;
  background: var(--theme-bg);
  border: 1px solid var(--theme-border);
  border-radius: 10px;
  flex-shrink: 0;
}

.nce-page :deep(.ed-tag-input-short) {
  width: 108px;
}

.nce-page :deep(.ed-tag-add) {
  width: 100%;
  height: 40px;
  font-size: 12.5px;
  border: 1px dashed var(--theme-border);
  border-radius: 10px;
  align-self: stretch;
}

/* 高级选项折叠卡 */
.nce-page :deep(.ed-adv-summary) {
  margin-bottom: 0;
}

.nce-page :deep(.ed-adv-collapse[open] .ed-adv-summary) {
  margin-bottom: 12px;
}

.nce-page :deep(.ed-adv-collapse .ed-compat-note) {
  margin-top: 12px;
}

/* 安全模式卡 */
.nce-page :deep(.ed-secure-section) {
  padding-top: 14px;
  border-top: 1px solid var(--theme-border);
}

.nce-page :deep(.ed-secure-head) {
  padding-bottom: 0;
  margin-bottom: 12px;
  border-bottom: none;
}

.nce-page :deep(.ed-secure-title) {
  font-family: var(--theme-font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.nce-page :deep(.ed-locked-collapse) {
  padding: 14px;
  border-radius: var(--theme-radius-lg, 14px);
}

/* 兼容提示与代码模式 */
.nce-page :deep(.ed-compat-banner),
.nce-page :deep(.ed-code-error) {
  padding: 11px 13px;
  border-radius: var(--theme-radius-lg, 14px);
}

.nce-page :deep(.ed-code-wrap) {
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
}

/* --- 固定底部操作栏 --- */
.nce-page :deep(.cd-footer) {
  padding: 10px var(--theme-space-4) calc(10px + var(--lt-safe-area-bottom, 0px));
  background: var(--theme-bg);
  border-top: 1px solid var(--theme-border-light);
}

.nce-page :deep(.ed-footer-info) {
  display: none;
}

.nce-page :deep(.ed-footer-btns) {
  display: grid;
  width: 100%;
  grid-template-columns: 1fr 1.35fr;
  gap: 10px;
}

.nce-page :deep(.ed-btn) {
  height: 44px;
  padding: 0 12px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: var(--theme-radius-pill);
}

.nce-page :deep(.ed-btn-cancel) {
  color: var(--theme-text-secondary);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
}

.nce-page :deep(.ed-btn-primary) {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary);
  border: none;
}
</style>
