import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

import { fetch } from '@tauri-apps/plugin-http'
import { createRemoteDomain } from '@/shared/store/easytier/remote'
import { MANAGER_INFO_API } from '@/shared/constants/easytier'

describe('refreshManagerReleaseInfo', () => {
  it('更新摘要只从官方 API 获取，不采信镜像元数据', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: 'v2.10.5', assets: [] }]
    } as Response)

    const releases = await createRemoteDomain().refreshManagerReleaseInfo()

    expect(releases[0].tag_name).toBe('v2.10.5')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(MANAGER_INFO_API, expect.any(Object))
  })
})
