import { ref } from 'vue'
import { join } from '@tauri-apps/api/path'
import { template } from 'lodash-es'
import { CORE_PATH, EASYTIER_NAME } from '@/constants/easytier'
import { useEasyTierStore } from '@/store/modules/easytier'
import { useMockData } from '@/hooks/useMockData'
import { extractFile } from '@/utils/fileUtil'
import { stopAllNodes } from '@/utils/shellUtil'
import { isAndroid } from '@/utils/platformUtil'
import { getArch, getOsType } from '@/utils/sysUtil'

/**
 * 安装内核（从 resource/core 下的压缩包解压，内置包免下载）
 * 设置弹窗与首次引导屏共用。
 *
 * 切换内核版本前必须停掉所有用旧内核启动的实例与服务：
 * - Windows 服务会占用 easytier-core.exe，运行中覆盖会导致解压失败；
 * - 旧内核继续运行会与新版本配置/CLI 能力不一致。
 */
export const useCoreInstall = () => {
  const installing = ref(false)
  const store = useEasyTierStore()

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
    try {
      // 切换前先停服务与所有运行中的节点，并清理运行态记录
      // 列表未加载时（如首次进入设置页）先补齐，避免漏停 Web 配置服务
      if (!isAndroid()) {
        await Promise.all([store.loadConfigFiles(), store.loadWebConfigFiles()])
      }
      await stopAllKernelServices()
      await stopAllNodes()
      store.setRunningList([])
      store.setStartQueue([])
      store.setStopLoop(true)
      // 按平台/架构生成压缩包文件名（与下载文件名一致）
      const tpl = template(EASYTIER_NAME)
      const filename = tpl({
        osType: getOsType(),
        osArch: getArch(),
        version
      }).replace(/^\//, '')
      const zipPath = await join(CORE_PATH, filename)
      // 工具函数基于 BaseDirectory.Resource，必须传相对路径，不能用 resourceDir() 拼绝对路径
      const ok = await extractFile(zipPath, CORE_PATH)
      if (ok) {
        // 安装完成后重新探测版本，让表单/CLI/服务适配立即切换到新内核
        await store.detectCoreVersion()
      }
      return ok
    } catch (e) {
      console.error('安装核心失败:', e)
      return false
    } finally {
      installing.value = false
    }
  }

  return { installing, installCore }
}
