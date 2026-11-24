import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, h, type App } from 'vue'
import type { FormWebData } from '@/entities/config/formTypes'

const mocks = vi.hoisted(() => ({
  stored: [] as FormWebData[],
  read: vi.fn(),
  write: vi.fn(),
  run: vi.fn(),
  kill: vi.fn(),
  toast: vi.fn(),
  getRunningWebProcesses: vi.fn(),
  pageRefresh: null as null | ((forceServiceStatus?: boolean) => Promise<void>),
  start: null as null | ((item: FormWebData) => Promise<void>)
}))

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return { ...actual, useSSRContext: () => ({}) }
})

vi.mock('@/shared/i18n/t', () => ({ t: (key: string) => key }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'NewWebConfigView', query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}))
vi.mock('@/shared/platform/platformUtil', () => ({ isAndroid: () => false }))
vi.mock('@/shared/platform/fileUtil', () => ({ openPath: vi.fn() }))
vi.mock('@/shared/composables/useWideLandscape', async () => {
  const { ref } = await import('vue')
  return { useWideLandscape: () => ref(false) }
})
vi.mock('@/shared/ui/useCreamToast', () => ({
  useCreamToast: () => ({ show: mocks.toast })
}))
vi.mock('@/shared/ui', () => ({
  LtButton: { template: '<button><slot /></button>' },
  LtInput: { template: '<input />' }
}))
vi.mock('@/shared/ui/CreamDialog.vue', () => ({
  default: { template: '<section><slot /><slot name="footer" /></section>' }
}))
vi.mock('@/shared/platform/mockData', () => ({
  useMockData: () => ({
    readWebConfigList: mocks.read,
    writeWebConfigList: mocks.write,
    getRunningWebProcesses: mocks.getRunningWebProcesses,
    runEasyTierCoreWeb: mocks.run,
    killProcess: mocks.kill,
    checkWebService: vi.fn(async () => 'notInstalled'),
    installWebService: vi.fn(),
    uninstallWebService: vi.fn(),
    startWebService: vi.fn(),
    stopWebService: vi.fn()
  })
}))
vi.mock('@/shared/store/easytier', async () => {
  const { reactive } = await import('vue')
  const store = reactive({
    configWebList: [] as FormWebData[],
    webConfigListLoading: false,
    webConfigListLoaded: true,
    webConfigListError: null as Error | null,
    loadWebConfigFiles: vi.fn(async () => {
      store.configWebList = await mocks.read()
    }),
    registerPageRefresh: vi.fn((callback: (forceServiceStatus?: boolean) => Promise<void>) => {
      mocks.pageRefresh = callback
    }),
    clearPageRefresh: vi.fn()
  })
  return { useEasyTierStore: () => store }
})
vi.mock('@/shared/lib/serviceStatusCache', () => ({
  resolveServiceStatuses: async (
    _scope: string,
    names: string[],
    load: (name: string) => Promise<string>,
    update: (name: string, status: string) => void
  ) => {
    for (const name of names) update(name, await load(name))
  }
}))
vi.mock('../WebConfigList.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../WebConfigDetail.vue', () => ({ default: { template: '<div />' } }))
vi.mock('../WebConfigForm.vue', () => ({ default: { template: '<div />' } }))

import WebConfigView from '../index.vue'
import { useEasyTierStore } from '@/shared/store/easytier'
import { mutateWebConfigList } from '@/shared/platform/webConfigStorage'

interface HostNode {
  type: string
  text: string
  children: HostNode[]
  parent: HostNode | null
}

const createHostNode = (type: string, text = ''): HostNode => ({
  type,
  text,
  children: [],
  parent: null
})

const renderer = createRenderer<HostNode, HostNode>({
  createElement: (type) => createHostNode(type),
  createText: (text) => createHostNode('#text', text),
  createComment: (text) => createHostNode('#comment', text),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
    node.children = []
  },
  patchProp: () => {},
  insert: (node, parent, anchor) => {
    node.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(node)
    else parent.children.splice(index, 0, node)
  },
  remove: (node) => {
    if (!node.parent) return
    const index = node.parent.children.indexOf(node)
    if (index >= 0) node.parent.children.splice(index, 1)
    node.parent = null
  },
  parentNode: (node) => node.parent,
  nextSibling: (node) => {
    if (!node.parent) return null
    const index = node.parent.children.indexOf(node)
    return node.parent.children[index + 1] ?? null
  }
})

const config = (overrides: Partial<FormWebData> = {}): FormWebData => ({
  configFileName: 'home',
  protocol: 'http',
  host: 'old.example.com',
  port: 11211,
  userName: 'alice',
  webStartMethod: 0,
  webUrl: '',
  ...overrides
})

const apps: App[] = []
const mountView = async (): Promise<App> => {
  vi.stubGlobal('window', { innerWidth: 500 })
  const root = createHostNode('root')
  const app = renderer.createApp({ ...WebConfigView, render: () => h('div') })
  apps.push(app)
  app.mount(root)
  const setupState = app._instance as unknown as { setupState: Record<string, unknown> }
  mocks.start = setupState.setupState.startWeb as (item: FormWebData) => Promise<void>
  await vi.waitFor(() => expect(mocks.getRunningWebProcesses).toHaveBeenCalled())
  await vi.waitFor(() => expect(useEasyTierStore().configWebList[0]?.status).toBe('notRunning'))
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.stored = [config()]
  mocks.read.mockImplementation(async () =>
    (JSON.parse(JSON.stringify(mocks.stored)) as FormWebData[]).map(
      ({ status: _status, pid: _pid, ...item }) => item
    )
  )
  mocks.write.mockImplementation(async (list: FormWebData[]) => {
    mocks.stored = JSON.parse(JSON.stringify(list))
  })
  mocks.run.mockResolvedValue(4321)
  mocks.kill.mockResolvedValue(true)
  mocks.getRunningWebProcesses.mockResolvedValue([])
  mocks.pageRefresh = null
})

afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount())
  vi.unstubAllGlobals()
})

describe('Web 运行态刷新代际', () => {
  it('较早的进程扫描完成不能覆盖较新的状态', async () => {
    await mountView()
    const item = useEasyTierStore().configWebList[0]
    let resolveOld!: (value: unknown[]) => void
    const oldScan = new Promise<unknown[]>((resolve) => {
      resolveOld = resolve
    })
    mocks.getRunningWebProcesses.mockReset().mockReturnValueOnce(oldScan).mockResolvedValueOnce([])

    const older = mocks.pageRefresh!()
    await vi.waitFor(() => expect(mocks.getRunningWebProcesses).toHaveBeenCalledTimes(1))
    const newer = mocks.pageRefresh!()
    await vi.waitFor(() => expect(mocks.getRunningWebProcesses).toHaveBeenCalledTimes(2))
    await newer
    expect(item).toMatchObject({ status: 'notRunning' })

    resolveOld([{ pid: 111, commandLine: '--config-server http://old.example.com:11211/alice' }])
    await older
    expect(item).toMatchObject({ status: 'notRunning', pid: undefined })
  })

  it('较早的进程扫描失败不能恢复旧状态并覆盖较新的状态', async () => {
    await mountView()
    const item = useEasyTierStore().configWebList[0]
    let rejectOld!: (error: Error) => void
    const oldScan = new Promise<unknown[]>((_resolve, reject) => {
      rejectOld = reject
    })
    mocks.getRunningWebProcesses.mockReset().mockReturnValueOnce(oldScan).mockResolvedValueOnce([])

    const older = mocks.pageRefresh!()
    await vi.waitFor(() => expect(mocks.getRunningWebProcesses).toHaveBeenCalledTimes(1))
    const newer = mocks.pageRefresh!()
    await vi.waitFor(() => expect(mocks.getRunningWebProcesses).toHaveBeenCalledTimes(2))
    await newer
    rejectOld(new Error('old scan failed'))
    await older
    expect(item).toMatchObject({ status: 'notRunning', pid: undefined })
  })
})

describe('Web 启动串行队列读取最新配置', () => {
  it('排队期间配置已更新时使用最新 URL，并把 PID 写给最新同名记录', async () => {
    await mountView()
    const requested = config()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const save = mutateWebConfigList(async (list) => {
      list[0].host = 'new.example.com'
      list[0].port = 12000
      await gate
    })

    mocks.start!(requested)
    release()
    await save

    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1))
    expect(mocks.run).toHaveBeenCalledWith('http://new.example.com:12000/alice')
    await vi.waitFor(() => expect(mocks.stored[0].pid).toBe(4321))
    expect(mocks.stored[0]).toMatchObject({
      configFileName: 'home',
      host: 'new.example.com',
      port: 12000,
      status: 'running',
      pid: 4321
    })
  })

  it('排队期间同名配置已删除时在拉起进程前拒绝启动', async () => {
    await mountView()
    const requested = config()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const remove = mutateWebConfigList(async (list) => {
      list.splice(0, 1)
      await gate
    })

    mocks.start!(requested)
    release()
    await remove

    await vi.waitFor(() => {
      expect(mocks.run.mock.calls.length + mocks.toast.mock.calls.length).toBeGreaterThan(0)
    })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(mocks.kill).not.toHaveBeenCalled()
  })

  it('排队期间最新 host 已变为非法值时不使用旧参数启动', async () => {
    await mountView()
    const requested = config()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const save = mutateWebConfigList(async (list) => {
      list[0].host = 'bad host'
      await gate
    })

    mocks.start!(requested)
    release()
    await save

    await vi.waitFor(() => {
      expect(mocks.run.mock.calls.length + mocks.toast.mock.calls.length).toBeGreaterThan(0)
    })
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
