/**
 * agent 内核包适配器单测（Task 10）。
 *
 * 锁定：
 * - `list` 归一并消费 `installAllowed`（缺省 true，false 保留）；
 * - `install` 的 202 `{taskId}` 解析、URL 编码，409 `core_override_read_only` /
 *   `task_in_progress` 原样抛出；
 * - `task` 的进度字段与 `error.code` 透传，任务状态按服务端顺序逐次上报
 *   （queued → downloading → verifying → extracting → installing → done）；
 * - `cancelTask` 为 POST 并返回 canceled 快照；`remove` 为 DELETE，
 *   内置版本 403 `builtin_package` 原样抛出。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentPackages } from '@/shared/platform/backend/agent/packages'
import { onUnauthorized } from '@/shared/platform/backend/http'

const fetchMock = vi.fn()
let disposeUnauthorized: (() => void) | null = null

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

const lastCall = (): [string, RequestInit] =>
  fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit]

const LIST_PAYLOAD = {
  installed: [
    { version: 'v2.6.4', path: '/data/core/v2.6.4', builtin: true, hasCore: true, hasCli: true },
    { version: 'v2.5.0', path: '/data/core/v2.5.0', builtin: false, hasCore: true, hasCli: true }
  ],
  available: [
    { version: 'v2.6.4', channel: 'stable', installed: true },
    { version: 'v2.7.0', channel: 'prerelease', installed: false }
  ],
  active: 'v2.6.4',
  installAllowed: true
}

describe('agentPackages', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    disposeUnauthorized?.()
    disposeUnauthorized = null
    vi.unstubAllGlobals()
  })

  it('list：GET /api/v1/packages，归一 installed / available / active / installAllowed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, LIST_PAYLOAD))

    const info = await agentPackages.list()

    expect(info).toEqual({
      installed: [
        { version: 'v2.6.4', builtin: true },
        { version: 'v2.5.0', builtin: false }
      ],
      available: [
        { version: 'v2.6.4', channel: 'stable', installed: true },
        { version: 'v2.7.0', channel: 'prerelease', installed: false }
      ],
      active: 'v2.6.4',
      installAllowed: true
    })

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/packages')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  it('list：installAllowed=false（LT_CORE_DIR 覆盖）原样保留', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...LIST_PAYLOAD, installAllowed: false }))

    await expect(agentPackages.list()).resolves.toMatchObject({ installAllowed: false })
  })

  it('list：旧 agent 未序列化 installAllowed 时按 true 兼容', async () => {
    const { installAllowed: _ignored, ...legacy } = LIST_PAYLOAD
    fetchMock.mockResolvedValue(jsonResponse(200, legacy))

    await expect(agentPackages.list()).resolves.toMatchObject({ installAllowed: true })
  })

  it('install：POST 202 {taskId} 返回任务 id（版本做 URL 编码）', async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { taskId: 'task-1' }))

    await expect(agentPackages.install('v2.6.4')).resolves.toBe('task-1')

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/packages/v2.6.4/install')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('install：409 core_override_read_only 原样抛出（页面先看 installAllowed 才会走到这里）', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: {
          code: 'core_override_read_only',
          message: 'installs are disabled while a core directory override is configured'
        }
      })
    )

    await expect(agentPackages.install('v2.6.4')).rejects.toMatchObject({
      code: 'core_override_read_only',
      status: 409
    })
  })

  it('install：409 task_in_progress 原样抛出', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: { code: 'task_in_progress', message: 'an install task for this version is running' }
      })
    )

    await expect(agentPackages.install('v2.6.4')).rejects.toMatchObject({
      code: 'task_in_progress'
    })
  })

  it('task：轮询快照按 queued→downloading→verifying→extracting→installing→done 上报', async () => {
    const states = ['queued', 'downloading', 'verifying', 'extracting', 'installing', 'done']
    const totals: Record<string, number | null> = {
      queued: null,
      downloading: 30_000_000,
      verifying: 30_000_000,
      extracting: 30_000_000,
      installing: 30_000_000,
      done: 30_000_000
    }
    const seen: string[] = []

    for (const state of states) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          id: 'task-1',
          version: 'v2.6.4',
          state,
          downloaded: state === 'downloading' ? 15_000_000 : totals[state] ? 30_000_000 : 0,
          total: totals[state],
          error: null,
          startedAt: 1_700_000_000
        })
      )
      const view = await agentPackages.task('task-1')
      seen.push(view.state)
      expect(view.id).toBe('task-1')
      expect(view.error).toBeNull()
    }

    expect(seen).toEqual(states)
    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/packages/tasks/task-1')
    expect(init.method).toBe('GET')
  })

  it('task：failed 任务的 error.code 原样透传', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: 'task-2',
        version: 'v2.6.4',
        state: 'failed',
        downloaded: 0,
        total: null,
        error: { code: 'checksum_mismatch', message: 'kernel package checksum mismatch' }
      })
    )

    await expect(agentPackages.task('task-2')).resolves.toMatchObject({
      state: 'failed',
      error: { code: 'checksum_mismatch', message: 'kernel package checksum mismatch' }
    })
  })

  it('cancelTask：POST tasks/{id}/cancel 返回 canceled 快照', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: 'task-1',
        version: 'v2.6.4',
        state: 'canceled',
        downloaded: 1024,
        total: 30_000_000,
        error: null
      })
    )

    await expect(agentPackages.cancelTask('task-1')).resolves.toMatchObject({
      id: 'task-1',
      state: 'canceled'
    })

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/packages/tasks/task-1/cancel')
    expect(init.method).toBe('POST')
  })

  it('remove：DELETE /api/v1/packages/{version}，204 解析为 undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(agentPackages.remove('v2.5.0')).resolves.toBeUndefined()

    const [url, init] = lastCall()
    expect(url).toBe('/api/v1/packages/v2.5.0')
    expect(init.method).toBe('DELETE')
  })

  it('remove：内置版本 403 builtin_package 原样抛出', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: { code: 'builtin_package', message: 'built-in kernel version cannot be removed' }
      })
    )

    await expect(agentPackages.remove('v2.6.4')).rejects.toMatchObject({
      code: 'builtin_package',
      status: 403
    })
  })

  it('remove：409 instance_running 原样抛出', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: { code: 'instance_running', message: 'instance is already running' }
      })
    )

    await expect(agentPackages.remove('v2.5.0')).rejects.toMatchObject({
      code: 'instance_running'
    })
  })

  it('401 触发全局会话失效回调', async () => {
    const unauthorized = vi.fn()
    disposeUnauthorized = onUnauthorized(unauthorized)
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: 'auth_required', message: 'login required' } })
    )

    await expect(agentPackages.list()).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledTimes(1)
  })
})
