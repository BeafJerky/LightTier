export function resolveMonitorTarget(
  configs: RunningItem[],
  running: RunningItem[],
  requestedName: string,
  lastRunName: string,
  autoSelect: boolean
): RunningItem | undefined {
  const requested = configs.find((item) => item.configFileName === requestedName)
  if (requested) {
    const runtime = running.find((item) => item.configFileName === requestedName)
    return runtime ? { ...requested, ...runtime } : requested
  }
  if (!autoSelect) return undefined
  const last = running.find((item) => item.configFileName === lastRunName)
  const runtime = last || running[0]
  if (!runtime) return undefined
  const config = configs.find((item) => item.configFileName === runtime.configFileName)
  return config ? { ...config, ...runtime } : runtime
}
