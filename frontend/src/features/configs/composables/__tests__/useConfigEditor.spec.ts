import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useConfigEditor } from '@/features/configs/composables/useConfigEditor'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('@/shared/platform/platformUtil', () => ({ isWindows: () => false }))
vi.mock('@/shared/store/easytier', () => ({
  useEasyTierStore: () => ({ detectedCoreVersion: 'v2.7.0' })
}))

const createEditor = () => {
  const visible = ref(true)
  const emitSaved = vi.fn((_name: string, _content: string, done: (ok: boolean) => void) => {
    done(true)
  })
  const editor = useConfigEditor({
    props: {
      configName: 'home',
      tomlContent: 'hostname = "before"\n',
      dialogMode: 'edit'
    },
    emitSaved,
    visible
  })
  editor.editMode.value = 'code'
  editor.switchToForm()
  return { editor, emitSaved, visible }
}

describe('useConfigEditor 保存基线', () => {
  it('代码模式修改普通字段后必须调用父组件写盘，不能按本次内容自身跳过', async () => {
    const { editor, emitSaved } = createEditor()
    editor.editMode.value = 'code'
    editor.tomlContent.value = editor.tomlContent.value.replace('before', 'after')

    await editor.handleSave()

    expect(emitSaved).toHaveBeenCalledOnce()
    expect(emitSaved.mock.calls[0][1]).toContain('hostname = "after"')
  })

  it('未产生语义变化时保留原文且不重复写盘', async () => {
    const { editor, emitSaved, visible } = createEditor()
    editor.editMode.value = 'code'

    await editor.handleSave()

    expect(editor.saveError.value).toBe('')
    expect(emitSaved).not.toHaveBeenCalled()
    expect(visible.value).toBe(false)
  })
})
