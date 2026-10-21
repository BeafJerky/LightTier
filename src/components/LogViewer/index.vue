<template>
  <div class="lv-root">
    <!-- 工具栏：刷新 + 自动滚动 + 打开目录 -->
    <div class="lv-toolbar">
      <span class="lv-toolbar-info">{{ t('newConfig.viewLogDesc') }}</span>
      <div class="lv-toolbar-actions">
        <label class="lv-auto">
          <input type="checkbox" v-model="autoScroll" />
          <span class="lv-switch"><span class="lv-switch-slider"></span></span>
          <span>{{ t('newConfig.logAutoScroll') }}</span>
        </label>
        <button class="lv-btn" :disabled="loading" @click="refresh">{{
          t('newConfig.logRefresh')
        }}</button>
        <button class="lv-btn" @click="openLogsDir">{{ t('newConfig.openLogDir') }}</button>
      </div>
    </div>

    <!-- 面板主体 -->
    <div class="lv-panel" ref="panelRef" @scroll="onPanelScroll">
      <div v-if="!isTauri" class="lv-empty">{{ t('newConfig.logDesktopOnly') }}</div>
      <div v-else-if="loading && lines.length === 0" class="lv-empty">{{
        t('newCommon.loading')
      }}</div>
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
 * 数据来源：按 {configName}.{YYYY-MM-DD} 命名规则定位最新一份轮转日志，
 * 经 readTextReverse 逆序尾读仅取末尾 500 行；轮询间隔与 store.refreshInterval
 * 同源（不短于 3s），页面不可见时暂停，浏览器（非 Tauri）环境降级为提示文案。
 * 交互：error / warn 关键字行高亮着色；默认自动滚动到底部跟随最新日志，
 * 用户上翻后暂停跟随，滚回底部或手动刷新时恢复。
 */
import { getLogsDir, listFiles, openPath, readFileContent } from '@/utils/fileUtil'
import { pickLogTarget } from '@/utils/coreLogUtil'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { readTextReverse } from '@/utils/easyTierUtil'
import { LOG_PATH } from '@/constants/easytier'
import { useEasyTierStore } from '@/store/modules/easytier'
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
const autoScroll = ref(true)
const panelRef = ref<HTMLDivElement | null>(null)
// 用户上翻后暂停自动滚动跟随，滚回底部恢复
let userScrolledUp = false

const lines = computed(() =>
  content.value ? content.value.split('\n').filter((l) => l.trim() !== '') : []
)

// 关键字着色：error / warn 级别日志行分别标红、标黄
const lineClass = (line: string): string => {
  if (/error|ERROR|fatal/i.test(line)) return 'lv-line-error'
  if (/warn|WARN/i.test(line)) return 'lv-line-warn'
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

// 加载日志：定位最新轮转文件并逆序尾读 500 行（读取失败时清空展示）
const loadLog = async () => {
  if (!props.configName || !isTauri.value) return
  loading.value = true
  try {
    // 目标选择：v2.6.x 内核固定写 easytier.log；旧版内核按配置名写 {configName}.log（详见 coreLogUtil）
    const files = await listFiles(LOG_PATH)
    const target = pickLogTarget(files, props.configName)
    const text = (await readFileContent(`${LOG_PATH}/${target}`)) as string
    content.value = text ? readTextReverse(text, 500) : ''
  } catch {
    content.value = ''
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}

// 手动刷新：重置上翻标记后重新加载（让视图重新跟随底部）
const refresh = () => {
  userScrolledUp = false
  loadLog()
}

// 调用系统文件管理器打开日志目录（失败静默忽略）
const openLogsDir = async () => {
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
    userScrolledUp = false
    loadLog()
    startPolling()
  }
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
  cursor: pointer;
  user-select: none;
}

.lv-auto input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.lv-switch {
  position: relative;
  display: inline-block;
  width: 34px;
  height: 19px;
  flex-shrink: 0;
}

.lv-switch-slider {
  position: absolute;
  inset: 0;
  background: var(--theme-border);
  border-radius: 20px;
  transition: all 0.2s;
}

.lv-switch-slider::before {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  background: var(--theme-text-white, #fff);
  border-radius: 50%;
  content: '';
  box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
  transition: all 0.2s;
}

.lv-auto input:checked + .lv-switch .lv-switch-slider {
  background: var(--theme-color-success);
}

.lv-auto input:checked + .lv-switch .lv-switch-slider::before {
  transform: translateX(15px);
}

.lv-btn {
  padding: var(--theme-space-1) var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 11px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  cursor: pointer;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-pill);
  transition: all 0.2s;
}

.lv-btn:hover:not(:disabled) {
  color: var(--theme-accent-primary);
  border-color: var(--theme-accent-primary);
}

.lv-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
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
</style>
