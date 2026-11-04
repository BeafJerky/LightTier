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
