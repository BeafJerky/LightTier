/**
 * agent 错误码 → 用户文案映射（Task 9）。
 *
 * 页面已有 toast 会拼接“失败原因”，这里只负责把后端稳定错误码换成 i18n 文案；
 * 未覆盖的错误码返回 `null`，调用方继续展示原始 message，避免吞掉诊断信息。
 */
import { isApiError } from './http'

export interface AgentErrorI18n {
  key: string
  params?: Record<string, unknown>
}

const ERROR_KEYS: Record<string, string> = {
  instance_running: 'agentError.instanceRunning',
  instance_not_running: 'agentError.instanceNotRunning',
  port_in_use: 'agentError.portInUse',
  core_missing: 'agentError.coreMissing',
  not_found: 'agentError.instanceNotFound',
  internal: 'agentError.internal',
  // 配置 id 校验失败（名称含非法字符 / 保留名 / 过长）
  invalid_id: 'agentError.invalidId',
  // 内核包（Task 10）
  core_override_read_only: 'agentError.coreOverrideReadOnly',
  task_in_progress: 'agentError.taskInProgress',
  builtin_package: 'agentError.builtinPackage',
  package_exists: 'agentError.packageExists',
  checksum_mismatch: 'agentError.checksumMismatch',
  bad_package: 'agentError.badPackage',
  core_version_unsupported: 'agentError.coreVersionUnsupported',
  disk_full: 'agentError.diskFull'
}

export const agentCodeI18n = (code: string): AgentErrorI18n | null => {
  const key = ERROR_KEYS[code]
  return key ? { key } : null
}

export const agentErrorI18n = (error: unknown): AgentErrorI18n | null => {
  if (!isApiError(error)) return null
  const mapped = agentCodeI18n(error.code)
  if (!mapped) return null
  return error.params ? { key: mapped.key, params: error.params } : mapped
}
