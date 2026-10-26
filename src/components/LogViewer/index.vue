<template>
  <div class="lv-root">
    <!-- 工具栏：刷新 + 自动滚动 + 打开目录 -->
    <div class="lv-toolbar">
      <span class="lv-toolbar-info">{{ t('newConfig.viewLogDesc') }}</span>
      <div class="lv-toolbar-actions">
        <label class="lv-auto">
          <LtSwitch v-model="autoScroll" size="sm" :aria-label="t('newConfig.logAutoScroll')" />
          <span>{{ t('newConfig.logAutoScroll') }}</span>
        </label>
        <LtButton variant="secondary" size="sm" :disabled="loading" @click="refresh">{{
          t('newConfig.logRefresh')
        }}</LtButton>
        <LtButton variant="secondary" size="sm" @click="openLogsDir">{{
          t('newConfig.openLogDir')
        }}</LtButton>
      </div>
    </div>

    <!-- 面板主体 -->
    <div class="lv-panel" ref="panelRef" @scroll="onPanelScroll">
      <div v-if="!isTauri" class="lv-empty">{{ t('newConfig.logDesktopOnly') }}</div>
      <div v-else-if="loading && lines.length === 0" class="lv-empty">{{
        t('newCommon.loading')
      }}</div>
      <div v-else-if="loadError" class="lv-empty lv-empty-error">{{ loadError }}</div>
      <div v-else-if="lines.length === 0" class="lv-empty">{{ t('newConfig.logEmpty') }}</div>
      <div v-else class="lv-lines">
        <div v-for="(line, idx) in lines" :key="idx" class="lv-line" :class="lineClass(line)">{{
          line
        }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * LogViewer — 内联日志查看器（嵌入配置详情等页面）
 *
 * 数据来源：优先读取按配置隔离的 logs/kernel/<scope>/，回退旧版共享 logs/
 * 目录（只读兼容）。仅取末尾 500 行并按时间正序展示；轮询间隔与
 * store.refreshInterval 同源（不短于 3s），页面不可见时暂停，浏览器
 * （非 Tauri）环境降级为提示文案。
 * 交互：按行首级别标记 error / warn 行；默认自动滚动到底部跟随最新日志，
 * 用户上翻后暂停跟随，滚回底部或手动刷新时恢复；无文件时展示明确空态。
 */
import {
  getKernelLogsDir,
  getLogsDir,
  openPath,
  readFileContent,
  resolveKernelLogFile
} from '@/utils/fileUtil'
import { formatLogLineTime, getLogLineLevel } from '@/utils/coreLogUtil'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { readTextTail } from '@/utils/easyTierUtil'
import { useEasyTierStore } from '@/store/modules/easytier'
import { LtButton, LtSwitch } from '@/components/ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

defineOptions({ name: 'LogViewer' })

const props = defineProps<{
  configName: string
}>()

const { t } = useI18n()
const easyTierStore = useEasyTierStore()

// 非 Tauri 环境优雅降级（浏览器预览）；withGlobalTauri 已关闭，用 isTauri() 检测
const isTauri = computed(() => {
  try {
    return isTauriRuntime()
  } catch {
    return false
  }
})

const content = ref('')
const loading = ref(false)
const loadError = ref('')
const autoScroll = ref(true)
const panelRef = ref<HTMLDivElement | null>(null)
// 用户上翻后暂停自动滚动跟随，滚回底部恢复
let userScrolledUp = false

const lines = computed(() =>
  content.value
    ? content.value
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map(formatLogLineTime)
    : []
)

// 按行首级别着色：error/fatal 标红、warn 标黄（不再匹配正文中的同名单词）
const lineClass = (line: string): string => {
  const level = getLogLineLevel(line)
  if (level === 'error') return 'lv-line-error'
  if (level === 'warn') return 'lv-line-warn'
  return ''
}

// 距底部超过 40px 视为用户已上翻（暂停自动滚动跟随）
const onPanelScroll = () => {
  const panel = panelRef.value
  if (!panel) return
  userScrolledUp = panel.scrollHeight - panel.scrollTop - panel.clientHeight > 40
}

// 滚动到底部（等待 DOM 更新后执行；关闭自动滚动或用户上翻时跳过）
const scrollToBottom = async () => {
  if (!autoScroll.value || userScrolledUp) return
  await nextTick()
  const panel = panelRef.value
  if (panel) panel.scrollTop = panel.scrollHeight
}

// 加载日志：定位当前配置的日志文件，按时间正序尾读末尾 500 行
// 无文件与读取失败分别给出明确空态，不再静默显示为“日志为空”
// 请求序号：快速切换配置/轮询重叠时，旧请求返回后不得覆盖新配置的内容
let loadSeq = 0
const loadLog = async () => {
  // 先自增：配置名清空时也要让在飞请求作废
  const seq = ++loadSeq
  if (!props.configName || !isTauri.value) return
  const configName = props.configName
  loading.value = true
  try {
    const location = await resolveKernelLogFile(configName)
    if (seq !== loadSeq) return
    if (!location) {
      content.value = ''
      loadError.value = t('newConfig.logNotReady')
      return
    }
    const text = (await readFileContent(`${location.dir}/${location.file}`)) as string
    if (seq !== loadSeq) return
    content.value = text ? readTextTail(text, 500) : ''
    loadError.value = ''
  } catch {
    if (seq !== loadSeq) return
    content.value = ''
    loadError.value = t('newConfig.logReadFailed')
  } finally {
    if (seq === loadSeq) {
      loading.value = false
      await scrollToBottom()
    }
  }
}

// 手动刷新：重置上翻标记后重新加载（让视图重新跟随底部）
const refresh = () => {
  userScrolledUp = false
  loadLog()
}

// 调用系统文件管理器打开当前配置的日志目录（失败回退 logs 根目录）
const openLogsDir = async () => {
  try {
    if (await openPath(await getKernelLogsDir(props.configName))) return
  } catch {
    /* 目录创建失败，回退根目录 */
  }
  try {
    await openPath(await getLogsDir())
  } catch {
    /* ignore */
  }
}

// 轮询：与 store.refreshInterval 同源（不短于 3s）
let pollTimer: ReturnType<typeof setInterval> | null = null
const startPolling = () => {
  stopPolling()
  const interval = Math.max(3, easyTierStore.refreshInterval || 3) * 1000
  pollTimer = setInterval(() => {
    if (document.hidden) return
    loadLog()
  }, interval)
}
const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// 5.15：页面不可见时暂停轮询
const visibilityHandler = () => {
  if (document.hidden) {
    stopPolling()
  } else {
    startPolling()
  }
}

// 切换配置：清空旧内容、重置滚动状态并立即重载 + 重启轮询
watch(
  () => props.configName,
  () => {
    content.value = ''
    loadError.value = ''
    userScrolledUp = false
    loadLog()
    startPolling()
  }
)

// 设置页调整刷新频率后立即生效（startPolling 打开时只读取一次）
watch(
  () => easyTierStore.refreshInterval,
  () => startPolling()
)

// 行内容变化后尝试跟随滚动到底部
watch(lines, () => scrollToBottom())

onMounted(() => {
  loadLog()
  startPolling()
  document.addEventListener('visibilitychange', visibilityHandler)
})

onUnmounted(() => {
  stopPolling()
  document.removeEventListener('visibilitychange', visibilityHandler)
})
</script>

<style scoped>
.lv-root {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-2);
}

.lv-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--theme-space-2);
  padding: var(--theme-space-3) var(--theme-space-4);
  background: var(--theme-bg-tag);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
}

.lv-toolbar-info {
  font-size: 12px;
  color: var(--theme-text-muted);
}

.lv-toolbar-actions {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
}

.lv-auto {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
  font-size: 11px;
  color: var(--theme-text-secondary);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.lv-panel {
  height: 220px;
  padding: var(--theme-space-3) var(--theme-space-4);
  overflow-y: auto;
  font-family: 'Cascadia Code', Consolas, 'Courier New', monospace;
  font-size: 11.5px;
  line-height: 1.6;
  background: var(--theme-bg);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
  box-sizing: border-box;
}

.lv-empty {
  display: flex;
  height: 100%;
  font-family: var(--theme-font-body);
  font-size: 12px;
  color: var(--theme-text-muted);
  align-items: center;
  justify-content: center;
}

.lv-empty-error {
  color: var(--theme-color-danger);
}

.lv-lines {
  display: flex;
  flex-direction: column;
}

.lv-line {
  color: var(--theme-text-secondary);
  word-break: break-all;
  white-space: pre-wrap;
}

.lv-line-error {
  color: var(--theme-color-danger);
}

.lv-line-warn {
  color: var(--theme-color-warning);
}

@media (width <= 480px) {
  .lv-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .lv-toolbar-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}
</style>
