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
  background: var(--theme-bg-card);
  border: none;
  border-radius: 0;
}
</style>
