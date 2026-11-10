/**
 * usePageConfirm 单测：Promise 化确认、按钮结算与外部关闭兜底
 */
import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { usePageConfirm } from '@/shared/ui/usePageConfirm'

describe('usePageConfirm', () => {
  it('show 填充标题/内容并返回按选择结算的 Promise', async () => {
    const { visible, title, message, show, resolve } = usePageConfirm()
    const pending = show('停止实例', '确认停止？')
    expect(visible.value).toBe(true)
    expect(title.value).toBe('停止实例')
    expect(message.value).toBe('确认停止？')
    resolve(true)
    await expect(pending).resolves.toBe(true)
    expect(visible.value).toBe(false)
  })

  it('外部关闭（遮罩等）按取消结算', async () => {
    const { visible, show } = usePageConfirm()
    const pending = show('提示', '内容')
    visible.value = false
    await nextTick()
    await expect(pending).resolves.toBe(false)
  })

  it('重复 show 时旧请求按取消结算，不悬挂', async () => {
    const { show, resolve } = usePageConfirm()
    const first = show('A', 'a')
    const second = show('B', 'b')
    await expect(first).resolves.toBe(false)
    resolve(true)
    await expect(second).resolves.toBe(true)
  })
})
