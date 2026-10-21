<template>
  <div class="nw-root" :class="{ 'nw-detail-open': !!selectedDetail }">
    <!-- 左侧配置列表 -->
    <div class="nw-left">
      <div class="nw-left-header">
        <div class="nw-left-top">
          <div class="nw-left-label">{{ t('newConfig.configList') }}</div>
          <div class="nw-left-btns">
            <button
              type="button"
              class="nw-add-btn"
              @click="openAdd"
              :title="t('newConfig.addConfig')"
              :aria-label="t('newConfig.addConfig')"
            >
              +
            </button>
          </div>
        </div>
        <!-- 搜索固定在标题栏，不随列表滚动 -->
        <div v-if="easyTierStore.configList.length > 0" class="nw-search">
          <input
            v-model="configSearch"
            type="search"
            class="nw-search-input"
            :placeholder="t('newCommon.searchConfig')"
            :aria-label="t('newCommon.searchConfig')"
            @keydown.esc="configSearch = ''"
          />
          <button
            v-if="configSearch"
            type="button"
            class="nw-search-clear"
            :title="t('newCommon.clearSearch')"
            :aria-label="t('newCommon.clearSearch')"
            @click="configSearch = ''"
          >
            ×
          </button>
        </div>
      </div>
      <div class="nw-left-scroll lt-loading-host">
        <LoadingOverlay :show="easyTierStore.configListLoading" />
        <div
          v-for="item in filteredConfigList"
          :key="item.configFileName"
          class="nw-card"
          :class="{ active: selectedConfig?.configFileName === item.configFileName }"
          @click="selectConfig(item)"
        >
          <div class="nw-card-top">
            <div class="nw-card-status">
              <span class="nw-dot" :class="getRunning(item) ? 'on' : 'off'"></span>
              <span class="nw-status-text">{{
                getRunning(item) ? t('newCommon.running') : t('newCommon.stopped')
              }}</span>
            </div>
            <span v-if="getRunningItem(item)?.pid" class="nw-card-pid"
              >PID {{ getRunningItem(item)?.pid }}</span
            >
            <span v-else-if="getRunningItem(item)?.virtualIp" class="nw-card-pid"
              >IP {{ getRunningItem(item)?.virtualIp }}</span
            >
          </div>
          <div class="nw-card-name">{{ item.configFileName }}</div>
          <div class="nw-card-sub">{{ item.fileName }}</div>
          <div class="nw-card-actions" @click.stop>
            <!-- 单一生命周期主操作：按状态在运行/停止之间切换 -->
            <button
              type="button"
              class="nw-btn"
              :class="getRunning(item) ? 'nw-btn-stop' : 'nw-btn-run'"
              @click="getRunning(item) ? stopAction(item) : startAction(item)"
              >{{ getRunning(item) ? t('newCommon.stop') : t('newCommon.run') }}</button
            >
          </div>
        </div>
        <div
          v-if="easyTierStore.configList.length === 0 && !easyTierStore.configListLoading"
          class="nw-empty-cards"
        >
          <span class="nw-empty-icon">✦</span>
          <p class="nw-empty-title">{{ t('newConfig.emptyNoConfig') }}</p>
          <span class="nw-empty-desc">{{ t('newConfig.emptyHint') }}</span>
          <button type="button" class="nw-empty-cta" @click="openAdd">
            {{ t('newCommon.createConfig') }}
          </button>
        </div>
        <!-- 搜索无结果：与“无配置”区分，提供清除入口 -->
        <div
          v-else-if="filteredConfigList.length === 0 && !easyTierStore.configListLoading"
          class="nw-empty-cards"
        >
          <span class="nw-empty-icon">⌕</span>
          <p class="nw-empty-title">{{ t('newCommon.noSearchResult') }}</p>
          <button type="button" class="nw-empty-cta" @click="configSearch = ''">
            {{ t('newCommon.clearSearch') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 右侧详情面板：宽屏常驻；窄屏为 master-detail 的详情态（列表隐藏） -->
    <div class="nw-right" v-if="selectedDetail">
      <div class="nw-detail-header">
        <div class="nw-detail-title-row">
          <button class="nw-back-btn" @click="closeDetail">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {{ t('newCommon.back') }}
          </button>
          <h3 class="nw-detail-title">{{ selectedConfig?.configFileName }}</h3>
          <span class="nw-badge" :class="selectedRunning ? 'on' : 'off'">
            {{ selectedRunning ? '● ' + t('newCommon.running') : '○ ' + t('newCommon.stopped') }}
          </span>
          <span v-if="detailState === 'demo'" class="nw-badge nw-badge-demo">{{
            t('newCommon.demoData')
          }}</span>
        </div>
        <div class="nw-detail-actions">
          <button type="button" class="nw-btn-lg nw-btn-edit" @click="openEdit">{{
            t('newCommon.edit')
          }}</button>
          <!-- 窄屏列表不可见，详情保留唯一的上下文生命周期操作；宽屏由列表卡片承担 -->
          <button
            type="button"
            class="nw-btn-lg nw-detail-lifecycle"
            :class="selectedRunning ? 'nw-btn-kill' : 'nw-btn-start'"
            @click="
              selectedConfig &&
              (selectedRunning ? stopAction(selectedConfig) : startAction(selectedConfig))
            "
            >{{ selectedRunning ? t('newCommon.stop') : t('newCommon.run') }}</button
          >
          <button type="button" class="nw-btn-lg nw-btn-del" @click="deleteSelectedConfig">{{
            t('newCommon.delete')
          }}</button>
        </div>
      </div>

      <div class="nw-section"
        ><div class="nw-section-title">{{ t('newConfig.mainParams') }}</div>
        <div class="nw-grid">
          <div class="nw-field"
            ><span class="nw-label">{{ t('newConfig.hostname') }}</span
            ><span class="nw-val">{{ selectedDetail.hostname || '—' }}</span></div
          >
          <div class="nw-field"
            ><span class="nw-label">{{ t('newConfig.instanceName') }}</span
            ><span class="nw-val">{{ selectedDetail.instance_name || '—' }}</span></div
          >
          <div class="nw-field"
            ><span class="nw-label">{{ t('newConfig.networkName') }}</span
            ><span class="nw-val">{{
              selectedDetail.network_identity?.network_name || '—'
            }}</span></div
          >
          <div class="nw-field"
            ><span class="nw-label">DHCP</span
            ><span class="nw-val">{{
              selectedDetail.dhcp ? t('newConfig.dhcpEnabled') : t('newConfig.dhcpDisabled')
            }}</span></div
          >
          <div class="nw-field"
            ><span class="nw-label">{{ t('newConfig.rpcPortal') }}</span
            ><span class="nw-val">{{ selectedDetail.rpc_portal || '—' }}</span></div
          >
          <div class="nw-field"
            ><span class="nw-label">{{ t('newCommon.version') }}</span
            ><span class="nw-val">{{ (selectedDetail as any)?.version || '—' }}</span></div
          >
        </div>
      </div>

      <div class="nw-section"
        ><div class="nw-section-title">{{ t('newConfig.networkConn') }}</div>
        <div class="nw-grid">
          <div class="nw-field-full"
            ><span class="nw-label">{{ t('newConfig.listenAddr') }}</span>
            <div class="nw-tags" v-if="selectedDetail.listeners?.length">
              <span class="nw-tag" v-for="l in selectedDetail.listeners" :key="l">{{
                l
              }}</span> </div
            ><span class="nw-val" v-else>—</span>
          </div>
          <div class="nw-field-full"
            ><span class="nw-label">{{ t('newConfig.peerNodes') }}</span>
            <div class="nw-tags" v-if="selectedDetail.peer?.length">
              <span class="nw-tag" v-for="p in selectedDetail.peer" :key="p.uri">{{
                p.uri
              }}</span> </div
            ><span class="nw-val" v-else>—</span>
          </div>
          <div class="nw-field-full"
            ><span class="nw-label">{{ t('newConfig.exitNodes') }}</span>
            <div class="nw-tags" v-if="selectedDetail.exit_nodes?.length">
              <span class="nw-tag nw-tag-exit" v-for="e in selectedDetail.exit_nodes" :key="e">{{
                e
              }}</span> </div
            ><span class="nw-val" v-else>—</span>
          </div>
        </div>
      </div>

      <div class="nw-section"
        ><div class="nw-section-title">{{ t('newConfig.routes') }}</div>
        <div class="nw-grid"
          ><div class="nw-field-full">
            <template v-if="selectedDetail.routes?.length">
              <input
                v-model="routeFilter"
                class="nw-route-filter"
                :placeholder="t('newConfig.routeFilterPlaceholder')"
              />
              <div v-if="filteredRoutes.length" class="nw-route-grid">
                <div class="nw-route-card" v-for="r in filteredRoutes" :key="r">
                  <span class="nw-route-target">{{ r }}</span>
                  <span class="nw-route-gw">{{ t('newConfig.routeGwStatic') }}</span>
                </div>
              </div>
              <span v-else class="nw-route-empty">{{ t('newConfig.noRoutes') }}</span>
            </template>
            <span class="nw-val" v-else>—</span>
          </div></div
        >
      </div>

      <div class="nw-section" v-if="selectedDetail.flags"
        ><div class="nw-section-title">{{ t('newConfig.flagsSection') }}</div>
        <div class="nw-grid">
          <div class="nw-field" v-for="(val, key) in selectedDetail.flags" :key="key">
            <span class="nw-label">{{ flagLabel(key) }}</span>
            <span class="nw-val">{{
              typeof val === 'boolean' ? (val ? '✓' : '✗') : val || '—'
            }}</span>
          </div>
        </div>
      </div>

      <!-- 5.9：退出节点路由（配置级开关，仅 Tauri 桌面端） -->
      <div class="nw-section"
        ><div class="nw-section-title">{{ t('newConfig.exitRoute') }}</div>
        <div class="nw-svc-bar">
          <div class="nw-svc-status">
            <span
              class="nw-svc-dot"
              :class="{
                'svc-running': exitRouteStatus === 'enabled',
                'svc-stopped': exitRouteStatus === 'disabled',
                'svc-uninstalled': exitRouteStatus === 'desktop'
              }"
            ></span>
            <span class="nw-svc-text">{{ exitRouteStatusText }}</span>
          </div>
          <div class="nw-svc-actions">
            <template v-if="isTauri">
              <button
                class="nw-btn-sm nw-btn-svc-start"
                :disabled="exitRouteFlag || isExitRouteBusy"
                @click="toggleExitRoute"
                >{{ t('newConfig.exitRouteEnable') }}</button
              >
              <button
                class="nw-btn-sm nw-btn-svc-stop"
                :disabled="!exitRouteFlag || isExitRouteBusy"
                @click="toggleExitRoute"
                >{{ t('newConfig.exitRouteDisable') }}</button
              >
              <button
                class="nw-btn-sm nw-btn-svc-stop"
                :disabled="isExitRouteBusy"
                @click="openRouteCheck"
                >{{ t('newConfig.exitRouteCheck') }}</button
              >
            </template>
          </div>
        </div>
        <p class="nw-svc-desc">{{ t('newConfig.exitRouteDesc') }}</p>
      </div>

      <!-- 日志（5.3：内联日志查看器，工具栏含刷新/自动滚动/打开目录） -->
      <div class="nw-section"
        ><div class="nw-section-title">{{ t('newConfig.logs') }}</div>
        <LogViewer :config-name="selectedConfig?.configFileName || ''" />
      </div>

      <!-- 服务管理（Windows 服务专属；Android 隐藏） -->
      <div v-if="!isAndroidPlatform" class="nw-section"
        ><div class="nw-section-title">{{ t('newConfig.serviceMgmt') }}</div>
        <div class="nw-svc-bar">
          <div class="nw-svc-status">
            <span
              class="nw-svc-dot"
              :class="{
                'svc-running': currentServiceStatus === 'running',
                'svc-stopped': currentServiceStatus === 'stopped',
                'svc-uninstalled': currentServiceStatus === 'notInstalled',
                'svc-checking': !currentServiceStatus
              }"
            ></span>
            <span class="nw-svc-text">{{
              currentServiceStatus
                ? mapServiceStatus(currentServiceStatus)
                : t('newCommon.checking')
            }}</span>
          </div>
          <div class="nw-svc-actions">
            <template v-if="currentServiceStatus === 'notInstalled'">
              <button class="nw-btn-lg nw-btn-svc-install" @click="openServiceDialog">{{
                t('newConfig.installService')
              }}</button>
            </template>
            <template v-else>
              <button
                class="nw-btn-sm nw-btn-svc-start"
                :disabled="currentServiceStatus === 'running'"
                @click="handleStartService"
                >{{ t('newCommon.start') }}</button
              >
              <button
                class="nw-btn-sm nw-btn-svc-stop"
                :disabled="currentServiceStatus !== 'running'"
                @click="handleStopService"
                >{{ t('newCommon.stop') }}</button
              >
              <button class="nw-btn-sm nw-btn-svc-uninstall" @click="handleUninstallService">{{
                t('newConfig.uninstall')
              }}</button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 详情加载中 / 读取失败：不使用演示数据掩盖真实错误 -->
    <div class="nw-right" v-else-if="selectedConfig">
      <div class="nw-detail-header">
        <div class="nw-detail-title-row">
          <button class="nw-back-btn" @click="closeDetail">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {{ t('newCommon.back') }}
          </button>
          <h3 class="nw-detail-title">{{ selectedConfig.configFileName }}</h3>
        </div>
      </div>
      <div v-if="detailState === 'loading'" class="nw-empty" aria-live="polite">
        <p>{{ t('newCommon.loading') }}</p>
      </div>
      <div v-else class="nw-empty nw-detail-error" role="alert">
        <p class="nw-detail-error-title">{{ detailErrorTitle }}</p>
        <p v-if="detailError?.message" class="nw-detail-error-desc">{{ detailError.message }}</p>
        <div class="nw-detail-error-actions">
          <button class="nw-btn-lg nw-btn-edit" @click="retryDetail">{{
            t('newCommon.retry')
          }}</button>
          <button v-if="isTauri" class="nw-btn-lg" @click="openConfigDir">{{
            t('newConfig.openConfigDir')
          }}</button>
        </div>
      </div>
    </div>

    <div class="nw-right" v-else>
      <div class="nw-empty"
        ><span class="nw-empty-icon">✦</span><p>{{ t('newConfig.selectConfig') }}</p></div
      >
    </div>
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
        <button class="nw-btn-cfm nw-btn-cfm-cancel" @click="resolveConfirm(false)">{{
          t('newCommon.cancel')
        }}</button>
        <button class="nw-btn-cfm nw-btn-cfm-ok" @click="resolveConfirm(true)">{{
          t('newCommon.confirm')
        }}</button>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * config-view — 配置管理主页面（配置列表 + 详情面板，master-detail 布局）
 *
 * 核心流程：加载配置列表 → 选中卡片解析 TOML 详情 → 启动/停止内核实例 →
 * 退出节点路由开关（桌面专属，[lighttier].exit_route_enabled 驱动）与 Windows 服务管理。
 * 平台差异：
 * - 桌面：编辑/新增走弹窗（EditDialog / ServiceDialog），宽屏左右分栏并默认选中上次运行配置；
 * - Android：编辑/新增跳二级路由页面，窄屏列表与详情互斥展示，内核在应用进程内运行
 *   （无 pid），同一时刻仅一个实例，启动前二次确认“停旧起新”；
 * - Windows 服务面板与退出节点路由仅非 Android 环境展示；详情读取失败时回退内置演示数据。
 */
import { CONFIG_PATH } from '@/constants/easytier'
import {
  SECURITY_FIELD_DEFS,
  ADVANCED_FLAG_DEFS,
  ADVANCED_TOP_SWITCH_DEFS,
  ADVANCED_TOP_TEXT_DEFS
} from '@/constants/defaultData'
import { useEasyTierStore } from '@/store/modules/easytier'
import * as toml from 'smol-toml'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useCreamToast } from '@/hooks/useCreamToast'
import { useMockData } from '@/hooks/useMockData'
import * as coreApi from '@/utils/coreApi'
import { isAndroid } from '@/utils/platformUtil'
import { isTauri as isTauriRuntime } from '@tauri-apps/api/core'
import { resourceDir, join } from '@tauri-apps/api/path'
import { openPath } from '@/utils/fileUtil'
import CreamDialog from '@/components/CreamDialog/index.vue'
import LoadingOverlay from '@/components/LoadingOverlay/index.vue'
import EditDialog from './EditDialog.vue'
import ServiceDialog from './ServiceDialog.vue'
import LogViewer from '@/components/LogViewer/index.vue'
import { useAutoMetric } from '@/hooks/useAutoMetric'
import {
  setExitRoute,
  clearExitRoute,
  checkExitRouteResidue,
  cleanExitRouteResidue,
  applyExitRouteFromFile
} from '@/utils/routeUtil'
import { useTrendBuffer } from '@/hooks/useTrendBuffer'
import {
  isExitRouteEnabled,
  setExitRouteEnabled,
  migrateLightTierConfig
} from '@/utils/lighttierConfigUtil'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { checkConfigCompat } from '@/utils/kernelCompatUtil'

defineOptions({ name: 'NewConfigView' })

// ===== 状态定义 =====
const easyTierStore = useEasyTierStore()
// Android 平台：无 Windows 服务/系统路由工具，内核进程内运行（无 pid）
const isAndroidPlatform = isAndroid()
// 启动进行中标志：避免连点造成重复启动/路由重复下发
const isStarting = ref(false)
// 当前选中配置（列表卡片数据）与其 TOML 解析后的详情
const selectedConfig = ref<RunningItem | null>(null)
const selectedDetail = ref<EasyTierConfig | null>(null)

const { show: toast } = useCreamToast()
// 自动跃点：启动前记录网卡状态、停止后恢复（配合退出节点路由避免默认路由缺失）
const { beforeStart: autoMetricBeforeStart, afterStop: autoMetricAfterStop } = useAutoMetric()
const { clearTrend } = useTrendBuffer()
// 文件/服务操作统一从 useMockData 获取：Tauri 环境走真实实现，浏览器 Mock 环境自动降级
const {
  readFileContent,
  writeFileContent,
  deleteFileOrDir,
  checkService,
  installService,
  uninstallService,
  startService,
  stopService
} = useMockData()
const { t } = useI18n()
const router = useRouter()
const route = useRoute()

// 详情面板 flags：已知字段 key → i18n 标签（与编辑表单同源定义），未知 key 回退原文
const FLAG_LABEL_KEY_MAP: Record<string, string> = {}
for (const def of [
  ...SECURITY_FIELD_DEFS,
  ...ADVANCED_FLAG_DEFS,
  ...ADVANCED_TOP_SWITCH_DEFS,
  ...ADVANCED_TOP_TEXT_DEFS
]) {
  FLAG_LABEL_KEY_MAP[def.key] = def.labelKey
}
const flagLabel = (key: string): string => {
  const labelKey = FLAG_LABEL_KEY_MAP[key]
  return labelKey ? t(labelKey) : key
}

// 将 useMockData 返回的原始状态 key 映射为国际化字符串
const mapServiceStatus = (key: string): string => {
  switch (key) {
    case 'running':
      return t('newCommon.running')
    case 'stopped':
      return t('newConfig.stoppedStatus')
    case 'stopping':
      return t('newCommon.stopping')
    case 'notInstalled':
      return t('newConfig.notInstalled')
    case 'unknown':
      return t('newSettings.unknown')
    default:
      return key
  }
}

// ===== 配置编辑弹窗（仅桌面端；Android 走独立路由页面） =====
const editVisible = ref(false)
const editConfigName = ref('')
const editTomlContent = ref('')
const editDialogMode = ref<'add' | 'edit'>('edit')

// 服务管理
const svcDialogVisible = ref(false)
const svcConfigName = ref('')
const serviceStatusMap = ref<Map<string, string>>(new Map())
const currentServiceStatus = computed(() => {
  if (!selectedConfig.value) return ''
  return serviceStatusMap.value.get(selectedConfig.value.configFileName) || 'notInstalled'
})

// 自定义确认弹窗（替代原生 confirm）
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
// 防止通过遮罩层/ESC/关闭按钮关闭弹窗时 Promise 永不 resolve
watch(cfmVisible, (v) => {
  if (!v && cfmResolve) {
    cfmResolve(false)
    cfmResolve = null
  }
})

// 配置名列表（用于新增时查重）
const configNameList = computed(() => easyTierStore.configList.map((c) => c.configFileName))

// ===== 列表与详情加载 =====
const getRunning = (item: RunningItem) =>
  easyTierStore.runningList.some((i) => i.configFileName === item.configFileName)
const getRunningItem = (item: RunningItem) =>
  easyTierStore.runningList.find((i) => i.configFileName === item.configFileName)
const selectedRunning = computed(() =>
  selectedConfig.value ? getRunning(selectedConfig.value) : false
)

// 列表搜索：按配置名/文件名不区分大小写过滤；运行中优先且保持原加载顺序（稳定排序）
const configSearch = ref('')
const filteredConfigList = computed(() => {
  const keyword = configSearch.value.trim().toLowerCase()
  return easyTierStore.configList
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        !keyword ||
        item.configFileName.toLowerCase().includes(keyword) ||
        (item.fileName || '').toLowerCase().includes(keyword)
    )
    .sort((a, b) => Number(getRunning(b.item)) - Number(getRunning(a.item)) || a.index - b.index)
    .map(({ item }) => item)
})

// 运行时状态刷新（FAB 已负责文件加载）
const refreshRuntimeState = async () => {
  await updateRunningList()
  // 窄屏（移动端）默认展示清单，不自动进入详情，由用户点卡片跳转
  if (window.innerWidth > 900 && easyTierStore.configList.length > 0) {
    const last = easyTierStore.getLastRunConfigName()
    const target = last
      ? easyTierStore.configList.find((c) => c.configFileName === last)
      : easyTierStore.configList[0]
    if (target) await selectConfig(target)
  }
  // 加载服务状态
  for (const c of easyTierStore.configList) {
    loadServiceStatus(c.configFileName)
  }
}

// 选中配置卡片：加载详情、重置路由筛选，并记录选择（供下次进入页面恢复）
const selectConfig = async (item: RunningItem) => {
  selectedConfig.value = item
  routeFilter.value = ''
  // 先清空旧详情，避免读取失败时仍显示上一个配置的内容
  selectedDetail.value = null
  await loadConfigDetail(item)
  easyTierStore.setLastSelectedConfig(item)
}

// 移动端 master-detail：从详情返回清单
const closeDetail = () => {
  selectedConfig.value = null
  selectedDetail.value = null
  detailState.value = 'idle'
  detailError.value = null
}

// 详情显式状态机：idle | loading | ready | demo | error
const detailState = ref<'idle' | 'loading' | 'ready' | 'demo' | 'error'>('idle')
const detailError = ref<{ kind: 'read' | 'parse' | 'empty'; message: string } | null>(null)
const detailErrorTitle = computed(() => {
  switch (detailError.value?.kind) {
    case 'parse':
      return t('newConfig.detailParseFailed')
    case 'empty':
      return t('newConfig.detailEmpty')
    default:
      return t('newConfig.detailLoadFailed')
  }
})

// 读取并解析配置 TOML：Mock 环境无 fileName 时展示演示数据并明确标注；
// Tauri 环境读取/解析失败进入错误态，不再静默回退演示数据
const loadConfigDetail = async (item: RunningItem) => {
  detailState.value = 'loading'
  detailError.value = null
  selectedDetail.value = null
  if (!item.fileName) {
    if (!isTauri) {
      selectedDetail.value = getDemoConfig(item.configFileName)
      detailState.value = 'demo'
      return
    }
    detailState.value = 'error'
    detailError.value = { kind: 'read', message: '' }
    return
  }

  let content: string
  try {
    content = (await readFileContent(`${CONFIG_PATH}/${item.fileName}`)) as string
  } catch {
    detailState.value = 'error'
    detailError.value = { kind: 'read', message: '' }
    return
  }
  if (!content || !content.trim()) {
    detailState.value = 'error'
    detailError.value = { kind: 'empty', message: '' }
    return
  }

  try {
    const cfg = toml.parse(content) as Record<string, any>
    // 旧版 LightTier 私有标记迁到 [lighttier]（仅首次命中时回写）
    if (migrateLightTierConfig(cfg)) {
      try {
        await writeFileContent(`${CONFIG_PATH}/${item.fileName}`, toml.stringify(cfg))
      } catch {
        /* 回写失败不阻断详情展示 */
      }
    }
    selectedDetail.value = cfg as unknown as EasyTierConfig
    detailState.value = 'ready'
  } catch (e) {
    detailState.value = 'error'
    detailError.value = {
      kind: 'parse',
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

// 错误态重试 / 打开配置目录（桌面）
const retryDetail = async () => {
  if (!selectedConfig.value) return
  await loadConfigDetail(selectedConfig.value)
}
const openConfigDir = async () => {
  if (!isTauri) return
  try {
    const resDir = await resourceDir()
    await openPath(await join(resDir, CONFIG_PATH))
  } catch {
    toast(t('newConfig.openLogFail'), 'error')
  }
}

// 5.2：路由筛选（本期仅 TOML 静态筛选；运行时 route 信息待 CLI 输出含 routes 列验证后追加）
const routeFilter = ref('')
const filteredRoutes = computed(() => {
  const routes = selectedDetail.value?.routes || []
  const kw = routeFilter.value.trim().toLowerCase()
  return kw ? routes.filter((r) => String(r).toLowerCase().includes(kw)) : routes
})

// 从内核拉取运行实例列表（pid / 虚拟 IP），浏览器环境静默忽略
const updateRunningList = async () => {
  try {
    const names = easyTierStore.configList.map((c) => c.configFileName)
    const newList = await coreApi.getRunningList(names)
    easyTierStore.setRunningList(newList)
  } catch {
    /* non-Tauri */
  }
}

// 配置在当前内核下的兼容性问题（error 会阻断启动；warning 仅供展示）
const getConfigCompatIssues = async (fileName: string) => {
  try {
    const raw = (await readFileContent(`${CONFIG_PATH}/${fileName}`)) as string
    const cfg = toml.parse(raw) as Record<string, any>
    // 旧版 LightTier 私有标记先迁移并落盘：v2.7.0 会把 flags._enable_exit_route 当作未知键拒绝启动
    if (migrateLightTierConfig(cfg)) {
      try {
        await writeFileContent(`${CONFIG_PATH}/${fileName}`, toml.stringify(cfg))
      } catch {
        /* 回写失败不阻断校验，下次启动/编辑会再次尝试 */
      }
    }
    return checkConfigCompat(cfg, easyTierStore.detectedCoreVersion)
  } catch {
    return []
  }
}
const formatCompatIssues = (issues: { code: string; params?: Record<string, any> }[]): string =>
  issues.map((i) => t(`coreCompat.${i.code}`, i.params || {})).join('\n')

// ===== 启动 / 停止 =====
const startAction = async (item: RunningItem) => {
  if (!item.fileName || isStarting.value) return
  isStarting.value = true
  try {
    // 版本兼容预检：旧内核忽略的字段仅警告；严格版本（v2.7.0+）的未知字段会拒绝启动
    const errors = (await getConfigCompatIssues(item.fileName)).filter((i) => i.level === 'error')
    if (errors.length) {
      const confirmed = await showConfirm(
        t('newConfig.compatBlockTitle'),
        t('newConfig.compatBlockMsg', {
          name: item.configFileName,
          issues: formatCompatIssues(errors)
        })
      )
      if (!confirmed) return
    }
    // Android 单实例模型：已有其他配置运行时，二次确认后停旧起新
    if (isAndroidPlatform) {
      const current = easyTierStore.runningList.find(
        (r) => r.configFileName !== item.configFileName
      )
      if (current) {
        const confirmed = await showConfirm(
          t('newOverview.androidSwitchTitle'),
          t('newOverview.androidSwitchConfirm', {
            current: current.configFileName,
            next: item.configFileName
          })
        )
        if (!confirmed) return
        const stopped = await coreApi.stopConfig(current)
        if (!stopped) {
          toast(t('newCommon.stoppedFail'), 'error')
          return
        }
        easyTierStore.removeRunningList(current.configFileName)
      }
    }
    await autoMetricBeforeStart(item.fileName)
    await coreApi.startConfig(item.fileName)
    easyTierStore.setStopLoop(false)
    easyTierStore.setP2pNotify(true)
    easyTierStore.setLastRunConfigName(item)
    await updateRunningList()
    toast(t('newCommon.startSuccess'), 'success')
    // 5.9：若配置启用退出路由标记，启动成功后自动配置路由（仅桌面）
    if (isTauri) await applyExitRouteAfterStart(item)
  } catch (e: any) {
    await autoMetricAfterStop(item.fileName)
    // 展示内核真实错误，便于定位（invoke 拒绝值可能是字符串或 Error）
    const detail = typeof e === 'string' ? e : e?.message
    const base = isAndroidPlatform
      ? t('newOverview.startFailAndroid')
      : t('newOverview.startFailCore')
    toast(detail ? `${base}（${detail}）` : base, 'error', 6000)
  } finally {
    isStarting.value = false
  }
}

// 停止内核实例：Android 停 VPN+内核，桌面结束子进程；成功后恢复跃点并清除该配置的退出路由
const stopAction = async (item: RunningItem) => {
  const running = getRunningItem(item)
  let stopped = true
  // Android：停 VPN + 内核实例（无 pid）；桌面：结束子进程
  if (isAndroidPlatform || running?.pid) {
    const ok = await coreApi.stopConfig(running ?? item)
    if (ok) {
      easyTierStore.setStopLoop(true)
      easyTierStore.removeRunningList(item.configFileName)
      toast(t('newCommon.stoppedSuccess'), 'success')
    } else {
      stopped = false
      toast(t('newCommon.stoppedFail'), 'error')
    }
  } else easyTierStore.removeRunningList(item.configFileName)
  if (!stopped) return
  await autoMetricAfterStop(item.fileName)
  clearTrend(item.configFileName)
  // 5.9：只清除当前配置持有的路由；失败时保留记录供重试/残留检查
  if (isTauri) {
    const routeResult = await clearExitRoute(item.configFileName)
    if (routeResult.failed > 0) {
      toast(t('newConfig.exitRouteFail'), 'error', 4000)
    } else if (routeResult.cleared > 0) {
      toast(t('newConfig.exitRouteAutoCleared'), 'success')
    }
  }
}

// 内置演示配置：浏览器 Mock 环境或读取失败时展示，保证界面完整可用（按名称匹配，缺省回退首个）
function getDemoConfig(name: string): EasyTierConfig {
  const demos: Record<string, any> = {
    东京中继节点: {
      hostname: 'tokyo-relay-01',
      instance_name: '东京中继',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'global-mesh', network_secret: '••••' },
      listeners: ['tcp://0.0.0.0:11000', 'udp://0.0.0.0:11000'],
      peer: [{ uri: 'tcp://public-node-1:11000' }, { uri: 'udp://public-node-2:11000' }],
      exit_nodes: [],
      routes: ['10.0.0.0/8', '172.16.0.0/12'],
      flags: { default_protocol: 'tcp', mtu: 1380, latency_first: true }
    },
    新加坡出口: {
      hostname: 'sg-exit-01',
      instance_name: '新加坡出口',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'global-mesh', network_secret: '••••' },
      listeners: ['tcp://0.0.0.0:11001'],
      peer: [{ uri: 'tcp://public-node-1:11000' }],
      exit_nodes: ['0.0.0.0/0'],
      routes: [],
      flags: { default_protocol: 'tcp', mtu: 1380, enable_exit_node: true }
    },
    家庭局域网: {
      hostname: 'home-router',
      instance_name: '家庭网络',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'home-mesh', network_secret: '••••' },
      listeners: [],
      peer: [{ uri: 'tcp://tokyo-relay:11000' }],
      exit_nodes: [],
      routes: ['192.168.1.0/24'],
      flags: { default_protocol: 'tcp', mtu: 1380, latency_first: true }
    },
    办公室组网: {
      hostname: 'office-gw',
      instance_name: '办公室网关',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'office-mesh', network_secret: '••••' },
      listeners: ['tcp://0.0.0.0:11002'],
      peer: [{ uri: 'tcp://tokyo-relay:11000' }],
      exit_nodes: [],
      routes: ['10.10.0.0/16'],
      flags: { default_protocol: 'tcp', mtu: 1380, latency_first: true }
    },
    移动设备: {
      hostname: 'mobile-01',
      instance_name: '手机',
      rpc_portal: '127.0.0.1:15888',
      dhcp: true,
      network_identity: { network_name: 'home-mesh', network_secret: '••••' },
      listeners: [],
      peer: [{ uri: 'tcp://home-router:11000' }],
      exit_nodes: [],
      routes: [],
      flags: { default_protocol: 'tcp', latency_first: true, no_tun: true }
    }
  }
  return (demos[name] || demos['东京中继节点']) as EasyTierConfig
}

// ===== 生命周期 =====
onMounted(() => {
  // 如果 store 尚未加载，先加载
  if (!easyTierStore.configListLoaded) {
    easyTierStore.loadConfigFiles()
  }
  // 注册到全局刷新回调：托盘/任务栏等外部动作触发时同步刷新本页
  easyTierStore.registerPageRefresh(refreshRuntimeState)
  refreshRuntimeState()
})

onUnmounted(() => {
  easyTierStore.clearPageRefresh()
})

// ===== 配置增删改 =====
const openEdit = async () => {
  if (!selectedConfig.value?.fileName) return
  // Android：进入独立编辑页面（移动端不使用弹窗）
  if (isAndroidPlatform) {
    router.push({ name: 'NewConfigEditView', query: { name: selectedConfig.value.configFileName } })
    return
  }
  try {
    const raw = (await readFileContent(`${CONFIG_PATH}/${selectedConfig.value.fileName}`)) as string
    // 必须先切回 edit：openAdd 会把模式置为 add，若不复位会导致后续编辑按“新建”处理
    // （隐藏字段/重名校验/标题错误），也破坏“新建隐藏、存量警告”的版本适配策略
    editDialogMode.value = 'edit'
    editConfigName.value = selectedConfig.value.configFileName
    editTomlContent.value = raw
    editVisible.value = true
  } catch {
    toast(t('newConfig.readFail'), 'error')
  }
}

// 编辑/新增弹窗保存回调：备份旧文件 → 写入 TOML → 回调结果（失败时弹窗保持打开）
const handleSaved = async (name: string, content: string, done: (ok: boolean) => void) => {
  const isAdd = editDialogMode.value === 'add'
  let backupFailed = false
  try {
    if (!isAdd) {
      // 覆盖前备份上一版；备份失败视为保存失败，避免用户误以为有回滚点
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
    await refreshRuntimeState()
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

// 新增配置
const openAdd = () => {
  // Android：进入独立新增页面（移动端不使用弹窗）
  if (isAndroidPlatform) {
    router.push({ name: 'NewConfigAddView' })
    return
  }
  editDialogMode.value = 'add'
  editConfigName.value = ''
  // 初始模板不写 rpc_portal：v2.5.0 起该字段已从配置移除（桌面运行时由 CLI 参数注入，
  // v2.4.5 也可在表单中手动开启）；避免新建配置即触发“字段已失效”警告
  editTomlContent.value = 'hostname = ""\ninstance_name = ""\ndhcp = true\n'
  editVisible.value = true
}

// 支持空态/引导一键新建：?create=1 打开新增后清除 query，避免刷新重复弹出
onMounted(() => {
  if (route.query.create !== '1') return
  const query = { ...route.query }
  delete query.create
  router.replace({ query })
  openAdd()
})

// 删除配置
const deleteSelectedConfig = async () => {
  if (!selectedConfig.value) return
  const target = selectedConfig.value
  // 运行中的配置不能直接删除：否则内核仍在运行但 UI 已无法停止，形成孤儿进程
  if (easyTierStore.runningList.some((r) => r.configFileName === target.configFileName)) {
    toast(t('newCommon.deleteBlockedRunning'), 'warning', 4000)
    return
  }
  // 已安装 Windows 服务时先卸载，避免服务指向被删除的 TOML
  const svcStatus = serviceStatusMap.value.get(target.configFileName)
  if (svcStatus && svcStatus !== 'notInstalled') {
    toast(t('newCommon.deleteBlockedService'), 'warning', 4000)
    return
  }
  const ok = await showConfirm(
    t('newConfig.deleteTitle'),
    t('newConfig.deleteMsg', { name: target.configFileName })
  )
  if (!ok) return
  try {
    // 删除配置前清除该配置持有的退出路由（失败则中止，避免留下无法追踪的残留）
    if (isTauri) {
      const routeResult = await clearExitRoute(target.configFileName)
      if (!routeResult.ok) {
        toast(t('newConfig.exitRouteFail'), 'error', 4000)
        return
      }
    }
    await deleteFileOrDir(`${CONFIG_PATH}/${target.fileName}`)
    clearTrend(target.configFileName)
    toast(t('newCommon.deleteSuccess'), 'success')
    selectedConfig.value = null
    selectedDetail.value = null
    await easyTierStore.loadConfigFiles()
    await refreshRuntimeState()
  } catch {
    toast(t('newCommon.deleteFail'), 'error')
  }
}

// ===== 退出节点路由开关（5.9 / 5.10，仅 Tauri 桌面端） =====
// 判定依据：Tauri 运行时且非 Android（Android 无 route 命令/PowerShell，视为非适用环境）；
// withGlobalTauri 已关闭，统一用 @tauri-apps/api 的 isTauri() 检测
const isTauri = isTauriRuntime() && !isAndroidPlatform
const isExitRouteBusy = ref(false)

// 开关状态：优先 [lighttier].exit_route_enabled，兼容旧 flags / 顶层标记
const exitRouteFlag = computed(() => isExitRouteEnabled(selectedDetail.value as any))

const exitRouteStatus = computed<'enabled' | 'disabled' | 'desktop'>(() => {
  if (!isTauri) return 'desktop'
  return exitRouteFlag.value ? 'enabled' : 'disabled'
})
const exitRouteStatusText = computed(() => {
  if (exitRouteStatus.value === 'enabled') return t('newConfig.exitRouteEnabled')
  if (exitRouteStatus.value === 'desktop') return t('newConfig.exitRouteOnlyDesktop')
  return t('newConfig.exitRouteDisabled')
})

// 持久化开关标记到配置 TOML 的 [lighttier] 表（同时清除旧版 flags/顶层标记）
const persistExitRouteFlag = async (enabled: boolean): Promise<boolean> => {
  const item = selectedConfig.value
  if (!item?.fileName) return false
  try {
    const raw = (await readFileContent(`${CONFIG_PATH}/${item.fileName}`)) as string
    const cfg = toml.parse(raw) as any
    setExitRouteEnabled(cfg, enabled)
    await writeFileContent(`${CONFIG_PATH}/${item.fileName}`, toml.stringify(cfg))
    // 同步内存视图，避免开关状态与文件不一致
    const detail = selectedDetail.value as any
    if (detail) setExitRouteEnabled(detail, enabled)
    return true
  } catch {
    return false
  }
}

const toggleExitRoute = async () => {
  if (!selectedConfig.value || !selectedDetail.value || isExitRouteBusy.value) return
  isExitRouteBusy.value = true
  try {
    if (exitRouteFlag.value) {
      // 停用：只清理当前配置的路由，失败时保留标记以便重试
      const result = await clearExitRoute(selectedConfig.value.configFileName)
      if (result.ok) {
        await persistExitRouteFlag(false)
        toast(t('newConfig.exitRouteCleared'), 'success')
      } else {
        toast(t('newConfig.exitRouteFail'), 'error')
      }
    } else {
      // 启用：添加路由 + 写入标记
      const res = await setExitRoute(
        selectedDetail.value as any,
        selectedConfig.value.configFileName
      )
      if (res.ok) {
        await persistExitRouteFlag(true)
        toast(t('newConfig.exitRouteSuccess'), 'success')
      } else if (res.reason === 'no-exit') {
        toast(t('newConfig.exitRouteNoExit'), 'warning')
      } else if (res.reason === 'precondition') {
        toast(t('newConfig.exitRoutePrecondition'), 'warning', 4000)
      } else if (res.reason === 'non-tauri') {
        toast(t('newConfig.exitRouteOnlyDesktop'), 'warning')
      } else {
        toast(
          t('newConfig.exitRouteFail') + '：' + t('newConfig.exitRouteAdminHint'),
          'error',
          4000
        )
      }
    }
  } finally {
    isExitRouteBusy.value = false
  }
}

// 5.10：残留检查（对比持久化记录与系统路由表，可确认清理）
const openRouteCheck = async () => {
  if (isExitRouteBusy.value) return
  isExitRouteBusy.value = true
  try {
    const res = await checkExitRouteResidue()
    const fmt = (r: { target: string; mask: string; gateway: string; metric: number }) =>
      `${r.target} mask ${r.mask} → ${r.gateway} (metric ${r.metric})`
    const parts: string[] = []
    if (res.active.length > 0) {
      parts.push(
        t('newConfig.exitRouteCheckActive', { n: res.active.length }) +
          '\n' +
          res.active.map(fmt).join('\n')
      )
    }
    if (res.missing.length > 0) {
      parts.push(
        t('newConfig.exitRouteCheckMissing', { n: res.missing.length }) +
          '\n' +
          res.missing.map(fmt).join('\n')
      )
    }
    if (res.suspicious.length > 0) {
      parts.push(
        t('newConfig.exitRouteCheckSuspicious', { n: res.suspicious.length }) +
          '\n' +
          res.suspicious.map(fmt).join('\n')
      )
    }
    if (parts.length === 0) {
      toast(t('newConfig.exitRouteCheckNone'), 'success')
      return
    }
    const clearable = res.active.length > 0
    const confirmMsg =
      parts.join('\n\n') +
      (clearable
        ? '\n\n' + t('newConfig.exitRouteCheckConfirmClear', { n: res.active.length })
        : '')
    const ok = await showConfirm(t('newConfig.exitRouteCheckTitle'), confirmMsg)
    if (!ok || !clearable) return
    const clean = await cleanExitRouteResidue(true)
    if (clean.failed > 0) {
      toast(t('newConfig.exitRouteResidueFail'), 'error')
    } else if (clean.cleared > 0) {
      toast(t('newConfig.exitRouteResidueCleared', { n: clean.cleared }), 'success')
    }
  } finally {
    isExitRouteBusy.value = false
  }
}

// 启动成功后自动配置退出节点路由（与概览页共用同一实现；可能不是当前选中项）
const applyExitRouteAfterStart = async (item: RunningItem) => {
  const res = await applyExitRouteFromFile(item.configFileName, item.fileName)
  if (res.ok) toast(t('newConfig.exitRouteAutoApplied'), 'success')
  else if (res.reason === 'precondition')
    toast(t('newConfig.exitRoutePrecondition'), 'warning', 4000)
  else if (res.reason === 'no-exit') toast(t('newConfig.exitRouteNoExit'), 'warning')
  else if (res.reason === 'command') {
    const detail = res.message ? `（${res.message}）` : ''
    toast(t('newConfig.exitRouteFail') + detail, 'error', 5000)
  } else if (res.reason === 'read-failed') {
    toast(t('newConfig.exitRouteFail'), 'error', 3000)
  }
}

// 服务管理
const loadServiceStatus = async (configFileName: string) => {
  // Windows 服务专属能力；Android 无此模型（服务面板整体隐藏）
  if (isAndroidPlatform) return
  try {
    const status = await checkService(configFileName)
    serviceStatusMap.value.set(configFileName, status)
  } catch {
    serviceStatusMap.value.set(configFileName, 'notInstalled')
  }
}

// 打开服务安装弹窗（选择 nssm / 官方服务等安装方式）
const openServiceDialog = () => {
  if (!selectedConfig.value) return
  svcConfigName.value = selectedConfig.value.configFileName
  svcDialogVisible.value = true
}

// 服务安装完成回调：安装后刷新该配置的服务状态
const handleServiceInstalled = async (configName: string, options: any) => {
  try {
    // 服务会以当前内核启动该配置：存在版本错误时先提示，避免装完即失败
    const errors = (await getConfigCompatIssues(`${configName}.toml`)).filter(
      (i) => i.level === 'error'
    )
    if (errors.length) {
      const confirmed = await showConfirm(
        t('newConfig.compatBlockTitle'),
        t('newConfig.compatBlockMsg', {
          name: configName,
          issues: formatCompatIssues(errors)
        })
      )
      if (!confirmed) return
    }
    // 安装方式参数随当前内核版本适配（v2.7.0+ 使用 --core-args），避免重复探测
    const ok = await installService(configName, {
      ...options,
      coreVersion: easyTierStore.detectedCoreVersion
    })
    if (ok) {
      toast(t('newConfig.svcInstallSuccess'), 'success')
    } else {
      toast(t('newConfig.svcInstallFail'), 'error')
    }
    await loadServiceStatus(configName)
  } catch {
    toast(t('newConfig.svcInstallFail'), 'error')
  }
}

// 启动 Windows 服务
const handleStartService = async () => {
  if (!selectedConfig.value) return
  try {
    const ok = await startService(selectedConfig.value.configFileName)
    toast(
      ok ? t('newConfig.svcStartSuccess') : t('newConfig.svcStartFail'),
      ok ? 'success' : 'error'
    )
    await loadServiceStatus(selectedConfig.value.configFileName)
    await updateRunningList()
  } catch {
    toast(t('newConfig.svcStartFail'), 'error')
  }
}

// 停止 Windows 服务（停止后提示内核已断开）
const handleStopService = async () => {
  if (!selectedConfig.value) return
  try {
    const ok = await stopService(selectedConfig.value.configFileName)
    toast(ok ? t('newConfig.svcStopSuccess') : t('newConfig.svcStopFail'), ok ? 'success' : 'error')
    // 仅在真正停止后提示；失败时不再补一条“已停止”的成功 toast
    if (ok) toast(t('newConfig.svcStopHint'), 'success', 3000)
    await loadServiceStatus(selectedConfig.value.configFileName)
    // 服务启停会改变内核运行状态，统一刷新运行列表
    await updateRunningList()
  } catch {
    toast(t('newConfig.svcStopFail'), 'error')
  }
}

// 卸载 Windows 服务（二次确认后执行）
const handleUninstallService = async () => {
  if (!selectedConfig.value) return
  const ok = await showConfirm(
    t('newConfig.uninstallTitle'),
    t('newConfig.uninstallMsg', { name: selectedConfig.value.configFileName })
  )
  if (!ok) return
  try {
    const result = await uninstallService(selectedConfig.value.configFileName)
    toast(
      result ? t('newConfig.svcUninstallSuccess') : t('newConfig.svcUninstallFail'),
      result ? 'success' : 'error'
    )
    await loadServiceStatus(selectedConfig.value.configFileName)
  } catch {
    toast(t('newConfig.svcUninstallFail'), 'error')
  }
}
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

.nw-left-label {
  padding: 0 var(--theme-space-1);
  font-family: var(--theme-font-display);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.nw-left-header {
  display: flex;
  padding: 0 var(--theme-space-1);
  flex-direction: column;
  gap: var(--theme-space-2);
}

.nw-left-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nw-left-btns {
  display: flex;
  align-items: center;
  gap: var(--theme-space-1);
}

/* 搜索框：固定于标题栏，列表滚动时保持可见 */
.nw-search {
  position: relative;
  display: flex;
  align-items: center;
}

.nw-search-input {
  width: 100%;
  padding: 6px 28px 6px 10px;
  font-family: var(--theme-font-body);
  font-size: 12px;
  color: var(--theme-text-primary);
  background: var(--theme-bg-tag);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-pill);
  outline: none;
  transition: border-color 0.2s;
}

.nw-search-input:focus {
  border-color: var(--theme-accent-primary);
}

.nw-search-input::-webkit-search-cancel-button {
  display: none;
}

.nw-search-clear {
  position: absolute;
  right: 4px;
  display: flex;
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 15px;
  line-height: 1;
  color: var(--theme-text-muted);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-round);
  align-items: center;
  justify-content: center;
}

.nw-search-clear:hover {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nw-add-btn {
  display: flex;
  width: 24px;
  height: 24px;
  font-size: 16px;
  font-weight: 500;
  line-height: 1;
  color: var(--theme-text-muted);
  cursor: pointer;
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-round);
  transition: all 0.2s;
  align-items: center;
  justify-content: center;
}

.nw-add-btn:hover {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
  border-color: var(--theme-accent-primary);
}

.nw-left-scroll {
  display: flex;
  min-height: 0;
  padding: var(--theme-space-3);
  overflow-y: auto;
  background: var(--theme-bg-tag);
  border-radius: var(--theme-radius-md);
  flex: 1;
  flex-direction: column;
  gap: var(--theme-space-3);
}

.nw-card {
  padding: var(--theme-space-4);
  overflow: hidden;
  cursor: pointer;
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  transition: all 0.3s var(--theme-ease-spring);
  flex-shrink: 0;
}

.nw-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--theme-shadow-sm);
}

.nw-card.active {
  border-color: var(--theme-accent-primary);
  box-shadow: 0 0 0 2px var(--theme-bg-active);
}

.nw-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--theme-space-1);
}

.nw-card-status {
  display: flex;
  align-items: center;
  gap: var(--theme-space-1);
}

.nw-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--theme-radius-round);
}

.nw-dot.on {
  background: var(--theme-color-success);
}

.nw-dot.off {
  background: var(--theme-text-muted);
}

.nw-status-text {
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nw-card-pid {
  font-size: 11px;
  color: var(--theme-text-muted);
}

.nw-card-name {
  margin-bottom: 2px;
  font-family: var(--theme-font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.nw-card-sub {
  margin-bottom: var(--theme-space-3);
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nw-card-actions {
  display: flex;
  gap: var(--theme-space-2);
}

.nw-btn {
  padding: var(--theme-space-1) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.25s;
}

.nw-btn-run {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
}

.nw-btn-run:hover:not(:disabled) {
  transform: scale(1.04);
}

.nw-btn-stop {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nw-btn-stop:hover:not(:disabled) {
  background: var(--theme-bg-active);
}

.nw-btn:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
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
  .nw-detail-open .nw-back-btn {
    display: flex;
  }

  .nw-right {
    flex: 1;
    padding: var(--theme-space-4);
  }
}

/* 手机尺寸：字段网格降为单列，避免长值被挤成两行 */
@media (width <= 480px) {
  .nw-root .nw-grid {
    grid-template-columns: 1fr;
  }
}

/* 移动端返回按钮（默认隐藏，仅窄屏在详情头部展示） */
.nw-back-btn {
  display: none;
  padding: var(--theme-space-1) var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  white-space: nowrap;
  cursor: pointer;
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-pill);
  transition: all 0.2s;
  align-items: center;
  gap: var(--theme-space-2);
}

.nw-back-btn:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-active);
}

.nw-detail-header {
  display: flex;
  padding-bottom: var(--theme-space-4);
  margin-bottom: var(--theme-space-4);
  border-bottom: 2px solid var(--theme-border-light);
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--theme-space-3);
}

.nw-detail-title-row {
  display: flex;
  align-items: center;
  gap: var(--theme-space-3);
  flex-wrap: wrap;
  min-width: 0;
}

.nw-detail-title {
  margin: 0;
  font-family: var(--theme-font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--theme-text-primary);
  overflow-wrap: break-word;
}

.nw-badge {
  padding: 2px var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 11px;
  white-space: nowrap;
  border-radius: var(--theme-radius-pill);
}

.nw-badge.on {
  color: var(--theme-color-success-dark);
  background: color-mix(in srgb, var(--theme-color-success) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-color-success) 18%, transparent);
}

.nw-badge.off {
  color: var(--theme-text-muted);
  background: color-mix(in srgb, var(--theme-text-muted) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-text-muted) 18%, transparent);
}

.nw-badge-demo {
  color: var(--theme-text-secondary);
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border);
}

.nw-detail-error {
  gap: var(--theme-space-2);
  align-items: flex-start;
  justify-content: flex-start;
  padding: var(--theme-space-6);
}

.nw-detail-error-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.nw-detail-error-desc {
  max-width: 100%;
  margin: 0;
  font-size: 12px;
  color: var(--theme-text-muted);
  overflow-wrap: anywhere;
}

.nw-detail-error-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--theme-space-2);
  margin-top: var(--theme-space-2);
}

.nw-detail-actions {
  display: flex;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

/* 宽屏列表卡片已提供生命周期操作，详情不再重复；窄屏列表隐藏时才显示 */
.nw-detail-lifecycle {
  display: none;
  align-items: center;
}

@media (width <= 900px) {
  .nw-detail-lifecycle {
    display: inline-flex;
  }
}

.nw-btn-lg {
  padding: var(--theme-space-2) var(--theme-space-5);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.25s;
}

.nw-btn-start {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
}

.nw-btn-start:hover:not(:disabled) {
  transform: translateY(-1px);
}

.nw-btn-edit {
  color: var(--theme-text-primary);
  background: var(--theme-bg-hover);
  border: 1.5px solid var(--theme-border);
}

.nw-btn-edit:hover:not(:disabled) {
  color: var(--theme-accent-primary);
  border-color: var(--theme-accent-primary);
}

.nw-btn-kill {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nw-btn-kill:hover:not(:disabled) {
  transform: translateY(-1px);
}

.nw-btn-del {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
  border: 1.5px solid color-mix(in srgb, var(--theme-accent-primary) 30%, transparent);
}

.nw-btn-del:hover:not(:disabled) {
  color: var(--theme-accent-primary);
  border-color: var(--theme-accent-primary);
  transform: translateY(-1px);
}

.nw-btn-lg:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
}

.nw-section {
  margin-bottom: var(--theme-space-4);
}

.nw-section-title {
  display: flex;
  margin-bottom: var(--theme-space-3);
  font-family: var(--theme-font-display);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--theme-accent-primary);
  align-items: center;
  gap: var(--theme-space-2);
}

.nw-section-title::after {
  height: 2px;
  background: linear-gradient(90deg, var(--theme-border-light), transparent);
  content: '';
  flex: 1;
}

.nw-grid {
  display: grid;
  overflow: hidden;
  background: var(--theme-border-light);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
}

.nw-field {
  display: flex;
  padding: var(--theme-space-3) var(--theme-space-4);
  background: var(--theme-bg-card);
  flex-direction: column;
  gap: 2px;
}

.nw-field-full {
  display: flex;
  padding: var(--theme-space-3) var(--theme-space-4);
  background: var(--theme-bg-card);
  flex-direction: column;
  gap: 2px;
  grid-column: 1 / -1;
}

.nw-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.nw-val {
  font-size: 13px;
  color: var(--theme-text-primary);
  word-break: break-all;
}

.nw-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--theme-space-1);
  padding: 2px 0;
}

.nw-tag {
  padding: 2px var(--theme-space-3);
  font-size: 11px;
  color: var(--theme-text-secondary);
  background: var(--theme-bg-tag);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-pill);
}

.nw-route-filter {
  width: 100%;
  padding: var(--theme-space-2) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  color: var(--theme-text-primary);
  background: var(--theme-bg-tag);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-pill);
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.nw-route-filter:focus {
  border-color: var(--theme-accent-primary);
}

.nw-route-filter::placeholder {
  color: var(--theme-text-muted);
}

.nw-route-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: var(--theme-space-2);
  margin-top: var(--theme-space-3);
}

.nw-route-card {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-1);
  padding: var(--theme-space-3);
  background: var(--theme-bg);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
}

.nw-route-target {
  font-family: var(--theme-font-display);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--theme-text-primary);
  word-break: break-all;
}

.nw-route-gw {
  font-size: 11px;
  color: var(--theme-text-muted);
}

.nw-route-empty {
  display: inline-block;
  margin-top: var(--theme-space-3);
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nw-tag-exit {
  color: var(--theme-accent-primary);
  background: color-mix(in srgb, var(--theme-accent-primary) 4%, transparent);
  border-color: color-mix(in srgb, var(--theme-accent-primary) 20%, transparent);
}

.nw-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--theme-space-2);
  opacity: 0.5;
}

.nw-empty-icon {
  font-size: 40px;
  color: var(--theme-color-scrollbar);
}

.nw-empty p {
  margin: 0;
  font-size: 13px;
  color: var(--theme-text-muted);
}

.nw-empty-cards {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--theme-space-10) 0;
  gap: var(--theme-space-2);
  color: var(--theme-text-muted);
}

.nw-empty-cards p {
  margin: 0;
  font-size: 14px;
}

.nw-empty-desc {
  max-width: 260px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-muted);
  text-align: center;
}

.nw-empty-cta {
  padding: var(--theme-space-2) var(--theme-space-5);
  margin-top: var(--theme-space-2);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-white);
  cursor: pointer;
  background: var(--theme-accent-primary);
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.2s;
}

.nw-empty-cta:hover {
  transform: translateY(-1px);
}

.nw-svc-bar {
  display: flex;
  padding: var(--theme-space-3) var(--theme-space-4);
  background: var(--theme-bg-tag);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
  align-items: center;
  justify-content: space-between;
}

.nw-svc-status {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
}

.nw-svc-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--theme-radius-round);
}

.nw-svc-dot.svc-running {
  background: var(--theme-color-success);
  box-shadow: 0 0 6px color-mix(in srgb, var(--theme-color-success) 40%, transparent);
}

.nw-svc-dot.svc-stopped {
  background: var(--theme-text-muted);
}

.nw-svc-dot.svc-uninstalled {
  background: var(--theme-border);
}

.nw-svc-dot.svc-checking {
  background: var(--theme-border);
  animation: nw-pulse 1s infinite;
}

@keyframes nw-pulse {
  0%,
  100% {
    opacity: 0.4;
  }

  50% {
    opacity: 1;
  }
}

.nw-svc-text {
  font-size: 13px;
  color: var(--theme-text-primary);
}

.nw-svc-actions {
  display: flex;
  gap: var(--theme-space-2);
}

.nw-svc-desc {
  margin: var(--theme-space-2) 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-muted);
}

.nw-svc-desktop-only {
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nw-btn-sm {
  padding: var(--theme-space-1) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.2s;
}

.nw-btn-svc-install {
  padding: var(--theme-space-2) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  color: var(--theme-text-on-accent, #fff);
  cursor: pointer;
  background: var(--theme-accent-primary);
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.2s;
}

.nw-btn-svc-install:hover:not(:disabled) {
  transform: translateY(-1px);
}

.nw-btn-svc-start {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
}

.nw-btn-svc-start:hover:not(:disabled) {
  transform: scale(1.04);
}

.nw-btn-svc-stop {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nw-btn-svc-stop:hover:not(:disabled) {
  background: var(--theme-bg-active);
}

.nw-btn-svc-uninstall {
  color: var(--theme-text-muted);
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border);
}

.nw-btn-svc-uninstall:hover:not(:disabled) {
  color: var(--theme-accent-primary);
  border-color: var(--theme-accent-primary);
}

.nw-btn-sm:disabled,
.nw-btn-svc-install:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
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

.nw-btn-cfm {
  padding: var(--theme-space-2) var(--theme-space-5);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.3px;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-sm, 6px);
  transition: all 0.18s ease;
}

.nw-btn-cfm-cancel {
  color: var(--theme-text-secondary);
  background: var(--theme-bg-hover);
}

.nw-btn-cfm-cancel:hover {
  background: var(--theme-bg-active);
}

.nw-btn-cfm-ok {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary);
}

.nw-btn-cfm-ok:hover {
  filter: brightness(1.1);
  transform: translateY(-1px);
}
</style>
