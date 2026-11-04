/**
 * 数据管理：清除临时缓存与历史日志。
 * 只清可再取的远端缓存与历史日志分段，配置、主题、语言、锁屏密码与当前日志保留。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCreamToast } from '@/shared/ui/useCreamToast'
import { useEasyTierStore } from '@/shared/store/easytier'
import { clearAppCache } from '@/shared/lib/cacheUtil'
import { clearAllLogs } from '@/shared/platform/fileUtil'
import type { SettingsConfirm } from './settingsTypes'

export function useSettingsData(confirm: SettingsConfirm) {
  const store = useEasyTierStore()
  const toast = useCreamToast()
  const { t } = useI18n()

  const clearingCache = ref(false)
  const clearingLogs = ref(false)
  const backupDialogVisible = ref(false)

  // 清除临时缓存：仅清除 STUN/公共节点等可再取的远端缓存，保留配置、主题、语言、锁屏密码等
  const handleClearCache = async () => {
    if (!(await confirm(t('newSettings.clearCacheTitle'), t('newSettings.clearCacheMsg')))) return
    clearingCache.value = true
    try {
      clearAppCache()
      // 同步清空内存副本，下一次使用时会自然重新拉取
      store.resetRemoteCache()
      toast.success(t('newSettings.cacheCleared'))
    } catch (e) {
      console.error('清除缓存失败:', e)
      toast.error(t('newCommon.loadFailed') + ': ' + String(e))
    } finally {
      clearingCache.value = false
    }
  }

  // 清除日志：删除应用日志与内核日志的历史分段，正在写入的当前日志保留
  const handleClearLogs = async () => {
    if (!(await confirm(t('newSettings.clearLogsTitle'), t('newSettings.clearLogsMsg')))) return
    clearingLogs.value = true
    try {
      const result = await clearAllLogs()
      if (result.failed > 0) {
        toast.error(t('newSettings.logsClearPartial', { n: result.removed, m: result.failed }))
      } else if (result.removed > 0) {
        toast.success(t('newSettings.logsClearSuccess', { n: result.removed }))
      } else {
        toast.info(t('newSettings.logsClearNothing'))
      }
    } catch (e) {
      console.error('清除日志失败:', e)
      toast.error(t('newSettings.logsClearFail') + ': ' + String(e))
    } finally {
      clearingLogs.value = false
    }
  }

  return {
    clearingCache,
    clearingLogs,
    backupDialogVisible,
    handleClearCache,
    handleClearLogs
  }
}
