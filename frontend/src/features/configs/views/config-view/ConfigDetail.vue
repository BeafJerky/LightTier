<template>
  <!-- 右侧详情面板：宽屏常驻；窄屏为 master-detail 的详情态（列表隐藏） -->
  <div class="nw-right">
    <template v-if="selectedDetail">
      <div class="nw-detail-header" :class="{ 'nw-detail-hero-on': selectedRunning }">
        <div class="nw-detail-title-row">
          <LtButton
            v-if="!isAndroidPlatform"
            variant="ghost"
            size="sm"
            class="nw-back-btn"
            @click="closeDetail"
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
          <h3 class="nw-detail-title">{{ selectedConfig?.configFileName }}</h3>
          <span class="nw-badge" :class="selectedRunning ? 'on' : 'off'">
            {{ selectedRunning ? '● ' + t('newCommon.running') : '○ ' + t('newCommon.stopped') }}
          </span>
          <span v-if="detailState === 'demo'" class="nw-badge nw-badge-demo">{{
            t('newCommon.demoData')
          }}</span>
        </div>
        <div class="nw-detail-actions">
          <LtButton variant="secondary" size="md" class="nw-detail-btn" @click="openEdit">{{
            t('newCommon.edit')
          }}</LtButton>
          <!-- 窄屏列表不可见，详情保留唯一的上下文生命周期操作；宽屏由列表卡片承担 -->
          <LtButton
            :variant="selectedRunning ? 'danger' : 'success'"
            size="md"
            class="nw-detail-lifecycle nw-detail-btn"
            @click="
              selectedConfig &&
              (selectedRunning ? stopAction(selectedConfig) : startAction(selectedConfig))
            "
            >{{ selectedRunning ? t('newCommon.stop') : t('newCommon.run') }}</LtButton
          >
          <LtButton
            v-if="!isAndroidPlatform"
            variant="danger"
            size="md"
            class="nw-detail-btn"
            @click="deleteSelectedConfig"
            >{{ t('newCommon.delete') }}</LtButton
          >
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
              <LtInput
                v-model="routeFilter"
                class="nw-route-filter"
                variant="filled"
                size="sm"
                :placeholder="t('newConfig.routeFilterPlaceholder')"
                :aria-label="t('newConfig.routeFilterPlaceholder')"
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
      <div v-if="!isAndroidPlatform" class="nw-section"
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
              <LtButton
                variant="success"
                size="sm"
                :disabled="exitRouteFlag || isExitRouteBusy"
                @click="toggleExitRoute"
                >{{ t('newConfig.exitRouteEnable') }}</LtButton
              >
              <LtButton
                variant="soft"
                size="sm"
                :disabled="!exitRouteFlag || isExitRouteBusy"
                @click="toggleExitRoute"
                >{{ t('newConfig.exitRouteDisable') }}</LtButton
              >
              <LtButton
                variant="soft"
                size="sm"
                :disabled="isExitRouteBusy"
                @click="openRouteCheck"
                >{{ t('newConfig.exitRouteCheck') }}</LtButton
              >
            </template>
          </div>
        </div>
        <p class="nw-svc-desc">{{ t('newConfig.exitRouteDesc') }}</p>
      </div>

      <!-- 日志（5.3：内联日志查看器，工具栏含刷新/自动滚动/打开目录） -->
      <div v-if="!isAndroidPlatform" class="nw-section"
        ><div class="nw-section-title">{{ t('newConfig.logs') }}</div>
        <LogViewer :config-name="selectedConfig?.configFileName || ''" />
      </div>

      <!-- Android：破坏性操作独立成行，避免与常用操作挤在头部 -->
      <div v-if="isAndroidPlatform" class="nw-danger-zone">
        <LtButton
          variant="danger"
          size="lg"
          block
          class="nw-danger-btn"
          @click="deleteSelectedConfig"
        >
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
              <LtButton variant="primary" size="md" @click="openServiceDialog">{{
                t('newConfig.installService')
              }}</LtButton>
            </template>
            <!-- 检测中不渲染操作，避免把“未知”当作“未安装/已停止”误触 -->
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
    </template>

    <!-- 详情加载中 / 读取失败：不使用演示数据掩盖真实错误 -->
    <template v-else-if="selectedConfig">
      <div class="nw-detail-header">
        <div class="nw-detail-title-row">
          <LtButton
            v-if="!isAndroidPlatform"
            variant="ghost"
            size="sm"
            class="nw-back-btn"
            @click="closeDetail"
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
          <LtButton variant="secondary" size="md" @click="retryDetail">{{
            t('newCommon.retry')
          }}</LtButton>
          <LtButton v-if="isTauri" variant="ghost" size="md" @click="openConfigDir">{{
            t('newConfig.openConfigDir')
          }}</LtButton>
        </div>
      </div>
    </template>

    <template v-else>
      <!-- Android 详情路由：配置列表尚未就绪时先展示加载态，避免闪出“请选择配置” -->
      <div v-if="isAndroidDetailRoute" class="nw-empty" aria-live="polite">
        <p>{{ t('newCommon.loading') }}</p>
      </div>
      <div v-else class="nw-empty"
        ><span class="nw-empty-icon">✦</span><p>{{ t('newConfig.selectConfig') }}</p></div
      >
    </template>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LtButton, LtInput } from '@/shared/ui'
import { injectRequired } from '@/shared/lib/inject'
import LogViewer from '@/features/configs/components/LogViewer.vue'
import { CONFIG_LIST_KEY } from './context'

defineOptions({ name: 'ConfigDetail' })

const { t } = useI18n()
const {
  isAndroidPlatform,
  isAndroidDetailRoute,
  selectedConfig,
  selectedDetail,
  selectedRunning,
  detailState,
  detailError,
  detailErrorTitle,
  closeDetail,
  retryDetail,
  openConfigDir,
  openEdit,
  startAction,
  stopAction,
  deleteSelectedConfig,
  routeFilter,
  filteredRoutes,
  flagLabel,
  isTauri,
  exitRouteFlag,
  exitRouteStatus,
  exitRouteStatusText,
  isExitRouteBusy,
  toggleExitRoute,
  openRouteCheck,
  currentServiceStatus,
  mapServiceStatus,
  openServiceDialog,
  handleStartService,
  handleStopService,
  handleUninstallService
} = injectRequired(CONFIG_LIST_KEY, 'ConfigDetail')
</script>

<style scoped lang="less">
@import url('./styles/detail.less');
</style>
