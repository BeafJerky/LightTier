<template>
  <div class="nwc-root" :class="{ 'nwc-detail-open': !!selectedConfig }">
    <!-- 左侧配置列表 -->
    <div class="nwc-left">
      <div class="nwc-left-header">
        <div class="nwc-left-label">{{ t('newWebConfig.webConfigLabel') }}</div>
        <div class="nwc-left-btns">
          <button
            type="button"
            class="nwc-add-btn"
            @click="openAdd"
            :title="t('newWebConfig.addConfig')"
            :aria-label="t('newWebConfig.addConfig')"
            >+</button
          >
        </div>
      </div>
      <div class="nwc-left-scroll" v-loading="easyTierStore.webConfigListLoading">
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
            <span v-if="item.pid" class="nwc-card-pid">PID {{ item.pid }}</span>
          </div>
          <div class="nwc-card-name">{{ item.configFileName }}</div>
          <div class="nwc-card-sub">{{ item.host }}:{{ item.port }}</div>
          <div class="nwc-card-actions" @click.stop>
            <!-- 单一生命周期主操作：按状态在运行/停止之间切换 -->
            <button
              type="button"
              class="nwc-btn"
              :class="isRunning(item) ? 'nwc-btn-stop' : 'nwc-btn-run'"
              @click="isRunning(item) ? stopWeb(item) : startWeb(item)"
              >{{ isRunning(item) ? t('newCommon.stop') : t('newCommon.run') }}</button
            >
          </div>
        </div>
        <div
          v-if="webConfigList.length === 0 && !easyTierStore.webConfigListLoading"
          class="nwc-empty-cards"
        >
          <span class="nwc-empty-icon">✦</span>
          <p>{{ t('newCommon.noWebConfig') }}</p>
        </div>
      </div>
    </div>

    <!-- 右侧详情 -->
    <div class="nwc-right" v-if="selectedConfig">
      <div class="nwc-detail-header">
        <div class="nwc-detail-title-row">
          <button type="button" class="nwc-back-btn" @click="closeWebDetail">
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
          <h3 class="nwc-detail-title">{{ selectedConfig.configFileName }}</h3>
          <span class="nwc-badge" :class="isRunning(selectedConfig) ? 'on' : 'off'">
            {{
              isRunning(selectedConfig)
                ? '● ' + t('newCommon.running')
                : '○ ' + t('newCommon.stopped')
            }}
          </span>
        </div>
        <div class="nwc-detail-actions">
          <button type="button" class="nwc-btn-lg nwc-btn-edit" @click="openEdit">{{
            t('newCommon.edit')
          }}</button>
          <!-- 窄屏列表不可见，详情保留唯一的上下文生命周期操作；宽屏由列表卡片承担 -->
          <button
            type="button"
            class="nwc-btn-lg nwc-detail-lifecycle"
            :class="isRunning(selectedConfig) ? 'nwc-btn-kill' : 'nwc-btn-start'"
            @click="isRunning(selectedConfig) ? stopWeb(selectedConfig) : startWeb(selectedConfig)"
            >{{ isRunning(selectedConfig) ? t('newCommon.stop') : t('newCommon.run') }}</button
          >
          <button type="button" class="nwc-btn-lg nwc-btn-del" @click="deleteConfig">{{
            t('newCommon.delete')
          }}</button>
        </div>
      </div>

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
            <button
              v-if="selectedConfig.webUrl"
              type="button"
              class="nwc-val nwc-link"
              :title="selectedConfig.webUrl"
              @click="openConsoleUrl"
              >{{ selectedConfig.webUrl }}</button
            >
            <span class="nwc-val" v-else>—</span>
          </div>
        </div>
      </div>

      <!-- 服务管理 -->
      <div class="nwc-section"
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
              <button
                type="button"
                class="nwc-btn-lg nwc-btn-svc-install"
                @click="openServiceDialog"
                >{{ t('newWebConfig.installService') }}</button
              >
            </template>
            <template v-else>
              <button
                type="button"
                class="nwc-btn-sm nwc-btn-svc-start"
                :disabled="currentServiceStatus === 'running'"
                @click="handleStartService"
                >{{ t('newCommon.start') }}</button
              >
              <button
                type="button"
                class="nwc-btn-sm nwc-btn-svc-stop"
                :disabled="currentServiceStatus !== 'running'"
                @click="handleStopService"
                >{{ t('newCommon.stop') }}</button
              >
              <button
                type="button"
                class="nwc-btn-sm nwc-btn-svc-uninstall"
                @click="handleUninstallService"
                >{{ t('newConfig.uninstall') }}</button
              >
            </template>
          </div>
        </div>
      </div>
    </div>

    <div class="nwc-right" v-else>
      <div class="nwc-empty"
        ><span class="nwc-empty-icon">✦</span><p>{{ t('newWebConfig.selectWebConfig') }}</p></div
      >
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
          <label class="wcf-label" :for="fieldId('svc-user')">{{
            t('newWebConfig.runUser')
          }}</label>
          <input
            :id="fieldId('svc-user')"
            class="wcf-input"
            v-model="svcForm.username"
            :placeholder="t('newWebConfig.runUserPlaceholder')"
          />
        </div>
        <div class="nwc-svc-field" v-if="svcForm.username">
          <label class="wcf-label" :for="fieldId('svc-password')">{{
            t('newWebConfig.userPassword')
          }}</label>
          <input
            :id="fieldId('svc-password')"
            class="wcf-input"
            v-model="svcForm.password"
            type="password"
            autocomplete="new-password"
            :placeholder="t('newWebConfig.passwordPlaceholder')"
          />
        </div>
      </template>
      <template v-if="svcForm.installMethod === 'official'">
        <div class="nwc-svc-field">
          <label class="wcf-label" :for="fieldId('svc-name')">{{
            t('newWebConfig.displayName')
          }}</label>
          <input
            :id="fieldId('svc-name')"
            class="wcf-input"
            v-model="svcForm.displayName"
            :placeholder="t('newWebConfig.displayNamePlaceholder')"
          />
        </div>
        <div class="nwc-svc-field">
          <label class="wcf-label" :for="fieldId('svc-desc')">{{
            t('newWebConfig.svcDesc')
          }}</label>
          <input
            :id="fieldId('svc-desc')"
            class="wcf-input"
            v-model="svcForm.description"
            :placeholder="t('newWebConfig.svcDescPlaceholder')"
          />
        </div>
      </template>
    </div>
    <template #footer>
      <div class="wcf-footer">
        <span class="wcf-footer-hint">{{ t('newWebConfig.installHint') }}</span>
        <div>
          <button
            type="button"
            class="nwc-btn-cfm nwc-btn-cfm-cancel"
            @click="svcDialogVisible = false"
            >{{ t('newCommon.cancel') }}</button
          >
          <button
            type="button"
            class="nwc-btn-cfm nwc-btn-cfm-ok"
            :disabled="svcInstalling"
            @click="handleServiceInstalled"
            >{{ svcInstalling ? t('newCommon.installing') : t('newWebConfig.install') }}</button
          >
        </div>
      </div>
    </template>
  </CreamDialog>

  <!-- 确认弹窗 -->
  <CreamDialog v-model="cfmVisible" :title="cfmTitle" width="400px">
    <p class="cfm-msg">{{ cfmMessage }}</p>
    <template #footer>
      <div class="cfm-footer">
        <button
          type="button"
          class="nwc-btn-cfm nwc-btn-cfm-cancel"
          @click="resolveConfirm(false)"
          >{{ t('newCommon.cancel') }}</button
        >
        <button type="button" class="nwc-btn-cfm nwc-btn-cfm-ok" @click="resolveConfirm(true)">{{
          t('newCommon.confirm')
        }}</button>
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
 * 平台差异：窄屏 master-detail 互斥展示；控制台地址可点击直接打开外部浏览器。
 */
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useEasyTierStore } from '@/store/modules/easytier'
import { useMockData } from '@/hooks/useMockData'
import { useCreamToast } from '@/hooks/useCreamToast'
import { openPath } from '@/utils/fileUtil'
import CreamDialog from '@/components/CreamDialog/index.vue'
import WebConfigForm from './WebConfigForm.vue'
import type { FormWebData } from '@/types/formTypes'

defineOptions({ name: 'NewWebConfigView' })

const { t } = useI18n()
const easyTierStore = useEasyTierStore()
const { show: toast } = useCreamToast()
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
// 服务安装表单的 label/输入框关联 id（Vue 3.5 useId 避免多实例冲突）
const uid = useId()
const fieldId = (key: string) => `nwc-${uid}-${key}`
const currentServiceStatus = computed(() => {
  if (!selectedConfig.value) return ''
  return serviceStatusMap.value.get(selectedConfig.value.configFileName) || 'notInstalled'
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
const getStatusClass = (item: FormWebData) => (isRunning(item) ? 'on' : 'off')
const mapCardStatus = (item: FormWebData): string => {
  switch (item.status) {
    case 'running':
      return t('newCommon.running')
    case 'runningService':
      return t('newWebConfig.runningService')
    case 'notRunning':
      return t('newCommon.stopped')
    default:
      return item.status ? String(item.status) : t('newCommon.stopped')
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
  // 检测运行中的进程
  const runList = await getRunningWebProcesses()
  for (const item of list) {
    item.status = 'notRunning'
    if (runList?.length) {
      for (const r of runList) {
        const cmd = r.commandLine || ''
        const pid = r.pid
        const expectedUrl = `${item.protocol}://${item.host}:${item.port}/${item.userName}`
        // 精确比较 --config-server 的参数值（另保留 pid 记录匹配）
        if (extractConfigServerUrl(cmd) === expectedUrl || (item.pid && item.pid === pid)) {
          item.status = 'running'
          if (!item.pid) item.pid = pid
          break
        }
      }
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
  // 恢复选中
  if (selectedConfig.value) {
    const found = list.find((c) => c.configFileName === selectedConfig.value!.configFileName)
    selectedConfig.value = found || list[0] || null
  } else if (window.innerWidth > 900 && list.length > 0) {
    // 窄屏（移动端）默认展示清单，不自动进入详情
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

// 选中配置卡片（宽屏同时展示右侧详情）
const selectConfig = (item: FormWebData) => {
  selectedConfig.value = item
}

// 移动端 master-detail：从详情返回清单
const closeWebDetail = () => {
  selectedConfig.value = null
}

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

// 打开 Web 控制台（系统默认浏览器/文件管理器）
const openConsoleUrl = () => {
  if (selectedConfig.value?.webUrl) openPath(selectedConfig.value.webUrl)
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
onMounted(() => {
  // 如果 store 尚未加载，先加载
  if (!easyTierStore.webConfigListLoaded) {
    easyTierStore.loadWebConfigFiles()
  }
  // 注册到全局刷新回调（悬浮菜单触发时同步）
  easyTierStore.registerPageRefresh(refreshWebRuntimeState)
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

.nwc-left-label {
  padding: 0 var(--theme-space-1);
  font-family: var(--theme-font-display);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 2px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.nwc-left-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--theme-space-1);
}

.nwc-left-btns {
  display: flex;
  align-items: center;
  gap: var(--theme-space-1);
}

.nwc-add-btn {
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

.nwc-add-btn:hover {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
  border-color: var(--theme-accent-primary);
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
  transition: all 0.3s var(--theme-ease-spring);
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

.nwc-btn {
  padding: var(--theme-space-1) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.25s;
}

.nwc-btn-run {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
}

.nwc-btn-run:hover:not(:disabled) {
  transform: scale(1.04);
}

.nwc-btn-stop {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nwc-btn-stop:hover:not(:disabled) {
  background: var(--theme-bg-active);
}

.nwc-btn:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
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

/* 移动端返回按钮（默认隐藏，仅窄屏在详情头部展示） */
.nwc-back-btn {
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

.nwc-back-btn:hover {
  color: var(--theme-text-primary);
  background: var(--theme-bg-active);
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

  .nwc-back-btn {
    display: flex;
  }

  .nwc-detail-lifecycle {
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

.nwc-detail-actions {
  display: flex;
  gap: var(--theme-space-2);
  flex-wrap: wrap;
}

/* 宽屏列表卡片已提供生命周期操作，详情不再重复；窄屏列表隐藏时才显示 */
.nwc-detail-lifecycle {
  display: none;
  align-items: center;
}

.nwc-btn-lg {
  padding: var(--theme-space-2) var(--theme-space-5);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.25s;
}

.nwc-btn-start {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
}

.nwc-btn-start:hover:not(:disabled) {
  transform: translateY(-1px);
}

.nwc-btn-edit {
  color: var(--theme-text-primary);
  background: var(--theme-bg-hover);
  border: 1.5px solid var(--theme-border);
}

.nwc-btn-edit:hover:not(:disabled) {
  color: var(--theme-accent-primary);
  border-color: var(--theme-accent-primary);
}

.nwc-btn-kill {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nwc-btn-kill:hover:not(:disabled) {
  transform: translateY(-1px);
}

.nwc-btn-del {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
  border: 1.5px solid color-mix(in srgb, var(--theme-accent-primary) 30%, transparent);
}

.nwc-btn-del:hover:not(:disabled) {
  color: var(--theme-accent-primary);
  border-color: var(--theme-accent-primary);
  transform: translateY(-1px);
}

.nwc-btn-lg:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
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

.nwc-link {
  padding: 0;
  font-family: inherit;
  color: var(--theme-accent-primary);
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
  background: none;
  border: none;
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

.nwc-btn-sm {
  padding: var(--theme-space-1) var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  border-radius: var(--theme-radius-pill);
  transition: all 0.2s;
}

.nwc-btn-svc-install {
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

.nwc-btn-svc-install:hover:not(:disabled) {
  transform: translateY(-1px);
}

.nwc-btn-svc-start {
  color: var(--theme-text-white);
  background: var(--theme-color-success);
}

.nwc-btn-svc-start:hover:not(:disabled) {
  transform: scale(1.04);
}

.nwc-btn-svc-stop {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-hover);
}

.nwc-btn-svc-stop:hover:not(:disabled) {
  background: var(--theme-bg-active);
}

.nwc-btn-svc-uninstall {
  color: var(--theme-text-muted);
  background: var(--theme-bg-hover);
  border: 1px solid var(--theme-border);
}

.nwc-btn-svc-uninstall:hover:not(:disabled) {
  color: var(--theme-accent-primary);
  border-color: var(--theme-accent-primary);
}

.nwc-btn-sm:disabled,
.nwc-btn-svc-install:disabled {
  cursor: not-allowed;
  opacity: 0.3;
  transform: none !important;
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

.wcf-input {
  padding: var(--theme-space-2) var(--theme-space-4);
  font-family: var(--theme-font-body, 'Sora', sans-serif);
  font-size: 13px;
  color: var(--theme-text-primary, #4a3728);
  background: var(--theme-bg-card, #fff);
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  outline: none;
  transition: border-color 0.2s;
}

.wcf-input:focus {
  border-color: var(--theme-accent-primary, #e8a0a0);
}

.wcf-radio {
  display: inline-flex;
  padding: var(--theme-space-2) var(--theme-space-4);
  font-size: 13px;
  color: var(--theme-text-secondary, #7a6e5e);
  cursor: pointer;
  background: transparent;
  border: 1.5px solid var(--theme-border, #ede4db);
  border-radius: var(--theme-radius-pill, 100px);
  transition: all 0.2s;
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
  transition: all 0.2s;
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

.nwc-btn-cfm {
  padding: var(--theme-space-2) var(--theme-space-4);
  margin-left: var(--theme-space-2);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: all 0.15s;
}

.nwc-btn-cfm:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.nwc-btn-cfm-cancel {
  color: var(--theme-text-secondary, #8b7355);
  background: var(--theme-surface-secondary, #f5ede4);
  border-color: var(--theme-border, #e8ddd3);
}

.nwc-btn-cfm-cancel:hover:not(:disabled) {
  background: var(--theme-surface-hover, #efe5d9);
}

.nwc-btn-cfm-ok {
  color: var(--theme-text-on-accent, #fff);
  background: var(--theme-accent-primary, #d4a574);
}

.nwc-btn-cfm-ok:hover:not(:disabled) {
  background: var(--theme-accent-hover, #c9955f);
}
</style>
