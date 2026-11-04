<template>
  <div class="nd" :class="{ 'nd-android': isAndroidPlatform }">
    <div v-if="isQueued" class="nd-queue-bar">
      <span class="nd-queue-icon">⟳</span>
      <span class="nd-queue-text">
        {{ t('newOverview.queueStarting', { name: queueRunningName, left: queueLeftCount }) }}
      </span>
    </div>

    <template v-if="isAndroidPlatform">
      <!-- 安卓：连接状态优先，配置列表作为切换入口 -->
      <OverviewHero
        v-if="displayList.length > 0"
        :active="!!activeConfig"
        :virtual-ip="activeConfig?.virtualIp"
        :caption="quickConnectCaption"
        :name="heroConfig?.configFileName"
        :description="heroDescription"
        :node-count="activeSummary?.nodeCount"
        :avg-latency="activeSummary?.avgLatency"
        :running-count="runningCount"
        :stopped-count="stoppedCount"
        :total-count="totalCount"
        :disabled="isQueued"
        @stop="stopHero"
        @connect="connectHero"
        @monitor="openHeroMonitor"
        @config="openHeroConfig"
      />

      <section class="nda-config-section">
        <div class="nda-section-head">
          <h2 class="nda-section-title">{{ t('newOverview.myConfigs') }}</h2>
          <LtButton
            v-if="displayList.length > 0"
            variant="text"
            size="lg"
            circle
            class="nda-new-btn"
            :aria-label="t('newConfig.addConfig')"
            :title="t('newConfig.addConfig')"
            @click="goCreateConfig"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </LtButton>
        </div>

        <div class="nda-list lt-loading-host">
          <LoadingOverlay :show="easyTierStore.configListLoading" />
          <ConfigRow
            v-for="cfg in displayList"
            :key="cfg.configFileName"
            :cfg="cfg"
            :summary="summaryMap[cfg.configFileName]"
            :disabled="isQueued"
            @open="goConfigDetail"
            @toggle="toggleConfig"
          />

          <div
            v-if="displayList.length === 0 && !easyTierStore.configListLoading"
            class="nda-empty"
          >
            <span class="nda-empty-icon">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.7"
                aria-hidden="true"
              >
                <circle cx="6" cy="12" r="2.4" />
                <circle cx="18" cy="6" r="2.4" />
                <circle cx="18" cy="18" r="2.4" />
                <path d="M8.2 11.1l7.6-4.1M8.2 12.9l7.6 4.1" />
              </svg>
            </span>
            <p class="nda-empty-title">{{ t('newOverview.emptyNoConfig') }}</p>
            <span class="nda-empty-desc">{{ t('newOverview.emptyNoConfigDesc') }}</span>
            <LtButton variant="primary" size="lg" class="nda-empty-cta" @click="goCreateConfig">
              {{ t('newCommon.createConfig') }}
            </LtButton>
          </div>
        </div>
      </section>
    </template>

    <template v-else>
      <OverviewHeader :running="runningCount" :stopped="stoppedCount" :total="totalCount" />

      <div class="nd-block nd-block-configs">
        <div v-if="displayList.length > 0" class="nd-grid-head">
          <span class="nd-grid-count">{{ t('newOverview.configsTotal', { n: totalCount }) }}</span>
          <LtButton variant="secondary" size="sm" class="nd-add-btn" @click="goCreateConfig">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {{ t('newCommon.createConfig') }}
          </LtButton>
        </div>
        <div class="nd-grid lt-loading-host">
          <LoadingOverlay :show="easyTierStore.configListLoading" />
          <ConfigCard
            v-for="cfg in displayList"
            :key="cfg.configFileName"
            :cfg="cfg"
            :summary="summaryMap[cfg.configFileName]"
            @open="goConfigDetail"
            @start="startAction"
            @stop="stopAction"
            @monitor="goMonitorDetail"
          />
          <div v-if="displayList.length === 0 && !easyTierStore.configListLoading" class="nd-empty">
            <span class="nd-empty-icon">✦</span>
            <p class="nd-empty-title">{{ t('newOverview.emptyNoConfig') }}</p>
            <span class="nd-empty-desc">{{ t('newOverview.emptyNoConfigDesc') }}</span>
            <LtButton variant="primary" size="sm" class="nd-empty-cta" @click="goCreateConfig">
              {{ t('newCommon.createConfig') }}
            </LtButton>
          </div>
        </div>
      </div>
    </template>

    <!-- 自定义确认弹窗（替代原生 confirm） -->
    <CreamDialog v-model="cfmVisible" :title="cfmTitle" width="400px">
      <p class="nd-cfm-msg">{{ cfmMessage }}</p>
      <template #footer>
        <div class="nd-cfm-footer">
          <LtButton variant="ghost" @click="resolveConfirm(false)">
            {{ t('newCommon.cancel') }}
          </LtButton>
          <LtButton variant="primary" @click="resolveConfirm(true)">
            {{ t('newCommon.confirm') }}
          </LtButton>
        </div>
      </template>
    </CreamDialog>
  </div>
</template>

<script setup lang="ts">
/**
 * overview — 网络总览页（统计卡片 + 配置卡片网格）
 *
 * 核心职责：展示各配置的运行状态与监控摘要（5.2 monitorSummary），提供启动/停止入口。
 * 启动链路（与 config-view 的差异）：入队串行启动（useStartQueue）→ 端口冲突预检
 * → Android 单实例“停旧起新”→ autoMetric 记录 → 失败回滚兜底。
 * 自动运行：首次加载时按持久化设置（localStorage settings.autoRunNetwork）自动启动指定配置。
 * 平台差异：Android 卡片展示虚拟 IP（无 PID）；桌面展示 PID。
 */
import { useEasyTierStore } from '@/shared/store/easytier'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import CreamDialog from '@/shared/ui/CreamDialog.vue'
import LoadingOverlay from '@/shared/ui/LoadingOverlay.vue'
import { LtButton } from '@/shared/ui'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useI18n } from 'vue-i18n'
import { useStartQueue } from '@/features/instances/composables/useStartQueue'
import { isAndroid } from '@/shared/platform/platformUtil'
import { isTauri } from '@tauri-apps/api/core'
import { applyExitRouteFromFile } from '@/shared/platform/routeUtil'
import { useInstanceActions } from '@/shared/composables/useInstanceActions'
import { useRunningListSync } from '@/shared/composables/useRunningListSync'
import OverviewHeader from './OverviewHeader.vue'
import OverviewHero from './OverviewHero.vue'
import ConfigCard from './ConfigCard.vue'
import ConfigRow from './ConfigRow.vue'

defineOptions({ name: 'NewOverview' })

const easyTierStore = useEasyTierStore()
const router = useRouter()
// 启动队列：避免并发启动导致端口抢占与状态错乱
const { runningFileName, queueLength, isQueued, enqueue } = useStartQueue()

const { show: toast } = useCreamToast()
const { t } = useI18n()
const isDesktopRuntime = isTauri() && !isAndroid()
const isAndroidPlatform = isAndroid()
// 出口路由结果提示：仅主动启动/停止时提示，自动运行保持安静
const notifyExitRouteResult = (
  result: { ok: boolean; reason?: string; message?: string },
  auto: boolean
) => {
  if (result.ok) {
    if (!auto) toast(t('newConfig.exitRouteAutoApplied'), 'success')
    return
  }
  if (result.reason === 'precondition') {
    toast(t('newConfig.exitRoutePrecondition'), 'warning', 4000)
  } else if (result.reason === 'no-exit') {
    toast(t('newConfig.exitRouteNoExit'), 'warning')
  } else if (result.reason === 'command') {
    const detail = result.message ? `（${result.message}）` : ''
    toast(t('newConfig.exitRouteFail') + detail, 'error', 5000)
  }
}

// 自定义确认弹窗（替代原生 confirm，支持主题与键盘）
const cfmVisible = ref(false)
const cfmTitle = ref('')
const cfmMessage = ref('')
let cfmResolve: ((val: boolean) => void) | null = null
const showConfirm = (title: string, message: string): Promise<boolean> => {
  cfmTitle.value = title
  cfmMessage.value = message
  cfmVisible.value = true
  return new Promise<boolean>((resolve) => {
    cfmResolve = resolve
  })
}
const resolveConfirm = (val: boolean) => {
  cfmVisible.value = false
  cfmResolve?.(val)
  cfmResolve = null
}
watch(cfmVisible, (v) => {
  if (!v && cfmResolve) {
    cfmResolve(false)
    cfmResolve = null
  }
})

// 顶部统计：运行中 / 已停止 / 配置总数
const runningCount = computed(() => easyTierStore.runningList.length)
const stoppedCount = computed(
  () => easyTierStore.configList.length - easyTierStore.runningList.length
)
const totalCount = computed(() => easyTierStore.configList.length)

// 5.2：监控摘要快照（monitor 轮询成功后写入，无缓存显示兜底）
const summaryMap = computed(() => easyTierStore.monitorSummaryMap)

// 配置卡片数据：合并运行状态（pid / 虚拟 IP）与端口冲突标记
const displayList = computed(() => {
  const runningSet = new Set(easyTierStore.runningList.map((r) => r.configFileName))
  const runMap = new Map(easyTierStore.runningList.map((r) => [r.configFileName, r]))
  return easyTierStore.configList.map((c) => ({
    ...c,
    running: runningSet.has(c.configFileName),
    pid: runMap.get(c.configFileName)?.pid,
    // Android：实例虚拟 IP（桌面恒为 undefined）
    virtualIp: runMap.get(c.configFileName)?.virtualIp,
    // 端口冲突定位：非空时卡片描红闪烁（conflictMap 由启动预检写入）
    conflictPorts: conflictMap.value[c.configFileName] || []
  }))
})

// Android 单实例：同一时刻至多一个运行中配置，作为顶部连接卡片的主对象
const activeConfig = computed(() => displayList.value.find((c) => c.running) || null)
const lastUsedName = computed(() => easyTierStore.lastRunConfig?.configFileName || '')
// 未连接时的推荐配置：优先上次使用，其次列表首项
const quickConnectConfig = computed(() => {
  if (activeConfig.value) return activeConfig.value
  return (
    displayList.value.find((c) => c.configFileName === lastUsedName.value) ||
    displayList.value[0] ||
    null
  )
})
const heroConfig = computed(() => activeConfig.value || quickConnectConfig.value)
const quickConnectCaption = computed(() =>
  quickConnectConfig.value?.configFileName === lastUsedName.value
    ? t('newOverview.lastUsed')
    : t('newOverview.recommended')
)
const activeSummary = computed(() =>
  activeConfig.value ? summaryMap.value[activeConfig.value.configFileName] : undefined
)
const heroDescription = computed(() => {
  if (!activeConfig.value) return t('newOverview.connectHint')
  return activeSummary.value ? t('newOverview.connectedHint') : t('newOverview.summaryPending')
})

// 队列提示：正在启动的配置名与剩余排队数
const queueRunningName = computed(() => runningFileName.value.replace('.toml', ''))
const queueLeftCount = computed(() => Math.max(0, queueLength.value - 1))

// 端口冲突定位：configFileName → 冲突端口列表，驱动卡片描红闪烁（toast 生命周期内自动恢复）
const conflictMap = ref<Record<string, number[]>>({})
let conflictTimer: TimeoutHandle | null = null
// 清理冲突高亮定时器（重复冲突或页面卸载时调用，避免残留计时）
const clearConflictTimer = () => {
  if (conflictTimer) {
    clearTimeout(conflictTimer)
    conflictTimer = null
  }
}

const { updateRunningList } = useRunningListSync()

// 启动/停止链路（预检、Android 停旧起新、失败回滚与清理由 useInstanceActions 统一实现）
const { startInstance, stopInstance } = useInstanceActions({
  confirm: showConfirm,
  compatMessageKey: 'newOverview.compatBlockConfirm',
  portConflictCheck: true,
  onPortConflict: (occupied) => {
    conflictMap.value = { ...conflictMap.value, ...occupied }
    clearConflictTimer()
    conflictTimer = setTimeout(() => {
      conflictMap.value = {}
    }, 4000)
  },
  onAutoCompatSkip: (configFileName, issues) => {
    toast(t('newOverview.compatAutoRunSkipped', { name: configFileName, issues }), 'warning', 7000)
  },
  exitRouteGuard: () => isDesktopRuntime,
  afterStart: async (item, auto) => {
    // 概览页 / 冷启动自动运行：与其他入口一致地应用出口节点路由
    if (!isDesktopRuntime) return
    const routeResult = await applyExitRouteFromFile(item.configFileName, item.fileName)
    notifyExitRouteResult(routeResult, auto)
  }
})

// 运行时状态刷新（FAB 已负责文件加载）
const refreshRuntimeState = async () => {
  await updateRunningList()
}

// 启动配置：入队串行执行，冲突/失败项跳过，不阻塞剩余队列
// auto=true 时用于冷启动自动运行：兼容错误只提示并跳过，不弹确认框
const startAction = async (item: RunningItem, opts: { auto?: boolean } = {}) => {
  if (!item.fileName) return
  await enqueue(item.fileName, (fileName) =>
    startInstance({ ...item, fileName }, { auto: opts.auto })
  )
}

const stopAction = (item: RunningItem) => stopInstance(item)

const goConfigDetail = (item: RunningItem) => {
  router.push({ name: 'NewConfigDetailView', query: { name: item.configFileName } })
}
const goMonitorDetail = (_item: RunningItem) => {
  // Android 单实例：监控页自动跟随当前运行配置；桌面端在监控页选择实例
  router.push({ name: 'NewMonitor' })
}
const toggleConfig = (item: RunningItem & { running: boolean }) => {
  if (item.running) void stopAction(item)
  else void startAction(item)
}
const connectHero = () => {
  if (quickConnectConfig.value) void startAction(quickConnectConfig.value)
}
const stopHero = () => {
  if (activeConfig.value) void stopAction(activeConfig.value)
}
const openHeroMonitor = () => {
  if (activeConfig.value) goMonitorDetail(activeConfig.value)
}
const openHeroConfig = () => {
  if (quickConnectConfig.value) goConfigDetail(quickConnectConfig.value)
}

// 空态 CTA：Android 直接进入新增页，桌面打开配置页并自动弹出新增弹窗
const goCreateConfig = () => {
  router.push(isAndroidPlatform ? '/new/config-add' : '/new/config?create=1')
}

// ===== 生命周期 =====
onMounted(async () => {
  // 注册当前页刷新回调（悬浮快捷菜单调用）
  easyTierStore.registerPageRefresh(refreshRuntimeState)
  // 如果 store 尚未加载，先加载
  if (!easyTierStore.configListLoaded) {
    await easyTierStore.loadConfigFiles()
  }
  await updateRunningList()
  // 冷启动自动运行
  if (easyTierStore.isFirstLoad) {
    easyTierStore.isFirstLoad = false
    try {
      // 恢复持久化设置
      const savedAutoRun = localStorage.getItem('settings.autoRunNetwork')
      if (savedAutoRun !== null) {
        easyTierStore.autoRunNetworkSetting = savedAutoRun === 'true'
      }
      const savedConfigName = localStorage.getItem('settings.autoRunConfigName')
      if (savedConfigName) {
        easyTierStore.autoRunConfigName = savedConfigName
      }

      if (!easyTierStore.autoRunNetworkSetting) return
      // 如果已有运行中的配置，不自动运行
      if (easyTierStore.runningList.length > 0) return

      // 确定要自动运行的配置
      const targetFileName = easyTierStore.autoRunConfigName || easyTierStore.getLastRunConfigName()
      if (!targetFileName) return

      const target = easyTierStore.configList.find((c) => c.configFileName === targetFileName)
      if (target) {
        toast(t('newOverview.autoRunning'), 'success', 3000)
        await startAction(target, { auto: true })
      }
    } catch (e) {
      console.warn('[AutoRun] 自动运行失败:', e)
    }
  }
})

onUnmounted(() => {
  easyTierStore.clearPageRefresh()
  clearConflictTimer()
})
</script>

<style scoped lang="less">
@import url('./styles/page.less');
</style>
