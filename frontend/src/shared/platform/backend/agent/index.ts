/**
 * agent 适配器装配。
 *
 * capabilities 取自 agent 当前真实能力：内核包与日志可用；托盘、主题、服务、
 * 路由与自动更新在 Linux agent 下不存在（镜像测速同样不可用）。
 */
import type { Backend } from '../types'
import { agentAuth } from './auth'
import { agentConfigs } from './configs'
import { agentLogs } from './logs'
import { agentPackages } from './packages'
import { agentRunner } from './runner'
import { agentRuntime } from './runtime'
import { agentSettings } from './settings'

export const createAgentBackend = (): Backend => ({
  kind: 'agent',
  auth: agentAuth,
  configs: agentConfigs,
  runner: agentRunner,
  runtime: agentRuntime,
  logs: agentLogs,
  packages: agentPackages,
  settings: agentSettings,
  capabilities: {
    routes: false,
    services: false,
    themes: false,
    update: false,
    tray: false,
    kernel: true,
    logs: true,
    mirror: false
  }
})
