<script setup lang="ts">
/**
 * StartupTasks — 挂载后执行的非阻塞后台任务
 *
 * 必须位于 NNotificationProvider 内部：出口路由残留清理结果通过 Naive
 * Notification 反馈。浏览器 Mock 下 cleanExitRouteResidue 自行跳过。
 */
import { onMounted } from 'vue'
import { useNotification } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { cleanExitRouteResidue } from '@/utils/routeUtil'

const notification = useNotification()
const { t } = useI18n()

onMounted(async () => {
  try {
    const res = await cleanExitRouteResidue()
    if (!res.skipped && res.cleared > 0) {
      notification.warning({
        title: t('newCommon.exitRouteResidueAutoCleared'),
        content: t('newConfig.exitRouteResidueCleared', { n: res.cleared }),
        duration: 5000
      })
    }
  } catch (err) {
    console.error('后台任务执行失败:', err)
  }
})
</script>

<template>
  <span class="lt-sr-only" aria-hidden="true"></span>
</template>
