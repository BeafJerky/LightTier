/**
 * 内核版本解析与配置兼容校验（纯函数，便于单测）
 *
 * 设计边界：
 * - 版本探测失败（null）→ 只返回「无法检测版本」警告，不做严格拦截；
 * - 版本在已知区间内 → flags 白名单按引入版本推导，v2.7.0 起未知 flags 视为 error；
 * - 版本超出已知区间 → 跳过 flags 与 vpn_portal_config 键级校验，避免误报未来版本。
 */
import {
  CORE_FEATURE_MIN_VERSION,
  CORE_FLAG_ADDITIONS,
  CORE_FLAG_BASELINE,
  CORE_TOP_LEVEL_FIELD_GROUPS,
  CORE_TOP_LEVEL_FIELD_REMOVED,
  CORE_VERSION_BASELINE,
  CORE_VERSION_LATEST_KNOWN,
  VPN_PORTAL_LEGACY_FIELDS,
  VPN_PORTAL_V2_CLIENT_FIELDS,
  VPN_PORTAL_V2_FIELDS,
  type CoreFeature
} from '@/constants/kernelCompat'

export type CoreVersionTuple = [number, number, number]

export type CoreVpnPortalFormat = 'legacy' | 'v2.7'
export type CoreServiceArgsStyle = 'positional' | 'named'

export interface CoreCapabilities {
  /** 归一化版本号（带 v，如 v2.6.4） */
  version: string
  versionNum: CoreVersionTuple
  /** 是否处于注册表已知区间（超出区间时 flags 白名单不可用） */
  known: boolean
  /** 当前版本允许的 flags；null = 无法校验（未知版本） */
  flags: ReadonlySet<string> | null
  /** 未知 flags 是否会导致启动失败（v2.7.0+） */
  flagsStrict: boolean
  features: Record<CoreFeature, boolean>
  vpnPortalFormat: CoreVpnPortalFormat
  serviceCoreArgs: CoreServiceArgsStyle
}

export interface CompatIssue {
  level: 'error' | 'warning'
  /** i18n key：coreCompat.<code> */
  code: string
  params?: Record<string, string | number>
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isEmptyString = (value: unknown): boolean => typeof value === 'string' && !value.trim()

/** 必填字段缺失判定：undefined / null / 空白字符串 */
const isMissingValue = (value: unknown): boolean =>
  value === undefined || value === null || isEmptyString(value)

const compareTuple = (a: CoreVersionTuple, b: CoreVersionTuple): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** 从任意版本串中提取 x.y.z（兼容 `easytier-cli 2.6.4`、`v2.6.4`、`2.6.4`） */
export const parseVersionTuple = (raw: string | null | undefined): CoreVersionTuple | null => {
  if (typeof raw !== 'string') return null
  const matched = raw.match(/\bv?(\d+)\.(\d+)\.(\d+)/i)
  if (!matched) return null
  const tuple: CoreVersionTuple = [Number(matched[1]), Number(matched[2]), Number(matched[3])]
  if (tuple.some((n) => !Number.isFinite(n))) return null
  return tuple
}

/** 归一化版本号：探测输出 → `vX.Y.Z`；无法解析返回 null */
export const parseCoreVersion = (raw: unknown): string | null => {
  const tuple = parseVersionTuple(typeof raw === 'string' ? raw : '')
  return tuple ? `v${tuple.join('.')}` : null
}

/** 版本比较：无法解析时按相等处理（宽松策略） */
export const compareCoreVersion = (a: string | null, b: string | null): number => {
  const ta = parseVersionTuple(a)
  const tb = parseVersionTuple(b)
  if (!ta || !tb) return 0
  return compareTuple(ta, tb)
}

const versionAtLeast = (version: string, min: string): boolean =>
  compareCoreVersion(version, min) >= 0

/**
 * 解析版本为能力集合；版本串无法解析时返回 null（调用方走宽松降级）
 */
export const resolveCoreCapabilities = (version: string | null): CoreCapabilities | null => {
  const versionNum = parseVersionTuple(version)
  if (!versionNum || !version) return null
  const normalized = `v${versionNum.join('.')}`
  const known =
    compareTuple(versionNum, parseVersionTuple(CORE_VERSION_BASELINE)!) >= 0 &&
    compareTuple(versionNum, parseVersionTuple(CORE_VERSION_LATEST_KNOWN)!) <= 0

  let flags: Set<string> | null = null
  if (known) {
    flags = new Set(CORE_FLAG_BASELINE)
    CORE_FLAG_ADDITIONS.forEach(({ since, flags: added }) => {
      if (versionAtLeast(normalized, since)) added.forEach((flag) => flags!.add(flag))
    })
  }

  const features = Object.fromEntries(
    (Object.keys(CORE_FEATURE_MIN_VERSION) as CoreFeature[]).map((feature) => [
      feature,
      versionAtLeast(normalized, CORE_FEATURE_MIN_VERSION[feature])
    ])
  ) as Record<CoreFeature, boolean>

  return {
    version: normalized,
    versionNum,
    known,
    flags,
    flagsStrict: versionAtLeast(normalized, 'v2.7.0'),
    features,
    vpnPortalFormat: versionAtLeast(normalized, 'v2.7.0') ? 'v2.7' : 'legacy',
    serviceCoreArgs: versionAtLeast(normalized, 'v2.7.0') ? 'named' : 'positional'
  }
}

/** 功能是否受支持：未知版本一律返回 true（显示字段，不阻断用户） */
export const isCoreFeatureSupported = (
  feature: CoreFeature,
  caps: CoreCapabilities | null
): boolean => (caps ? caps.features[feature] : true)

/** flag 是否为当前内核合法键：未知版本/白名单不可用一律返回 true（不隐藏） */
export const isCoreFlagSupported = (flag: string, caps: CoreCapabilities | null): boolean =>
  caps?.flags ? caps.flags.has(flag) : true

/**
 * 配置兼容性检查
 * @param config 已解析的 TOML 对象
 * @param version 已安装内核版本（归一化/原始串均可），null 表示未检测到
 */
export const checkConfigCompat = (config: unknown, version: string | null): CompatIssue[] => {
  if (!isPlainObject(config)) return []
  const caps = resolveCoreCapabilities(version)
  if (!caps) return [{ level: 'warning', code: 'unknownVersion', params: {} }]

  const issues: CompatIssue[] = []
  const push = (level: CompatIssue['level'], code: string, params?: CompatIssue['params']) =>
    issues.push({ level, code, params })

  // === flags 白名单 ===
  // v2.7.0 起 pbjson 严格反序列化，未知键直接拒绝启动；旧版本静默忽略
  if (isPlainObject(config.flags) && caps.flags) {
    Object.keys(config.flags).forEach((flag) => {
      if (caps.flags!.has(flag)) return
      if (caps.flagsStrict) {
        push('error', 'flagUnknownStrict', { flag, version: caps.version })
      } else {
        push('warning', 'flagUnknownIgnored', { flag, version: caps.version })
      }
    })
  }

  // === vpn_portal_config 结构 ===
  // 超出注册表已知区间时结构可能已变化，跳过键级/必填校验，避免误拦未来版本
  if (caps.known && isPlainObject(config.vpn_portal_config)) {
    const vpn = config.vpn_portal_config
    if (caps.vpnPortalFormat === 'v2.7') {
      const allowed = new Set<string>(VPN_PORTAL_V2_FIELDS)
      Object.keys(vpn).forEach((field) => {
        // client_cidr 单独给出可操作的迁移提示，避免重复报“未知字段”
        if (field === 'client_cidr') return
        if (!allowed.has(field)) {
          push('error', 'vpnUnknownField', {
            field: `vpn_portal_config.${field}`,
            version: caps.version
          })
        }
      })
      if ('client_cidr' in vpn) {
        push('error', 'vpnClientCidrRemoved', { version: caps.version })
      }
      if (isMissingValue(vpn.wireguard_listen)) {
        push('error', 'vpnWireguardListenRequired', { version: caps.version })
      }
      if (Array.isArray(vpn.clients)) {
        const clientAllowed = new Set<string>(VPN_PORTAL_V2_CLIENT_FIELDS)
        vpn.clients.forEach((client: unknown, index: number) => {
          if (!isPlainObject(client)) return
          Object.keys(client).forEach((field) => {
            if (!clientAllowed.has(field)) {
              push('error', 'vpnUnknownField', {
                field: `vpn_portal_config.clients[${index}].${field}`,
                version: caps.version
              })
            }
          })
          // name / virtual_ip 为必填（Ipv4Inet），缺失时内核解析失败
          for (const key of ['name', 'virtual_ip'] as const) {
            if (isMissingValue(client[key])) {
              push('error', 'vpnFieldRequired', {
                field: `vpn_portal_config.clients[${index}].${key}`,
                version: caps.version
              })
            }
          }
        })
      }
    } else {
      const legacyAllowed = new Set<string>(VPN_PORTAL_LEGACY_FIELDS)
      // 旧结构 client_cidr / wireguard_listen 均为必填（无 serde default）
      if (isMissingValue(vpn.client_cidr)) {
        push('error', 'vpnClientCidrRequired', { version: caps.version })
      }
      if (isMissingValue(vpn.wireguard_listen)) {
        push('error', 'vpnWireguardListenRequired', { version: caps.version })
      }
      Object.keys(vpn).forEach((field) => {
        if (legacyAllowed.has(field)) return
        // 旧内核宽松解析：v2.7.0 新增字段/未知字段会被静默忽略，不阻断启动
        push('warning', 'vpnFieldIgnored', {
          field: `vpn_portal_config.${field}`,
          version: caps.version
        })
      })
    }
  }

  // === 顶层字段引入版本 ===
  CORE_TOP_LEVEL_FIELD_GROUPS.forEach(({ fields, since }) => {
    if (!versionAtLeast(caps.version, since)) {
      fields.forEach((field) => {
        if (field in config) {
          push('warning', 'fieldNeedsVersion', {
            field,
            since,
            version: caps.version
          })
        }
      })
    }
  })

  // === 顶层字段移除版本（配置文件中的值不再生效） ===
  CORE_TOP_LEVEL_FIELD_REMOVED.forEach(({ fields, since }) => {
    if (!versionAtLeast(caps.version, since)) return
    fields.forEach((field) => {
      if (!(field in config)) return
      // rpc_portal 由 LightTier 转成 CLI 参数，桌面端仍生效；不能沿用“被忽略”提示
      if (field === 'rpc_portal') {
        push('warning', 'rpcPortalCliOnly', { since, version: caps.version })
        return
      }
      push('warning', 'fieldIgnoredSince', {
        field,
        since,
        version: caps.version
      })
    })
  })

  // === peer_public_key（v2.6.0+） ===
  if (!versionAtLeast(caps.version, 'v2.6.0') && Array.isArray(config.peer)) {
    const hasPublicKey = config.peer.some(
      (peer: unknown) => isPlainObject(peer) && 'peer_public_key' in peer
    )
    if (hasPublicKey) {
      push('warning', 'fieldNeedsVersion', {
        field: 'peer.peer_public_key',
        since: 'v2.6.0',
        version: caps.version
      })
    }
  }

  // 错误优先展示，同级保持发现顺序
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}
