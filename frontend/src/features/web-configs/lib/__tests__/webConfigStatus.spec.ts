import { describe, it, expect } from 'vitest'
import { isWebServiceStatusPending } from '@/features/web-configs/lib/webConfigStatus'

describe('isWebServiceStatusPending（服务状态未判定）', () => {
  it('桌面端尚无服务状态时视为未判定', () => {
    expect(isWebServiceStatusPending(false, undefined)).toBe(true)
  })

  it('已拿到任何服务状态（含 unknown）都视为已判定', () => {
    expect(isWebServiceStatusPending(false, 'notInstalled')).toBe(false)
    expect(isWebServiceStatusPending(false, 'unknown')).toBe(false)
  })

  it('Android 不检测服务，不阻塞配置管理', () => {
    expect(isWebServiceStatusPending(true, undefined)).toBe(false)
  })
})
