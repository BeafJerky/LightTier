<template>
  <div
    class="nwc-root"
    :class="{
      'nwc-android': isAndroidPlatform,
      'nwc-list-empty': isListEmpty,
      'nwc-detail-open': isAndroidPlatform
        ? isAndroidDetailRoute || (isWideLandscape && !!selectedConfig)
        : !!selectedConfig
    }"
  >
    <WebConfigList
      :items="webConfigList"
      :selected-name="selectedConfig?.configFileName ?? null"
      :loading="easyTierStore.webConfigListLoading"
      :is-android="isAndroidPlatform"
      @add="openAdd"
      @select="selectConfig"
      @start="startWeb"
      @stop="stopWeb"
    />

    <WebConfigDetail
      v-if="selectedConfig"
      :config="selectedConfig"
      :is-android="isAndroidPlatform"
      :service-status="currentServiceStatus"
      @back="closeWebDetail"
      @edit="openEdit"
      @open-console="openConsoleUrl"
      @start="handleDetailStart"
      @stop="handleDetailStop"
      @delete="deleteConfig"
      @install-service="openServiceDialog"
      @start-service="handleStartService"
      @stop-service="handleStopService"
      @uninstall-service="handleUninstallService"
    />

    <div class="nwc-right" v-else>
      <div
        v-if="isAndroidPlatform && (loading || easyTierStore.webConfigListLoading)"
        class="nwc-empty"
      >
        <span class="nwc-state-spinner" aria-hidden="true"></span>
        <p>{{ t('newCommon.checking') }}</p>
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
import { useEasyTierStore } from '@/shared/store/easytier'
import { useMockData } from '@/shared/platform/mockData'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { openPath } from '@/shared/platform/fileUtil'
import { isAndroid } from '@/shared/platform/platformUtil'
import { useWideLandscape } from '@/shared/composables/useWideLandscape'
import CreamDialog from '@/shared/ui/CreamDialog.vue'
import { LtButton, LtInput } from '@/shared/ui'
import WebConfigForm from './WebConfigForm.vue'
import WebConfigList from './WebConfigList.vue'
import WebConfigDetail from './WebConfigDetail.vue'
import { isWebChecking, isWebRunning, isWebServiceStatusPending } from '../../lib/webConfigStatus'
import { resolveServiceStatuses } from '@/shared/lib/serviceStatusCache'
import type { FormWebData } from '@/entities/config/formTypes'

defineOptions({ name: 'NewWebConfigView' })

const { t } = useI18n()
const easyTierStore = useEasyTierStore()
const { show: toast } = useCreamToast()
const route = useRoute()
const router = useRouter()
const isAndroidPlatform = isAndroid()
// 横屏宽屏：列表与详情左右分栏，选中走本地状态而非详情路由
const isWideLandscape = useWideLandscape()
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

const loading = ref(false)
// 启动中标志：避免连点重复拉起进程
const isStarting = ref(false)
// 当前选中配置（Web 配置卡片数据）
const selectedConfig = ref<FormWebData | null>(null)

// 类型化的 Web 配置列表
const webConfigList = computed(() => easyTierStore.configWebList)

// 空列表（加载完成且无配置）：横屏分栏下右栏没有可展示内容，避免与左侧空态重复
const isListEmpty = computed(
  () =>
    isAndroidPlatform &&
    webConfigList.value.length === 0 &&
    !loading.value &&
    !easyTierStore.webConfigListLoading
)

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

const isRunning = (item: FormWebData) => isWebRunning(item)
const isChecking = (item: FormWebData) => isWebChecking(item, isAndroidPlatform)

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
// 服务检测不阻塞列表加载；刷新序号用于丢弃重叠刷新的过期回调
let runtimeRefreshSeq = 0
const refreshWebRuntimeState = async (forceServiceStatus = false) => {
  const seq = ++runtimeRefreshSeq
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
  // 服务状态先回传 TTL 缓存，缺失项并发检测；不阻塞列表渲染
  void resolveServiceStatuses(
    'web-config',
    list.map((item) => item.configFileName),
    async (configFileName) => (await checkWebService(configFileName)) as string,
    (configFileName, serviceStatus) => {
      if (seq !== runtimeRefreshSeq) return
      serviceStatusMap.value.set(configFileName, serviceStatus)
      if (serviceStatus === 'running') {
        const item = list.find((c) => c.configFileName === configFileName)
        if (item) item.status = 'runningService'
      }
    },
    { force: forceServiceStatus }
  )
  // 未选中时自动选中首项（桌面宽屏；Android 默认展示清单，由路由决定是否进入详情）
  if (!isAndroidPlatform && !selectedConfig.value && window.innerWidth > 900 && list.length > 0) {
    selectedConfig.value = list[0]
  }
}

// 重新加载 Web 配置列表并刷新运行时状态
// forceServiceStatus：服务安装/启停/卸载后强制重新检测，忽略 TTL 缓存
const refreshWebList = async (options: { forceServiceStatus?: boolean } = {}) => {
  loading.value = true
  try {
    await easyTierStore.loadWebConfigFiles()
    await refreshWebRuntimeState(options.forceServiceStatus)
  } catch {
    /* non-Tauri */
  } finally {
    loading.value = false
  }
}

// 选中配置卡片：Android 进入详情路由（由 syncDetailFromRoute 统一加载），宽屏同时展示右侧详情
const selectConfig = (item: FormWebData) => {
  // Android 横屏分栏：列表常驻，本地选中即可（不跳详情路由，保留根工具栏与底栏）
  if (isAndroidPlatform && isWideLandscape.value) {
    selectedConfig.value = item
    return
  }
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
  // 服务状态延后检测：尚无结果时不能当作“未安装服务”放行删除
  if (isWebServiceStatusPending(isAndroidPlatform, svcStatus)) {
    toast(t('newCommon.deleteBlockedChecking'), 'warning', 4000)
    return
  }
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

const handleDetailStart = () => {
  if (selectedConfig.value) void startWeb(selectedConfig.value)
}
const handleDetailStop = () => {
  if (selectedConfig.value) void stopWeb(selectedConfig.value)
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
    await refreshWebList({ forceServiceStatus: true })
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
    await refreshWebList({ forceServiceStatus: true })
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
    await refreshWebList({ forceServiceStatus: true })
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
    await refreshWebList({ forceServiceStatus: true })
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
  // 使在途的服务检测回调失效，避免卸载后写回已销毁页面的状态
  runtimeRefreshSeq++
  easyTierStore.clearPageRefresh()
})
</script>

<style scoped lang="less">
@import url('./styles/page.less');
</style>
