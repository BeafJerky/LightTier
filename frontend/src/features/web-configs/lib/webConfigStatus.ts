import type { FormWebData } from '@/entities/config/formTypes'

// 运行判定：独立进程（running）或 Windows 服务（runningService）均视为运行中
export const isWebRunning = (item: FormWebData): boolean =>
  item.status === 'running' || item.status === 'runningService'

// 运行态未知（持久化旧值已丢弃 / 正在进行进程与服务扫描）时不得猜测运行或停止；
// Android 不探测运行态，也不应因此阻塞删除等配置管理操作
export const isWebChecking = (item: FormWebData, isAndroid: boolean): boolean =>
  !isAndroid && (!item.status || item.status === 'checking')

// 服务状态延后检测：尚无结果时不得当作“未安装服务”放行删除；
// Android 不检测 Windows 服务，不应因此阻塞配置管理
export const isWebServiceStatusPending = (
  isAndroid: boolean,
  serviceStatus: string | undefined
): boolean => !isAndroid && serviceStatus === undefined

export const getWebStatusClass = (item: FormWebData, isAndroid: boolean): string =>
  isWebChecking(item, isAndroid) ? 'checking' : isWebRunning(item) ? 'on' : 'off'

export const getWebStatusText = (
  item: FormWebData,
  isAndroid: boolean,
  t: (key: string) => string
): string => {
  if (isWebChecking(item, isAndroid)) return t('newCommon.checking')
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
