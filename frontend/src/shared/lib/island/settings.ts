import type { IslandNoticeType } from './types'

export type IslandIdleMode = 'count' | 'dot'
export type IslandMotionPreference = 'system' | 'standard' | 'reduced'

export interface IslandSettings {
  enabled: boolean
  idle: IslandIdleMode
  types: Record<IslandNoticeType, boolean>
  silent: boolean
  motion: IslandMotionPreference
  face: boolean
}

export function createDefaultIslandSettings(): IslandSettings {
  return {
    enabled: true,
    idle: 'count',
    types: { error: true, update: true, quality: true, feedback: true },
    silent: false,
    motion: 'system',
    face: true
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const boolOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

/** 持久化数据可能来自旧版本或被手工改坏，逐字段归一化，不整块丢弃。 */
export function normalizeIslandSettings(raw: unknown): IslandSettings {
  const defaults = createDefaultIslandSettings()
  if (!isRecord(raw)) return defaults

  const rawTypes = isRecord(raw.types) ? raw.types : {}
  const motion = raw.motion
  const idle = raw.idle

  return {
    enabled: boolOr(raw.enabled, defaults.enabled),
    idle: idle === 'count' || idle === 'dot' ? idle : defaults.idle,
    types: {
      error: boolOr(rawTypes.error, defaults.types.error),
      update: boolOr(rawTypes.update, defaults.types.update),
      quality: boolOr(rawTypes.quality, defaults.types.quality),
      feedback: boolOr(rawTypes.feedback, defaults.types.feedback)
    },
    silent: boolOr(raw.silent, defaults.silent),
    motion:
      motion === 'system' || motion === 'standard' || motion === 'reduced'
        ? motion
        : defaults.motion,
    face: boolOr(raw.face, defaults.face)
  }
}
