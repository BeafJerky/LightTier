/**
 * 加速源前缀校验与归一化（纯函数，便于单测）
 *
 * 加速源以「前缀 + 完整 GitHub URL」的方式拼接（见 constants/easytier.ts 的 getMirrorUrl），
 * 因此这里统一收敛成带末尾斜杠的 http(s) 前缀：
 * - 允许用户省略协议，默认补 https://；
 * - 仅接受 http/https，拒绝空白、查询串、hash 与账号密码等异常形式；
 * - 去掉末尾多余斜杠后补一个 /，保证与内置源格式一致。
 */

const MAX_MIRROR_PREFIX_LENGTH = 2048
const SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//

export const normalizeMirrorPrefix = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null
  let value = raw.trim()
  if (!value || value.length > MAX_MIRROR_PREFIX_LENGTH || /\s/.test(value)) return null

  // 用户只填域名时补全协议；已有非 http(s) 协议会在下方被拒绝
  if (!SCHEME_RE.test(value)) value = `https://${value}`

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname || url.username || url.password || url.search || url.hash) return null

  const path = url.pathname.replace(/\/+$/, '')
  return `${url.origin}${path}/`
}

/** 参与下载排序的加速源（只依赖 value 与 HEAD 延迟） */
export interface MirrorCandidateLike {
  value: string
  latency: number | null
}

/**
 * 下载候选排序：按实测吞吐降序，吞吐相同时按 HEAD 延迟升序。
 *
 * HEAD 延迟不能代表真实带宽（存在 HEAD 1 秒却 GET 零字节的镜像），
 * 因此下载前必须用 GET 采样得到 speeds；全部为 0 时退回延迟顺序。
 * 显式选择的源仅在吞吐不低于最快源一半时优先，避免一个坏选择被长期钉死。
 */
export const orderMirrorCandidates = <T extends MirrorCandidateLike>(
  candidates: T[],
  speeds: Map<string, number>,
  explicit: string | null
): T[] => {
  const speedOf = (item: T): number => Math.max(0, speeds.get(item.value) ?? 0)
  const latencyOf = (item: T): number =>
    typeof item.latency === 'number' ? item.latency : Number.POSITIVE_INFINITY

  const sorted = [...candidates].sort((a, b) => {
    const bySpeed = speedOf(b) - speedOf(a)
    if (bySpeed !== 0) return bySpeed
    return latencyOf(a) - latencyOf(b)
  })
  if (!explicit) return sorted

  const index = sorted.findIndex((item) => item.value === explicit)
  if (index <= 0) return sorted
  const explicitSpeed = speedOf(sorted[index])
  const bestSpeed = speedOf(sorted[0])
  // 0 字节（假活）或明显慢于最快源时不优先
  if (explicitSpeed <= 0 || explicitSpeed * 2 < bestSpeed) return sorted

  const [item] = sorted.splice(index, 1)
  sorted.unshift(item)
  return sorted
}
