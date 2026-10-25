<template>
  <div
    class="nwc-root"
    :class="{
      'nwc-android': isAndroidPlatform,
      'nwc-detail-open': isAndroidPlatform ? isAndroidDetailRoute : !!selectedConfig
    }"
  >
    <!-- 左侧配置列表 -->
    <div class="nwc-left">
      <!-- 页面标题已由应用栏承担，列表顶部仅保留新增入口 -->
      <div class="nwc-left-header">
        <LtButton
          variant="secondary"
          :size="isAndroidPlatform ? 'lg' : 'sm'"
          circle
          class="nwc-add-btn"
          @click="openAdd"
          :title="t('newWebConfig.addConfig')"
          :aria-label="t('newWebConfig.addConfig')"
        >
          <svg
            :width="isAndroidPlatform ? 19 : 16"
            :height="isAndroidPlatform ? 19 : 16"
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
      <div class="nwc-left-scroll lt-loading-host">
        <LoadingOverlay :show="easyTierStore.webConfigListLoading" />
        <!-- Android：总览式分组行，触控目标整行可点 -->
        <template v-if="isAndroidPlatform">
          <div v-if="webConfigList.length > 0" class="nwc-card-list">
            <div
              v-for="item in webConfigList"
              :key="item.configFileName"
              class="nwc-row"
              @click="selectConfig(item)"
            >
              <span class="nwc-row-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
              </span>
              <span class="nwc-row-text">
                <span class="nwc-row-name">{{ item.configFileName }}</span>
                <span class="nwc-row-sub"
                  >{{ item.protocol }}://{{ item.host }}:{{ item.port }}</span
                >
              </span>
              <svg
                class="nwc-row-chev"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </div>
        </template>
        <!-- 桌面：保留原有卡片列表 -->
        <template v-else>
          <div
            v-for="item in webConfigList"
            :key="item.configFileName"
            class="nwc-card"
            :class="{ active: selectedConfig?.configFileName === item.configFileName }"
            @click="selectConfig(item)"
          >
            <div class="nwc-card-top">
              <div class="nwc-card-status">
                <span class="nwc-dot" :class="getStatusClass(item)"></span>
                <span class="nwc-status-text">{{ mapCardStatus(item) }}</span>
              </div>
              <span v-if="item.pid && !isChecking(item)" class="nwc-card-pid"
                >PID {{ item.pid }}</span
              >
            </div>
            <div class="nwc-card-name">{{ item.configFileName }}</div>
            <div class="nwc-card-sub">{{ item.host }}:{{ item.port }}</div>
            <div class="nwc-card-actions" @click.stop>
              <!-- 单一生命周期主操作：按状态在运行/停止之间切换 -->
              <LtButton
                size="compact"
                :variant="isRunning(item) ? 'soft' : 'success'"
                :disabled="isChecking(item)"
                @click="isRunning(item) ? stopWeb(item) : startWeb(item)"
                >{{ isRunning(item) ? t('newCommon.stop') : t('newCommon.run') }}</LtButton
              >
            </div>
          </div>
        </template>
        <div
          v-if="webConfigList.length === 0 && !easyTierStore.webConfigListLoading"
          class="nwc-empty-cards"
        >
          <span class="nwc-empty-icon">✦</span>
          <p class="nwc-empty-title">{{
            isAndroidPlatform ? t('newWebConfig.emptyTitle') : t('newCommon.noWebConfig')
          }}</p>
          <template v-if="isAndroidPlatform">
            <span class="nwc-empty-desc">{{ t('newWebConfig.emptyDesc') }}</span>
            <LtButton variant="primary" size="md" class="nwc-empty-cta" @click="openAdd">
              {{ t('newWebConfig.addConfig') }}
            </LtButton>
          </template>
        </div>
      </div>
    </div>

    <!-- 右侧详情 -->
    <div class="nwc-right" v-if="selectedConfig">
      <div class="nwc-detail-header">
        <div class="nwc-detail-title-row">
          <LtButton
            v-if="!isAndroidPlatform"
            class="nwc-back-btn"
            variant="ghost"
            size="sm"
            @click="closeWebDetail"
          >
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
          </LtButton>
          <h3 class="nwc-detail-title">{{ selectedConfig.configFileName }}</h3>
          <span
            v-if="isAndroidPlatform && selectedConfig.protocol"
            class="nwc-badge nwc-badge-proto"
          >
            {{ selectedConfig.protocol.toUpperCase() }}
          </span>
          <span
            v-if="!isAndroidPlatform"
            class="nwc-badge"
            :class="
              isChecking(selectedConfig) ? 'checking' : isRunning(selectedConfig) ? 'on' : 'off'
            "
          >
            {{
              isChecking(selectedConfig)
                ? t('newCommon.checking')
                : isRunning(selectedConfig)
                  ? '● ' + t('newCommon.running')
                  : '○ ' + t('newCommon.stopped')
            }}
          </span>
        </div>
        <div class="nwc-detail-actions">
          <LtButton variant="secondary" class="nwc-detail-btn" @click="openEdit">{{
            t('newCommon.edit')
          }}</LtButton>
          <LtButton
            v-if="isAndroidPlatform"
            variant="primary"
            class="nwc-detail-btn"
            :disabled="!selectedConfig.webUrl"
            @click="openConsoleUrl"
            >{{ t('newWebConfig.openConsole') }}</LtButton
          >
          <!-- 窄屏列表不可见，详情保留唯一的上下文生命周期操作；宽屏由列表卡片承担 -->
          <LtButton
            v-if="!isAndroidPlatform"
            class="nwc-detail-lifecycle nwc-detail-btn"
            :variant="isRunning(selectedConfig) ? 'soft' : 'success'"
            :disabled="isChecking(selectedConfig)"
            @click="isRunning(selectedConfig) ? stopWeb(selectedConfig) : startWeb(selectedConfig)"
            >{{ isRunning(selectedConfig) ? t('newCommon.stop') : t('newCommon.run') }}</LtButton
          >
          <LtButton
            v-if="!isAndroidPlatform"
            variant="danger"
            class="nwc-detail-btn"
            :disabled="isChecking(selectedConfig)"
            @click="deleteConfig"
            >{{ t('newCommon.delete') }}</LtButton
          >
        </div>
      </div>

      <p v-if="isAndroidPlatform" class="nwc-platform-hint">
        {{ t('newWebConfig.androidDesktopOnly') }}
      </p>

      <!-- 主要参数 -->
      <div class="nwc-section"
        ><div class="nwc-section-title">{{ t('newWebConfig.mainParams') }}</div>
        <div class="nwc-grid">
          <div class="nwc-field"
            ><span class="nwc-label">{{ t('newWebConfig.protocol') }}</span
            ><span class="nwc-val">{{ selectedConfig.protocol || '—' }}</span></div
          >
          <div class="nwc-field"
            ><span class="nwc-label">{{ t('newWebConfig.host') }}</span
            ><span class="nwc-val">{{ selectedConfig.host || '—' }}</span></div
          >
          <div class="nwc-field"
            ><span class="nwc-label">{{ t('newWebConfig.port') }}</span
            ><span class="nwc-val">{{ selectedConfig.port || '—' }}</span></div
          >
          <div class="nwc-field"
            ><span class="nwc-label">{{ t('newWebConfig.username') }}</span
            ><span class="nwc-val">{{ selectedConfig.userName || '—' }}</span></div
          >
          <div class="nwc-field"
            ><span class="nwc-label">{{ t('newWebConfig.consoleAddr') }}</span>
            <LtButton
              v-if="selectedConfig.webUrl"
              variant="bare"
              class="nwc-val nwc-link"
              :title="selectedConfig.webUrl"
              @click="openConsoleUrl"
              >{{ selectedConfig.webUrl }}</LtButton
            >
            <span class="nwc-val" v-else>—</span>
          </div>
        </div>
      </div>

      <!-- 服务管理：Windows 服务能力，仅桌面端提供 -->
      <div v-if="!isAndroidPlatform" class="nwc-section"
        ><div class="nwc-section-title">{{ t('newWebConfig.serviceMgmt') }}</div>
        <div class="nwc-svc-bar">
          <div class="nwc-svc-status">
            <span class="nwc-svc-dot" :class="getServiceDotClass"></span>
            <span class="nwc-svc-text">{{
              currentServiceStatus
                ? mapServiceStatus(currentServiceStatus)
                : t('newCommon.checking')
            }}</span>
          </div>
          <div class="nwc-svc-actions">
            <template v-if="currentServiceStatus === 'notInstalled'">
              <LtButton variant="primary" @click="openServiceDialog">{{
                t('newWebConfig.installService')
              }}</LtButton>
            </template>
            <template v-else-if="currentServiceStatus">
              <LtButton
                variant="success"
                size="sm"
                :disabled="currentServiceStatus === 'running'"
                @click="handleStartService"
                >{{ t('newCommon.start') }}</LtButton
              >
              <LtButton
                variant="soft"
                size="sm"
                :disabled="currentServiceStatus !== 'running'"
                @click="handleStopService"
                >{{ t('newCommon.stop') }}</LtButton
              >
              <LtButton variant="ghost" size="sm" @click="handleUninstallService">{{
                t('newConfig.uninstall')
              }}</LtButton>
            </template>
          </div>
        </div>
      </div>

      <!-- Android：破坏性操作独立成行，避免与常用操作挤在头部 -->
      <div v-if="isAndroidPlatform" class="nwc-danger-zone">
        <LtButton variant="danger" size="lg" block class="nwc-danger-btn" @click="deleteConfig">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5" />
          </svg>
          {{ t('newCommon.delete') }}
        </LtButton>
      </div>
    </div>

    <div class="nwc-right" v-else>
      <div
        v-if="isAndroidPlatform && (loading || easyTierStore.webConfigListLoading)"
        class="nwc-empty"
      >
        <span class="nwc-state-spinner" aria-hidden="true"></span>
        <p>{{ t('newCommon.checking') }}</p>
      </div>
      <div v-else-if="isAndroidPlatform" class="nwc-empty">
        <span class="nwc-empty-icon">✦</span>
        <p>{{ t('newWebConfig.emptyTitle') }}</p>
      </div>
      <div v-else class="nwc-empty">
        <span class="nwc-empty-icon">✦</span>
        <p>{{ t('newWebConfig.selectWebConfig') }}</p>
      </div>
    </div>
  </div>

  <!-- 编辑弹窗 -->
  <WebConfigForm
    v-model="formVisible"
    :config-data="formConfigData"
    :mode="formMode"
    :existing-names="configNameList"
    @saved="handleFormSaved"
  />

  <!-- 服务安装弹窗 -->
  <CreamDialog
    v-model="svcDialogVisible"
    :title="t('newWebConfig.installTitle', { name: selectedConfig?.configFileName })"
    width="480px"
  >
    <div class="nwc-svc-form">
      <div class="nwc-svc-field">
        <label class="wcf-label">{{ t('newWebConfig.installMethod') }}</label>
        <div
          class="nwc-svc-radio-group"
          role="radiogroup"
          :aria-label="t('newWebConfig.installMethod')"
        >
          <label class="wcf-radio" :class="{ active: svcForm.installMethod === 'nssm' }">
            <input
              class="lt-sr-only"
              type="radio"
              name="nwc-install-method"
              value="nssm"
              v-model="svcForm.installMethod"
            />
            <span class="wcf-radio-dot"></span><span>NSSM</span>
          </label>
          <label class="wcf-radio" :class="{ active: svcForm.installMethod === 'official' }">
            <input
              class="lt-sr-only"
              type="radio"
              name="nwc-install-method"
              value="official"
              v-model="svcForm.installMethod"
            />
            <span class="wcf-radio-dot"></span><span>{{ t('newWebConfig.officialCli') }}</span>
          </label>
        </div>
      </div>
      <template v-if="svcForm.installMethod === 'nssm'">
        <div class="nwc-svc-field">
          <label class="wcf-label">{{ t('newWebConfig.runUser') }}</label>
          <LtInput
            v-model="svcForm.username"
            variant="outline"
            :placeholder="t('newWebConfig.runUserPlaceholder')"
            :aria-label="t('newWebConfig.runUser')"
          />
        </div>
        <div class="nwc-svc-field" v-if="svcForm.username">
          <label class="wcf-label">{{ t('newWebConfig.userPassword') }}</label>
          <LtInput
            v-model="svcForm.password"
            type="password"
            variant="outline"
            :placeholder="t('newWebConfig.passwordPlaceholder')"
            :aria-label="t('newWebConfig.userPassword')"
          />
        </div>
      </template>
      <template v-if="svcForm.installMethod === 'official'">
        <div class="nwc-svc-field">
          <label class="wcf-label">{{ t('newWebConfig.displayName') }}</label>
          <LtInput
            v-model="svcForm.displayName"
            variant="outline"
            :placeholder="t('newWebConfig.displayNamePlaceholder')"
            :aria-label="t('newWebConfig.displayName')"
          />
        </div>
        <div class="nwc-svc-field">
          <label class="wcf-label">{{ t('newWebConfig.svcDesc') }}</label>
          <LtInput
            v-model="svcForm.description"
            variant="outline"
            :placeholder="t('newWebConfig.svcDescPlaceholder')"
            :aria-label="t('newWebConfig.svcDesc')"
          />
        </div>
      </template>
    </div>
    <template #footer>
      <div class="wcf-footer">
        <span class="wcf-footer-hint">{{ t('newWebConfig.installHint') }}</span>
        <div class="nwc-footer-actions">
          <LtButton variant="ghost" @click="svcDialogVisible = false">{{
            t('newCommon.cancel')
          }}</LtButton>
          <LtButton variant="primary" :disabled="svcInstalling" @click="handleServiceInstalled">{{
            svcInstalling ? t('newCommon.installing') : t('newWebConfig.install')
          }}</LtButton>
        </div>
      </div>
    </template>
  </CreamDialog>

  <!-- 确认弹窗 -->
  <CreamDialog v-model="cfmVisible" :title="cfmTitle" width="400px">
    <p class="cfm-msg">{{ cfmMessage }}</p>
    <template #footer>
      <div class="cfm-footer">
        <LtButton variant="ghost" @click="resolveConfirm(false)">{{
          t('newCommon.cancel')
        }}</LtButton>
        <LtButton variant="primary" @click="resolveConfirm(true)">{{
          t('newCommon.confirm')
        }}</LtButton>
      </div>
    </template>
  </CreamDialog>
</template>

<script setup lang="ts">
/**
 * web-config-view — Web 配置服务页（EasyTier config-server 管理，master-detail 布局）
 *
 * 与 config-view 的区别：这里管理的是 config-server（Web 控制台）而非内核实例——
 * - 配置列表持久化在独立 Web 配置文件（readWebConfigList / writeWebConfigList）
 * - 启动方式：以 `--config-server <url>` 拉起内核进程（runEasyTierCoreWeb）或注册为 Windows 服务
 * - 状态判定：进程扫描（命令行匹配 config-server URL）+ 服务状态，合并为卡片状态
 * 平台差异：窄屏 master-detail 互斥展示；控制台地址桌面端直接打开浏览器，
 * Android 仅管理配置，复制地址由用户自行打开，且不显示运行态与 Windows 服务管理。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useEasyTierStore } from '@/store/modules/easytier'
import { useMockData } from '@/hooks/useMockData'
import { useCreamToast } from '@/hooks/useCreamToast'
import { openPath } from '@/utils/fileUtil'
import { isAndroid } from '@/utils/platformUtil'
import CreamDialog from '@/components/CreamDialog/index.vue'
import LoadingOverlay from '@/components/LoadingOverlay/index.vue'
import { LtButton, LtInput } from '@/components/ui'
import WebConfigForm from './WebConfigForm.vue'
import type { FormWebData } from '@/types/formTypes'

defineOptions({ name: 'NewWebConfigView' })

const { t } = useI18n()
const easyTierStore = useEasyTierStore()
const { show: toast } = useCreamToast()
const route = useRoute()
const router = useRouter()
const isAndroidPlatform = isAndroid()
// Android：详情为独立路由（系统返回键回列表）
const isAndroidDetailRoute = computed(
  () => isAndroidPlatform && route.name === 'NewWebConfigDetailView'
)
// Web 配置与服务操作统一从 useMockData 获取（Tauri 真实实现 / 浏览器 Mock 降级）
const {
  readWebConfigList,
  writeWebConfigList,
  getRunningWebProcesses,
  runEasyTierCoreWeb,
  killProcess,
  checkWebService,
  installWebService,
  uninstallWebService,
  startWebService,
  stopWebService
} = useMockData()

// 将 useMockData 返回的原始状态 key 映射为国际化字符串
const mapServiceStatus = (key: string): string => {
  switch (key) {
    case 'running':
      return t('newCommon.running')
    case 'stopped':
      return t('newWebConfig.stoppedService')
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

const loading = ref(false)
// 启动中标志：避免连点重复拉起进程
const isStarting = ref(false)
// 当前选中配置（Web 配置卡片数据）
const selectedConfig = ref<FormWebData | null>(null)

// 类型化的 Web 配置列表
const webConfigList = computed(() => easyTierStore.configWebList as unknown as FormWebData[])

// 首帧即丢弃缓存/文件中的运行态快照：status/pid 必须由本次进程与服务扫描重新判定。
// 否则会先渲染上次会话的“运行中”，扫描完成后才跳回真实状态。
const markRuntimeChecking = () => {
  for (const item of webConfigList.value) {
    item.status = 'checking'
    item.pid = undefined
  }
}
markRuntimeChecking()

// 表单
const formVisible = ref(false)
const formMode = ref<'add' | 'edit'>('add')
const formConfigData = ref<FormWebData | null>(null)
const configNameList = computed(() => webConfigList.value.map((c) => c.configFileName))

// 服务
const svcDialogVisible = ref(false)
const svcInstalling = ref(false)
const serviceStatusMap = ref<Map<string, string>>(new Map())
const svcForm = ref({
  installMethod: 'nssm' as 'nssm' | 'official',
  username: '',
  password: '',
  displayName: '',
  description: ''
})
const currentServiceStatus = computed(() => {
  if (!selectedConfig.value) return ''
  // 未检测到结果时保持空串（显示“检测中”），不能默认成“未安装”误导用户
  return serviceStatusMap.value.get(selectedConfig.value.configFileName) || ''
})

// 确认弹窗
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

// 运行判定：独立进程（running）或 Windows 服务（runningService）均视为运行中
const isRunning = (item: FormWebData) =>
  item.status === 'running' || item.status === 'runningService'
// 运行态未知（持久化旧值已丢弃 / 正在进行进程与服务扫描）时不得猜测运行或停止；
// Android 不探测运行态，也不应因此阻塞删除等配置管理操作
const isChecking = (item: FormWebData) =>
  !isAndroidPlatform && (!item.status || item.status === 'checking')
const getStatusClass = (item: FormWebData) =>
  isChecking(item) ? 'checking' : isRunning(item) ? 'on' : 'off'
const mapCardStatus = (item: FormWebData): string => {
  if (isChecking(item)) return t('newCommon.checking')
  switch (item.status) {
    case 'running':
      return t('newCommon.running')
    case 'runningService':
      return t('newWebConfig.runningService')
    case 'notRunning':
      return t('newCommon.stopped')
    default:
      return String(item.status)
  }
}
const getServiceDotClass = computed(() => {
  const s = currentServiceStatus.value
  if (s === 'running') return 'svc-running'
  if (s === 'stopped') return 'svc-stopped'
  if (!s) return 'svc-checking'
  return 'svc-uninstalled'
})

// ========== 数据加载 ==========
/**
 * 从进程命令行提取 --config-server 参数值（兼容 `--config-server <url>` 与 `--config-server=<url>`）
 * 用于结构化精确匹配：子串匹配会让 .../user1 误命中 .../user12 的进程
 */
const extractConfigServerUrl = (cmdLine: string): string | null => {
  const m = cmdLine.match(/--config-server(?:=|\s+)(\S+)/)
  if (!m) return null
  return m[1].replace(/^"|"$/g, '')
}
// 刷新运行时状态：进程扫描 + 服务状态合并到列表项，并恢复/初始化选中项（FAB 已负责文件加载）
const refreshWebRuntimeState = async () => {
  const list = webConfigList.value
  // 记录上一轮状态：进程扫描失败时恢复，避免把“检测失败”显示成“未运行”
  const previous = list.map((item) => ({ item, status: item.status, pid: item.pid }))
  // 扫描完成前统一显示“检测中”，避免把上一轮/持久化状态当作当前状态
  for (const item of list) item.status = 'checking'
  // 列表已被重新加载替换为全新对象：选中项立即指向新对象，避免详情继续渲染旧状态
  if (selectedConfig.value) {
    const selectedName = selectedConfig.value.configFileName
    selectedConfig.value = list.find((c) => c.configFileName === selectedName) || null
  }
  // Android 无外部进程与 Windows 服务，跳过运行态探测
  if (isAndroidPlatform) {
    for (const item of list) {
      item.status = undefined
      item.pid = undefined
    }
    return
  }
  // 检测运行中的进程
  let runList: Awaited<ReturnType<typeof getRunningWebProcesses>>
  try {
    runList = await getRunningWebProcesses()
  } catch (e) {
    console.warn('[RunningList] Web 进程扫描失败，保留上一份状态:', e)
    for (const p of previous) {
      p.item.status = p.status
      p.item.pid = p.pid
    }
    return
  }
  for (const item of list) {
    let matched = false
    if (runList?.length) {
      for (const r of runList) {
        const cmd = r.commandLine || ''
        const pid = r.pid
        const expectedUrl = `${item.protocol}://${item.host}:${item.port}/${item.userName}`
        // 精确比较 --config-server 的参数值（另保留 pid 记录匹配）
        if (extractConfigServerUrl(cmd) === expectedUrl || (item.pid && item.pid === pid)) {
          item.status = 'running'
          item.pid = pid
          matched = true
          break
        }
      }
    }
    if (!matched) {
      item.status = 'notRunning'
      // 进程已不存在：清掉旧 pid，避免展示过期 PID 或后续按失效 PID 误配
      item.pid = undefined
    }
  }
  // 检测服务状态
  for (const item of list) {
    const svcStatus = await checkWebService(item.configFileName)
    const svcKey = svcStatus as string
    if (svcKey === 'running') {
      item.status = 'runningService'
    }
    serviceStatusMap.value.set(item.configFileName, svcKey)
  }
  // 未选中时自动选中首项（桌面宽屏；Android 默认展示清单，由路由决定是否进入详情）
  if (!isAndroidPlatform && !selectedConfig.value && window.innerWidth > 900 && list.length > 0) {
    selectedConfig.value = list[0]
  }
}

// 重新加载 Web 配置列表并刷新运行时状态
const refreshWebList = async () => {
  loading.value = true
  try {
    await easyTierStore.loadWebConfigFiles()
    await refreshWebRuntimeState()
  } catch {
    /* non-Tauri */
  } finally {
    loading.value = false
  }
}

// 选中配置卡片：Android 进入详情路由（由 syncDetailFromRoute 统一加载），宽屏同时展示右侧详情
const selectConfig = (item: FormWebData) => {
  if (isAndroidPlatform && !isAndroidDetailRoute.value) {
    router.push({ name: 'NewWebConfigDetailView', query: { name: item.configFileName } })
    return
  }
  selectedConfig.value = item
}

// 移动端 master-detail：从详情返回清单
const closeWebDetail = () => {
  if (isAndroidPlatform) {
    router.replace({ name: 'NewWebConfigView' })
    return
  }
  selectedConfig.value = null
}

// Android 详情路由 → 页面状态：进入时加载对应配置，返回列表时清空详情
const syncDetailFromRoute = async () => {
  if (!isAndroidPlatform) return
  if (!easyTierStore.webConfigListLoaded) await easyTierStore.loadWebConfigFiles()
  await refreshWebRuntimeState()
  if (!isAndroidDetailRoute.value) {
    selectedConfig.value = null
    return
  }
  const name = typeof route.query.name === 'string' ? route.query.name : ''
  if (!name) {
    router.replace({ name: 'NewWebConfigView' })
    return
  }
  const item = webConfigList.value.find((c) => c.configFileName === name)
  if (!item) {
    // 列表仍在加载时不做“配置不存在”判定，加载完成后由 webConfigListLoaded 监听重试
    if (!easyTierStore.webConfigListLoaded) return
    toast(t('newWebConfig.configNotFound'), 'warning')
    router.replace({ name: 'NewWebConfigView' })
    return
  }
  selectedConfig.value = item
}

// 路由切换（系统返回键 / 直接打开详情）时同步详情态
watch(
  () => [route.name, route.query.name],
  (next, prev) => {
    if (!isAndroidPlatform) return
    const [name] = next
    const [prevName] = prev
    if (name !== 'NewWebConfigDetailView' && prevName !== 'NewWebConfigDetailView') return
    void syncDetailFromRoute()
  }
)
// 配置列表加载完成（深链打开详情时列表可能滞后）后重试同步
watch(
  () => easyTierStore.webConfigListLoaded,
  (loaded) => {
    if (loaded && isAndroidDetailRoute.value && !selectedConfig.value) {
      void syncDetailFromRoute()
    }
  }
)

// ========== CRUD ==========
// 打开新增弹窗（表单组件受控：mode 决定标题与初始值）
const openAdd = () => {
  formMode.value = 'add'
  formConfigData.value = null
  formVisible.value = true
}

// 打开编辑弹窗（以当前配置作为表单初始值）
const openEdit = () => {
  if (!selectedConfig.value) return
  formMode.value = 'edit'
  formConfigData.value = selectedConfig.value
  formVisible.value = true
}

// 表单保存回调：读最新列表 → 新增/替换 → 整体写回（避免并发覆盖）；写盘成功后才关闭弹窗
const handleFormSaved = async (data: FormWebData, done: (ok: boolean) => void) => {
  try {
    const list = await readWebConfigList()
    const idx = list.findIndex((c) => c.configFileName === data.configFileName)
    if (formMode.value === 'add') {
      list.push(data)
    } else {
      if (idx !== -1) list[idx] = data
      else list.push(data)
    }
    await writeWebConfigList(list)
    toast(
      formMode.value === 'add' ? t('newCommon.addSuccess') : t('newCommon.saveSuccess'),
      'success'
    )
    await refreshWebList()
    done(true)
  } catch {
    toast(formMode.value === 'add' ? t('newCommon.addFail') : t('newCommon.saveFail'), 'error')
    done(false)
  }
}

// 删除配置（二次确认；写回列表后刷新）
const deleteConfig = async () => {
  if (!selectedConfig.value) return
  // 运行态未判定完成时不允许删除，避免误删仍在运行的配置
  if (isChecking(selectedConfig.value)) return
  // 进程/服务仍在使用时禁止删除，否则会留下无法从 UI 停止的孤儿进程或服务
  if (isRunning(selectedConfig.value)) {
    toast(t('newCommon.deleteBlockedRunning'), 'warning', 4000)
    return
  }
  const svcStatus = serviceStatusMap.value.get(selectedConfig.value.configFileName)
  if (svcStatus && svcStatus !== 'notInstalled') {
    toast(t('newCommon.deleteBlockedService'), 'warning', 4000)
    return
  }
  const ok = await showConfirm(
    t('newWebConfig.deleteTitle'),
    t('newWebConfig.deleteMsg', { name: selectedConfig.value.configFileName })
  )
  if (!ok) return
  try {
    const list = await readWebConfigList()
    const idx = list.findIndex((c) => c.configFileName === selectedConfig.value!.configFileName)
    if (idx !== -1) list.splice(idx, 1)
    await writeWebConfigList(list)
    toast(t('newCommon.deleteSuccess'), 'success')
    selectedConfig.value = null
    if (isAndroidDetailRoute.value) router.replace({ name: 'NewWebConfigView' })
    await refreshWebList()
  } catch {
    toast(t('newCommon.deleteFail'), 'error')
  }
}

// ========== 进程管理 ==========
// 启动 Web 服务进程：以 `--config-server <url>` 拉起内核，并把新 pid 写回配置
const startWeb = async (item: FormWebData) => {
  if (isStarting.value) return
  isStarting.value = true
  let startedPid: number | null = null
  try {
    // 先确认配置存储可读：读取失败时不启动进程，避免进程已起而 pid 无法落盘
    const list = await readWebConfigList()
    const url = `${item.protocol}://${item.host}:${item.port}/${item.userName}`
    const pid = await runEasyTierCoreWeb(url)
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(t('newCommon.coreStartInvalidPid'))
    }
    startedPid = pid
    // 更新 pid
    const found = list.find((c) => c.configFileName === item.configFileName)
    if (found) {
      found.pid = pid
      found.status = 'running'
    }
    await writeWebConfigList(list)
    // pid 已持久化，后续刷新失败不应回滚已成功启动的进程
    startedPid = null
    toast(t('newCommon.startSuccess'), 'success')
    await refreshWebList()
  } catch (e: any) {
    // 进程已启动但存储失败：回滚结束进程，避免留下 UI 无法管理的孤儿进程
    if (startedPid) {
      await killProcess(startedPid).catch(() => false)
    }
    const detail = typeof e === 'string' ? e : e?.message
    const base = t('newCommon.startFail')
    toast(detail ? `${base}（${detail}）` : base, 'error', 6000)
  } finally {
    isStarting.value = false
  }
}

// 停止 Web 服务进程（无 pid 时提示无法停止——服务托管场景由服务管理处理）
const stopWeb = async (item: FormWebData) => {
  if (!item.pid) {
    toast(t('newWebConfig.stopFailNoPid'), 'error')
    return
  }
  try {
    const ok = await killProcess(item.pid)
    if (ok) {
      toast(t('newCommon.stoppedSuccess'), 'success')
    } else {
      toast(t('newCommon.stoppedFail'), 'error')
    }
  } catch {
    toast(t('newCommon.stoppedFail'), 'error')
  } finally {
    await refreshWebList()
  }
}

// 打开 Web 控制台：桌面端交给系统浏览器；Android 无 shell open 能力，改为复制地址
const openConsoleUrl = async () => {
  const url = selectedConfig.value?.webUrl
  if (!url) return
  if (isAndroidPlatform) {
    try {
      await navigator.clipboard.writeText(url)
      toast(t('newWebConfig.consoleCopied'), 'success')
    } catch {
      toast(t('newWebConfig.consoleCopyFail'), 'error')
    }
    return
  }
  openPath(url)
}

// ========== 服务管理 ==========
// 打开服务安装弹窗（默认值与当前配置绑定）
const openServiceDialog = () => {
  if (!selectedConfig.value) return
  svcForm.value = {
    installMethod: 'nssm',
    username: '',
    password: '',
    displayName: t('newWebConfig.svcDefaultWebName', { name: selectedConfig.value.configFileName }),
    description: t('newWebConfig.svcDefaultWebDesc', { name: selectedConfig.value.configFileName })
  }
  svcDialogVisible.value = true
}

// 安装服务：拼装 `--config-server` 启动参数（含可选的运行账户），安装后刷新状态
const handleServiceInstalled = async () => {
  if (!selectedConfig.value) return
  svcInstalling.value = true
  try {
    const cfg = selectedConfig.value
    const args = `--config-server ${cfg.protocol}://${cfg.host}:${cfg.port}/${cfg.userName}`
    const opts =
      svcForm.value.username && svcForm.value.password
        ? { username: svcForm.value.username, password: svcForm.value.password }
        : undefined
    const ok = await installWebService(cfg.configFileName, args, opts)
    toast(
      ok ? t('newWebConfig.svcInstallSuccess') : t('newWebConfig.svcInstallFail'),
      ok ? 'success' : 'error'
    )
    svcDialogVisible.value = false
    await refreshWebList()
  } catch {
    toast(t('newWebConfig.svcInstallFail'), 'error')
  } finally {
    svcInstalling.value = false
  }
}

// 启动 Windows 服务
const handleStartService = async () => {
  if (!selectedConfig.value) return
  try {
    const ok = await startWebService(selectedConfig.value.configFileName)
    toast(
      ok ? t('newWebConfig.svcStartSuccess') : t('newWebConfig.svcStartFail'),
      ok ? 'success' : 'error'
    )
    await refreshWebList()
  } catch {
    toast(t('newWebConfig.svcStartFail'), 'error')
  }
}

// 停止 Windows 服务
const handleStopService = async () => {
  if (!selectedConfig.value) return
  try {
    const ok = await stopWebService(selectedConfig.value.configFileName)
    toast(
      ok ? t('newWebConfig.svcStopSuccess') : t('newWebConfig.svcStopFail'),
      ok ? 'success' : 'error'
    )
    // 仅在成功时提示；失败时保留错误，不再追加“已停止”的成功文案
    if (ok) toast(t('newWebConfig.svcStopHint'), 'success', 3000)
    await refreshWebList()
  } catch {
    toast(t('newWebConfig.svcStopFail'), 'error')
  }
}

// 卸载 Windows 服务（二次确认后执行）
const handleUninstallService = async () => {
  if (!selectedConfig.value) return
  const ok = await showConfirm(
    t('newWebConfig.uninstallTitle'),
    t('newWebConfig.uninstallMsg', { name: selectedConfig.value.configFileName })
  )
  if (!ok) return
  try {
    const result = await uninstallWebService(selectedConfig.value.configFileName)
    toast(
      result ? t('newWebConfig.svcUninstallSuccess') : t('newWebConfig.svcUninstallFail'),
      result ? 'success' : 'error'
    )
    await refreshWebList()
  } catch {
    toast(t('newWebConfig.svcUninstallFail'), 'error')
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  // 注册到全局刷新回调（悬浮菜单触发时同步）
  easyTierStore.registerPageRefresh(refreshWebRuntimeState)
  if (isAndroidPlatform) {
    // Android：详情由路由决定，加载后按 query 恢复选中项
    await syncDetailFromRoute()
    return
  }
  refreshWebList()
})

onUnmounted(() => {
  easyTierStore.clearPageRefresh()
})
</script>

<style scoped>
.nwc-root {
  display: flex;
  gap: var(--theme-space-4);
  height: 100%;
  min-height: 0;
  font-family: var(--theme-font-body);
}

.nwc-left {
  display: flex;
  width: 240px;
  min-height: 0;
  flex-shrink: 0;
  flex-direction: column;
  gap: var(--theme-space-2);
}

.nwc-left-header {
  display: flex;
  min-height: 28px;
  align-items: center;
  justify-content: flex-end;
  padding: 0 var(--theme-space-1);
}

.nwc-add-btn {
  color: var(--theme-accent-primary);
}

.nwc-add-btn:active {
  background: var(--theme-bg-active);
  transform: scale(0.94);
}

@media (hover: hover) {
  .nwc-add-btn:hover {
    background: var(--theme-bg-hover);
  }
}

.nwc-left-scroll {
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

.nwc-card {
  padding: var(--theme-space-4);
  overflow: hidden;
  cursor: pointer;
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  transition: var(--theme-transition-surface);
  flex-shrink: 0;
}

.nwc-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--theme-shadow-sm);
}

.nwc-card.active {
  border-color: var(--theme-accent-primary);
  box-shadow: 0 0 0 2px var(--theme-bg-active);
}

.nwc-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--theme-space-1);
}

.nwc-card-status {
  display: flex;
  align-items: center;
  gap: var(--theme-space-1);
}

.nwc-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--theme-radius-round);
}

.nwc-dot.on {
  background: var(--theme-color-success);
}

.nwc-dot.off {
  background: var(--theme-text-muted);
}

.nwc-dot.checking {
  background: var(--theme-border);
  animation: nwc-pulse 1s infinite;
}

.nwc-status-text {
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nwc-card-pid {
  font-size: 11px;
  color: var(--theme-text-muted);
}

.nwc-card-name {
  margin-bottom: 2px;
  font-family: var(--theme-font-display);
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.nwc-card-sub {
  margin-bottom: var(--theme-space-3);
  font-size: 12px;
  color: var(--theme-text-muted);
}

.nwc-card-actions {
  display: flex;
  gap: var(--theme-space-2);
}

.nwc-right {
  min-height: 0;
  padding: var(--theme-space-5) var(--theme-space-6);
  overflow-y: auto;
  background: var(--theme-bg-card);
  border: 1.5px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  flex: 1;
}

/* 移动端返回按钮（默认隐藏，仅窄屏在详情头部展示；提高选择器优先级覆盖 LtButton 默认 display） */
.nwc-detail-title-row .nwc-back-btn {
  display: none;
}

/* 移动端适配：master-detail 互斥，列表与详情单独展示 */
@media (width <= 900px) {
  .nwc-root {
    flex-direction: column;
  }

  .nwc-left {
    width: 100%;
    flex: 1;
  }

  /* 未选中时隐藏空状态卡片，仅展示列表 */
  .nwc-root:not(.nwc-detail-open) .nwc-right {
    display: none;
  }

  /* 选中详情后隐藏列表，仅展示详情 */
  .nwc-detail-open .nwc-left {
    display: none;
  }

  .nwc-right {
    flex: 1;
    padding: var(--theme-space-4);
  }

  .nwc-detail-title-row .nwc-back-btn {
    display: inline-flex;
  }

  .nwc-detail-actions .nwc-detail-lifecycle {
    display: inline-flex;
  }
}

/* 手机尺寸：字段网格降为单列，避免长值被挤成两行 */
@media (width <= 480px) {
  .nwc-root .nwc-grid {
    grid-template-columns: 1fr;
  }
}

.nwc-detail-header {
  display: flex;
  padding-bottom: var(--theme-space-4);
  margin-bottom: var(--theme-space-4);
  border-bottom: 2px solid var(--theme-border-light);
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--theme-space-3);
}

.nwc-detail-title-row {
  display: flex;
  align-items: center;
  gap: var(--theme-space-3);
  flex-wrap: wrap;
  min-width: 0;
}

.nwc-detail-title {
  margin: 0;
  font-family: var(--theme-font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--theme-text-primary);
  overflow-wrap: break-word;
}

.nwc-badge {
  padding: 2px var(--theme-space-3);
  font-family: var(--theme-font-body);
  font-size: 11px;
  white-space: nowrap;
  border-radius: var(--theme-radius-pill);
}

.nwc-badge.on {
  color: var(--theme-color-success-dark);
  background: color-mix(in srgb, var(--theme-color-success) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-color-success) 18%, transparent);
}

.nwc-badge.off {
  color: var(--theme-text-muted);
  background: color-mix(in srgb, var(--theme-text-muted) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-text-muted) 18%, transparent);
}

.nwc-badge.checking {
  color: var(--theme-text-muted);
  background: color-mix(in srgb, var(--theme-text-muted) 6%, transparent);
  border: 1px dashed color-mix(in srgb, var(--theme-text-muted) 24%, transparent);
}

.nwc-detail-actions {
  display: flex;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

/* 宽屏列表卡片已提供生命周期操作，详情不再重复；窄屏列表隐藏时才显示。
   用宽度条件而非基础 display:none，避免与上方窄屏媒体查询同优先级时被后续规则覆盖 */
@media (width > 900px) {
  .nwc-detail-actions .nwc-detail-lifecycle {
    display: none;
  }
}

/* Android：说明本机能力边界，避免误以为配置不可用 */
.nwc-platform-hint {
  padding: var(--theme-space-2) var(--theme-space-3);
  margin: 0 0 var(--theme-space-4);
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-muted);
  background: color-mix(in srgb, var(--theme-accent-primary) 6%, transparent);
  border-radius: var(--theme-radius-md);
}

.nwc-section {
  margin-bottom: var(--theme-space-4);
}

.nwc-section-title {
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

.nwc-section-title::after {
  height: 2px;
  background: linear-gradient(90deg, var(--theme-border-light), transparent);
  content: '';
  flex: 1;
}

.nwc-grid {
  display: grid;
  overflow: hidden;
  background: var(--theme-border-light);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
}

.nwc-field {
  display: flex;
  padding: var(--theme-space-3) var(--theme-space-4);
  background: var(--theme-bg-card);
  flex-direction: column;
  gap: 2px;
}

.nwc-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 1.2px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.nwc-val {
  font-size: 13px;
  color: var(--theme-text-primary);
  word-break: break-all;
}

/* 裸按钮默认 stretch + 内容居中，会在值单元格里把链接顶到中间；
   改为按内容收缩并左对齐，长地址在窄屏下仍可换行 */
.nwc-link {
  max-width: 100%;
  color: var(--theme-accent-primary);
  text-align: left;
  text-decoration: underline;
  word-break: break-all;
  white-space: normal;
  cursor: pointer;
  align-self: flex-start;
  justify-content: flex-start;
}

.nwc-link:hover {
  filter: brightness(1.2);
}

.nwc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--theme-space-2);
  opacity: 0.5;
}

.nwc-empty-icon {
  font-size: 40px;
  color: var(--theme-color-scrollbar);
}

.nwc-empty p {
  margin: 0;
  font-size: 13px;
  color: var(--theme-text-muted);
}

.nwc-empty-cards {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--theme-space-10) 0;
  gap: var(--theme-space-2);
  color: var(--theme-text-muted);
}

.nwc-empty-cards p {
  margin: 0;
  font-size: 14px;
}

/* ===== Android：总览式分组列表与详情 ===== */
.nwc-root.nwc-android {
  display: block;
  height: auto;
  min-height: auto;
}

.nwc-root.nwc-android .nwc-left {
  display: flex;
  width: 100%;
  flex: none;
  flex-direction: column;
}

.nwc-root.nwc-android .nwc-left-header {
  padding: 0;
}

.nwc-root.nwc-android .nwc-left-scroll {
  display: block;
  padding: 0;
  overflow: visible;
  background: transparent;
  border-radius: 0;
  flex: none;
}

/* --- 分组列表 --- */
.nwc-root.nwc-android .nwc-card-list {
  overflow: hidden;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
}

.nwc-row {
  display: flex;
  min-height: 60px;
  padding: 10px 14px 10px 12px;
  cursor: pointer;
  align-items: center;
  gap: var(--theme-space-3);
  -webkit-tap-highlight-color: transparent;
  box-sizing: border-box;
}

.nwc-row + .nwc-row {
  border-top: 1px solid var(--theme-border-light);
}

.nwc-row:active {
  background: var(--theme-bg-hover);
}

.nwc-row-icon {
  display: flex;
  width: 36px;
  height: 36px;
  color: var(--theme-accent-primary);
  background: color-mix(in srgb, var(--theme-accent-primary) 10%, transparent);
  border-radius: 11px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.nwc-row-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.nwc-row-name {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nwc-row-sub {
  overflow: hidden;
  font-size: 11px;
  color: var(--theme-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nwc-row-chev {
  color: var(--theme-text-muted);
  opacity: 0.5;
  flex-shrink: 0;
}

@media (hover: hover) {
  .nwc-row:hover {
    background: var(--theme-bg-hover);
  }
}

/* --- 空状态 --- */
.nwc-root.nwc-android .nwc-empty-cards {
  padding: 34px var(--theme-space-5);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  gap: 6px;
}

.nwc-root.nwc-android .nwc-empty-icon {
  display: flex;
  width: 54px;
  height: 54px;
  margin-bottom: 2px;
  font-size: 24px;
  color: var(--theme-accent-primary);
  background: color-mix(in srgb, var(--theme-accent-primary) 10%, transparent);
  border-radius: var(--theme-radius-round);
  align-items: center;
  justify-content: center;
}

.nwc-root.nwc-android .nwc-empty-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.nwc-root.nwc-android .nwc-empty-desc {
  font-size: 11.5px;
}

.nwc-root.nwc-android .nwc-empty-cta {
  margin-top: 8px;
}

/* --- 详情页（独立路由，列表与详情互斥） --- */
.nwc-root.nwc-android .nwc-right {
  display: none;
  padding: 0;
  overflow: visible;
  background: transparent;
  border: none;
  border-radius: 0;
}

.nwc-root.nwc-android.nwc-detail-open .nwc-left {
  display: none;
}

.nwc-root.nwc-android.nwc-detail-open .nwc-right {
  display: block;
}

.nwc-root.nwc-android .nwc-detail-header {
  display: flex;
  padding: var(--theme-space-5);
  margin: 0 0 var(--theme-space-4);
  background:
    radial-gradient(
      120% 90% at 100% 0%,
      color-mix(in srgb, var(--theme-accent-primary) 12%, transparent),
      transparent 62%
    ),
    var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xxl);
  align-items: stretch;
  flex-direction: column;
  gap: var(--theme-space-3);
}

.nwc-root.nwc-android .nwc-detail-title-row {
  gap: 8px;
}

.nwc-root.nwc-android .nwc-detail-title {
  font-size: 21px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.2px;
}

.nwc-root.nwc-android .nwc-badge {
  padding: 3px 9px;
  font-size: 10.5px;
}

.nwc-root.nwc-android .nwc-badge-proto {
  color: var(--theme-accent-primary);
  background: color-mix(in srgb, var(--theme-accent-primary) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--theme-accent-primary) 18%, transparent);
}

.nwc-root.nwc-android .nwc-detail-actions {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.nwc-root.nwc-android .nwc-detail-actions .nwc-detail-btn {
  height: 42px;
  min-width: 0;
  padding: 0 10px;
  font-size: 13px;
  font-weight: 600;
}

/* --- 详情分组：标题在外，字段为分隔行 --- */
.nwc-root.nwc-android .nwc-section {
  margin-bottom: var(--theme-space-4);
}

.nwc-root.nwc-android .nwc-section-title {
  margin: 0 2px var(--theme-space-2);
  font-family: var(--theme-font-body);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
  gap: 0;
}

.nwc-root.nwc-android .nwc-section-title::after {
  display: none;
}

.nwc-root.nwc-android .nwc-grid {
  display: block;
  overflow: hidden;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
}

.nwc-root.nwc-android .nwc-field {
  display: flex;
  padding: 12px 14px;
  background: transparent;
  border-top: 1px solid var(--theme-border-light);
  flex-direction: row;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--theme-space-3);
}

.nwc-root.nwc-android .nwc-grid > :first-child {
  border-top: none;
}

.nwc-root.nwc-android .nwc-label {
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--theme-text-secondary);
  text-transform: none;
  flex-shrink: 0;
}

.nwc-root.nwc-android .nwc-val {
  min-width: 0;
  font-size: 12.5px;
  text-align: right;
  overflow-wrap: anywhere;
  word-break: normal;
}

.nwc-root.nwc-android .nwc-link {
  max-width: 62%;
  text-align: right;
  align-self: center;
  justify-content: flex-end;
}

.nwc-root.nwc-android .nwc-platform-hint {
  margin-bottom: var(--theme-space-4);
}

.nwc-danger-zone {
  margin-top: var(--theme-space-5);
}

.nwc-danger-btn {
  height: 48px;
  border-radius: var(--theme-radius-lg, 14px);
}

/* 详情加载态也使用卡片容器 */
.nwc-root.nwc-android .nwc-empty {
  height: auto;
  padding: 44px var(--theme-space-5);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xxl);
  opacity: 1;
}

.nwc-state-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--theme-border);
  border-top-color: var(--theme-accent-primary);
  border-radius: var(--theme-radius-round);
  animation: nwc-spin 0.8s linear infinite;
}

@keyframes nwc-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 服务管理 */
.nwc-svc-bar {
  display: flex;
  padding: var(--theme-space-3) var(--theme-space-4);
  background: var(--theme-bg-tag);
  border: 1.5px solid var(--theme-border-light);
  border-radius: var(--theme-radius-md);
  align-items: center;
  justify-content: space-between;
}

.nwc-svc-status {
  display: flex;
  align-items: center;
  gap: var(--theme-space-2);
}

.nwc-svc-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--theme-radius-round);
}

.nwc-svc-dot.svc-running {
  background: var(--theme-color-success);
  box-shadow: 0 0 6px color-mix(in srgb, var(--theme-color-success) 40%, transparent);
}

.nwc-svc-dot.svc-stopped {
  background: var(--theme-text-muted);
}

.nwc-svc-dot.svc-uninstalled {
  background: var(--theme-border);
}

.nwc-svc-dot.svc-checking {
  background: var(--theme-border);
  animation: nwc-pulse 1s infinite;
}

@keyframes nwc-pulse {
  0%,
  100% {
    opacity: 0.4;
  }

  50% {
    opacity: 1;
  }
}

.nwc-svc-text {
  font-size: 13px;
  color: var(--theme-text-primary);
}

.nwc-svc-actions {
  display: flex;
  gap: var(--theme-space-2);
}

/* 服务安装弹窗 */
.nwc-svc-form {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-4);
}

.nwc-svc-field {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-1);
}

.nwc-svc-radio-group {
  display: flex;
  gap: var(--theme-space-3);
}

/* 复用 wcf-* 样式（原定义在 WebConfigForm.vue scoped 中，跨组件不生效） */
.wcf-label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  color: var(--theme-text-muted, #c8bdb2);
  text-transform: uppercase;
}

.wcf-radio {
  position: relative;
  display: inline-flex;
  padding: var(--theme-space-2) var(--theme-space-4);
  font-size: 13px;
  color: var(--theme-text-secondary, #7a6e5e);
  cursor: pointer;
  background: transparent;
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: var(--theme-transition-interactive);
  align-items: center;
  gap: var(--theme-space-2);
}

.wcf-radio:hover {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

/* 原生 radio 隐藏后，键盘聚焦时在整个胶囊上显示焦点环 */
.wcf-radio:has(input:focus-visible) {
  outline: 2px solid var(--theme-accent-primary, #e8a0a0);
  outline-offset: 2px;
}

.wcf-radio.active {
  color: var(--theme-accent-primary, #e8a0a0);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 6%, transparent);
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.wcf-radio-dot {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: 50%;
  transition: var(--theme-transition-colors);
}

.wcf-radio.active .wcf-radio-dot {
  background: var(--theme-accent-primary, #e8a0a0);
  border-color: var(--theme-accent-primary, #e8a0a0);
  box-shadow: inset 0 0 0 2px var(--theme-bg-card, #fff);
}

.wcf-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.nwc-footer-actions {
  display: flex;
  gap: var(--theme-space-2);
}

.wcf-footer-hint {
  padding: var(--theme-space-2) var(--theme-space-3);
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme-text-muted, #c8bdb2);
  background: color-mix(in srgb, var(--theme-accent-primary, #e8a0a0) 4%, transparent);
  border-radius: var(--theme-radius-sm, 6px);
}

/* 确认弹窗 */
.cfm-msg {
  padding: var(--theme-space-1) 0 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--theme-text-secondary);
}

.cfm-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--theme-space-3);
  margin-top: var(--theme-space-4);
}
</style>
