/**
 * 引导页平台分支与内核就绪判定（纯函数，便于单测）。
 *
 * 三种形态：桌面（可下载内核）、Android（编译期内置）、agent（随服务镜像内置）。
 * agent 的内核状态只能由 `packages` 接口推导：浏览器探测值在 agent 下不可信。
 */
import type { PackagesInfo } from '@/shared/platform/backend'

export type OnboardingPlatform = 'desktop' | 'android' | 'agent'

export interface OnboardingEnvironment {
  android: boolean
  agent: boolean
}

/** Android 与 agent 互斥；agent 优先，避免浏览器直连时误判为 Android */
export const resolveOnboardingPlatform = ({
  android,
  agent
}: OnboardingEnvironment): OnboardingPlatform => (agent ? 'agent' : android ? 'android' : 'desktop')

export type AgentCoreStatus = 'ready' | 'missing' | 'unknown'

export interface AgentCoreView {
  /** ready：有可用内核；missing：服务端明确没有装；unknown：尚未取到（加载中或请求失败） */
  status: AgentCoreStatus
  version: string | null
}

/**
 * 由 `GET /api/v1/packages` 结果推导 agent 内核状态。
 * `loaded` 为 false 表示请求尚未完成或失败：此时不做「未安装」断言，只降级为通用文案。
 */
export const resolveAgentCoreView = (
  info: PackagesInfo | null | undefined,
  loaded: boolean
): AgentCoreView => {
  if (!loaded || !info) return { status: 'unknown', version: null }
  const version = info.active || info.installed[0]?.version || null
  return version ? { status: 'ready', version } : { status: 'missing', version: null }
}

export type AgentFeatureKind = 'web' | 'managed' | 'access'

/** 第 2 步的平台特性：Web 配置按能力位展示，不可用时用「免客户端访问」补位 */
export const resolveAgentFeatureKinds = (web: boolean): AgentFeatureKind[] =>
  web ? ['web', 'managed'] : ['managed', 'access']
