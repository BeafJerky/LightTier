/** 总览页配置条目：配置元数据 + 运行态 + 端口冲突标记（conflictPorts 由启动预检写入） */
export interface OverviewConfigItem extends RunningItem {
  running: boolean
  conflictPorts: number[]
}

/** 监控摘要快照（5.2 monitorSummary），无缓存时为 undefined */
export interface OverviewSummary {
  nodeCount: number
  avgLatency: string
}
