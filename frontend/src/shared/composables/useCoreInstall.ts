import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { join, resourceDir } from '@tauri-apps/api/path'
import { isTauri } from '@tauri-apps/api/core'
import { error as logError } from '@tauri-apps/plugin-log'
import { CORE_PATH, getCoreFileName } from '@/shared/constants/easytier'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useMockData } from '@/shared/platform/mockData'
import {
  backupCoreExecutables,
  discardCoreBackup,
  extractFile,
  restoreCoreExecutables
} from '@/shared/platform/fileUtil'
import * as systemOps from '@/shared/platform/systemOps'
import { stopAllNodes } from '@/shared/platform/shellUtil'
import { isAndroid } from '@/shared/platform/platformUtil'
import { getArch, getOsType } from '@/shared/platform/sysUtil'

const getBackupRecoveryPath = (cause: unknown): string | null => {
  if (
    !(cause instanceof Error) ||
    !('code' in cause) ||
    cause.code !== 'core_backup_rollback_failed'
  ) {
    return null
  }
  const path = 'backupPath' in cause ? cause.backupPath : null
  return typeof path === 'string' && path ? path : null
}

/**
 * 安装内核（解压 resource/core 下已下载的内核压缩包）
 * 设置弹窗使用；安装包不再随桌面应用内置，需先经设置页下载。
 *
 * 切换内核版本前必须停掉所有用旧内核启动的实例与服务：
 * - Windows 服务会占用 easytier-core.exe，运行中覆盖会导致解压失败；
 * - 旧内核继续运行会与新版本配置/CLI 能力不一致。
 */
export const useCoreInstall = () => {
  const installing = ref(false)
  const lastInstallError = ref('')
  const store = useEasyTierStore()
  const { t } = useI18n()

  // 停止桌面端已安装的全部内核服务（普通配置 + Web 配置服务）
  const stopAllKernelServices = async () => {
    if (isAndroid()) return
    const { checkService, stopService, checkWebService, stopWebService } = useMockData()
    for (const cfg of store.configList) {
      try {
        const status = await checkService(cfg.configFileName)
        if (status && status !== 'notInstalled' && status !== 'stopped') {
          await stopService(cfg.configFileName)
        }
      } catch {
        /* 单个服务停止失败不阻断切换 */
      }
    }
    for (const cfg of store.configWebList) {
      try {
        const status = await checkWebService(cfg.configFileName)
        if (status && status !== 'notInstalled' && status !== 'stopped') {
          await stopWebService(cfg.configFileName)
        }
      } catch {
        /* 同上 */
      }
    }
  }

  /**
   * 安装指定版本的核心
   * @param version 版本号（如 v2.6.4），需与 resource/core 下的压缩包文件名匹配
   * @returns 安装是否成功
   */
  const installCore = async (version: string): Promise<boolean> => {
    installing.value = true
    lastInstallError.value = ''
    try {
      // 按平台/架构生成压缩包文件名（与下载文件名一致；纯字符串拼接，避免 CSP 拦截 eval）
      const filename = getCoreFileName(getOsType(), getArch(), version)
      const zipPath = await join(CORE_PATH, filename)
      let expectedSha256: string | undefined
      // 安装前校验官方 SHA-256：manifest 未收录的版本直接拒绝。
      // 必须放在停服务之前——校验失败时不改变任何运行状态。
      if (isTauri()) {
        expectedSha256 = await systemOps.verifyCorePackage(
          version,
          await join(await resourceDir(), zipPath)
        )
      }

      // 校验通过后再停服务与所有运行中的节点，并清理运行态记录
      // 列表未加载时（如首次进入设置页）先补齐，避免漏停 Web 配置服务
      if (!isAndroid()) {
        await Promise.all([store.loadConfigFiles(), store.loadWebConfigFiles()])
      }
      await stopAllKernelServices()
      await stopAllNodes()
      store.setRunningList([])
      store.setStartQueue([])
      store.stopLoop = true

      // 旧内核先移入独立备份目录：解压任一步失败都能恢复，避免只剩半套文件。
      // null 仅表示没有旧内核；列举、移动或回滚失败都会抛错，绝不能继续安装。
      let backupPath: string | null = null
      try {
        backupPath = await backupCoreExecutables()
      } catch (cause) {
        const recoveryPath = getBackupRecoveryPath(cause)
        lastInstallError.value = recoveryPath
          ? t('newSettings.coreBackupRollbackFailed', { path: recoveryPath })
          : t('newSettings.coreBackupFailed')
        logError(
          `备份旧内核失败${recoveryPath ? `，保留恢复备份 ${recoveryPath}` : ''}:${JSON.stringify({
            cause,
            recoveryPath
          })}`
        )
        return false
      }
      // 工具函数基于 BaseDirectory.Resource，必须传相对路径，不能用 resourceDir() 拼绝对路径。
      // 解压会重新读取并校验同一份 zip 字节；任何阶段失败都保留备份等待回滚。
      try {
        let ok = false
        try {
          ok = await extractFile(zipPath, CORE_PATH, false, async () => true, expectedSha256)
        } catch (cause) {
          logError(`内核解压失败 ${version}:${JSON.stringify(cause)}`)
          throw new Error(t('newSettings.coreExtractFailed'), { cause })
        }
        if (!ok) throw new Error(t('newSettings.coreExtractFailed'))

        try {
          if (isTauri()) await systemOps.verifyCoreFiles()
        } catch (cause) {
          logError(`内核文件校验失败 ${version}:${JSON.stringify(cause)}`)
          throw new Error(t('newSettings.coreVerifyFailed'), { cause })
        }

        // 文件验过后才探测版本；探测失败或空结果同样必须回滚，不能提前丢弃备份。
        try {
          const detected = await store.detectCoreVersion()
          if (!detected?.trim()) throw new Error('empty core version')
        } catch (cause) {
          logError(`内核版本探测失败 ${version}:${JSON.stringify(cause)}`)
          throw new Error(t('newSettings.coreDetectFailed'), { cause })
        }
        if (backupPath) await discardCoreBackup(backupPath)
        return true
      } catch (cause) {
        if (!backupPath) throw cause
        const restored = await restoreCoreExecutables(backupPath)
        if (!restored) {
          lastInstallError.value = t('newSettings.installRollbackFail', { path: backupPath })
          logError(
            `内核安装失败且回滚失败 ${version}, 备份 ${backupPath}, 未恢复目录 resource/core-unrestored:${JSON.stringify(
              {
                installCause: cause,
                restoreCause: 'restoreCoreExecutables returned false'
              }
            )}`
          )
          return false
        }
        throw cause
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      lastInstallError.value = message
      logError(`安装内核失败 ${version}: ${message}`)
      console.error('安装核心失败:', e)
      return false
    } finally {
      installing.value = false
    }
  }

  return { installing, installCore, lastInstallError }
}
