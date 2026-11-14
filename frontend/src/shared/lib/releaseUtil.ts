import type { ManagerRelease } from '@/shared/store/easytier/remote'

/**
 * 设置页与灵动岛共用同一套版本选择规则：
 * 草稿永远排除；稳定通道只认正式版；非稳定通道取第一个可用项。
 */
export function pickLatestManagerRelease(
  releases: ManagerRelease[],
  stableOnly: boolean
): ManagerRelease | null {
  if (!Array.isArray(releases) || releases.length === 0) return null
  const candidates = releases.filter((release) => !release.draft)
  const latest = stableOnly ? candidates.find((release) => !release.prerelease) : candidates[0]
  return latest ?? null
}
