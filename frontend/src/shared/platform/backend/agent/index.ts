/**
 * agent 适配器装配。
 *
 * capabilities 来自启动期探测到的 `/api/v1/meta.features`：能力位由服务端声明，
 * 前端不再维护第二份常量表。镜像测速在 agent 下始终不可用。
 */
import { agentFeatures } from '../mode'
import type { Backend } from '../types'
import { agentAuth } from './auth'
import { agentConfigs } from './configs'
import { agentLogs } from './logs'
import { agentPackages } from './packages'
import { agentRunner } from './runner'
import { agentRuntime } from './runtime'
import { agentSettings } from './settings'
import { agentThemes } from './themes'

export const createAgentBackend = (): Backend => {
  // 在装配时读取：模块导入期探测尚未发生
  const features = agentFeatures() ?? {}
  return {
    kind: 'agent',
    auth: agentAuth,
    configs: agentConfigs,
    runner: agentRunner,
    runtime: agentRuntime,
    logs: agentLogs,
    packages: agentPackages,
    settings: agentSettings,
    themes: agentThemes,
    capabilities: {
      routes: features.routes === true,
      services: features.services === true,
      themes: features.themes === true,
      update: features.update === true,
      tray: features.tray === true,
      kernel: features.kernel === true,
      logs: features.logs === true,
      mirror: false
    }
  }
}
