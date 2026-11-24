import { PREFIX_SVC, PREFIX_SVC_WEB } from '@/shared/constants/easytier'
import { isValidConfigName } from '@/shared/lib/configNameUtil'

export type ServiceInstallMethod = 'nssm' | 'official'

type ServiceOwner = 'service' | 'web'

export const SERVICE_CONFIG_PREFIX = 'service-config:'

const parseInstallMethod = (raw: string | null): ServiceInstallMethod | null => {
  if (!raw) return null
  try {
    const method = (JSON.parse(raw) as { installMethod?: unknown }).installMethod
    return method === 'nssm' || method === 'official' ? method : null
  } catch {
    return null
  }
}

const getServiceOwner = (serviceName: string): ServiceOwner | null => {
  if (
    serviceName.startsWith(PREFIX_SVC_WEB) &&
    isValidConfigName(serviceName.slice(PREFIX_SVC_WEB.length))
  ) {
    return 'web'
  }
  if (
    serviceName.startsWith(PREFIX_SVC) &&
    isValidConfigName(serviceName.slice(PREFIX_SVC.length))
  ) {
    return 'service'
  }
  return null
}

const getTypedStorageName = (
  serviceName: string,
  owner = getServiceOwner(serviceName)
): string | null => {
  if (!owner) return null
  const expectedPrefix = owner === 'web' ? PREFIX_SVC_WEB : PREFIX_SVC
  return serviceName.startsWith(expectedPrefix) ? `${owner}:${serviceName}` : null
}

const isTypedServiceStorageName = (name: string): boolean => {
  const separator = name.indexOf(':')
  if (separator < 0) return false
  const owner = name.slice(0, separator)
  if (owner !== 'service' && owner !== 'web') return false
  return getTypedStorageName(name.slice(separator + 1), owner) !== null
}

export const isServiceConfigStorageName = (name: string): boolean =>
  isValidConfigName(name) || getServiceOwner(name) !== null || isTypedServiceStorageName(name)

const getLegacyStorageName = (serviceName: string): string => SERVICE_CONFIG_PREFIX + serviceName

/** 普通配置名以 Web 前缀开头时，其旧简写键会与 Web 服务完整旧键碰撞。 */
const hasAmbiguousWebLegacyKey = (configFileName: string): boolean => {
  if (!configFileName.startsWith(PREFIX_SVC_WEB)) return false
  return (
    localStorage.getItem(getLegacyStorageName(configFileName)) !== null ||
    localStorage.getItem(`${SERVICE_CONFIG_PREFIX}web:${configFileName}`) !== null
  )
}

const migrateRecord = (serviceName: string, legacyKey: string): ServiceInstallMethod | null => {
  const recorded = parseInstallMethod(localStorage.getItem(legacyKey))
  const typedName = getTypedStorageName(serviceName)
  if (!recorded || !typedName) return null
  try {
    localStorage.setItem(
      SERVICE_CONFIG_PREFIX + typedName,
      JSON.stringify({ installMethod: recorded })
    )
    localStorage.removeItem(legacyKey)
  } catch {
    /* localStorage 不可用时仅影响方式探测 */
  }
  return recorded
}

export const readServiceInstallMethod = (serviceName: string): ServiceInstallMethod | null => {
  const owner = getServiceOwner(serviceName)
  const typedName = getTypedStorageName(serviceName, owner)
  if (!owner || !typedName) return null

  const recorded = parseInstallMethod(localStorage.getItem(SERVICE_CONFIG_PREFIX + typedName))
  if (recorded) return recorded

  const legacy = migrateRecord(serviceName, getLegacyStorageName(serviceName))
  if (legacy || owner === 'web') return legacy

  const configFileName = serviceName.slice(PREFIX_SVC.length)
  if (hasAmbiguousWebLegacyKey(configFileName)) return null
  return migrateRecord(serviceName, SERVICE_CONFIG_PREFIX + configFileName)
}

const removeOrdinaryLegacyKeys = (serviceName: string): void => {
  localStorage.removeItem(getLegacyStorageName(serviceName))
  const configFileName = serviceName.slice(PREFIX_SVC.length)
  if (!hasAmbiguousWebLegacyKey(configFileName)) {
    localStorage.removeItem(SERVICE_CONFIG_PREFIX + configFileName)
  }
}

export const saveServiceInstallMethod = (
  serviceName: string,
  installMethod: ServiceInstallMethod
): void => {
  const owner = getServiceOwner(serviceName)
  const typedName = getTypedStorageName(serviceName, owner)
  if (!owner || !typedName) return
  try {
    localStorage.setItem(SERVICE_CONFIG_PREFIX + typedName, JSON.stringify({ installMethod }))
    if (owner === 'service') removeOrdinaryLegacyKeys(serviceName)
    else localStorage.removeItem(getLegacyStorageName(serviceName))
  } catch {
    /* localStorage 不可用时仅影响方式探测 */
  }
}

export const clearServiceInstallMethod = (serviceName: string): void => {
  const owner = getServiceOwner(serviceName)
  const typedName = getTypedStorageName(serviceName, owner)
  if (!owner || !typedName) return
  try {
    localStorage.removeItem(SERVICE_CONFIG_PREFIX + typedName)
    if (owner === 'service') removeOrdinaryLegacyKeys(serviceName)
    else localStorage.removeItem(getLegacyStorageName(serviceName))
  } catch {
    /* localStorage 不可用时仅影响方式探测 */
  }
}
