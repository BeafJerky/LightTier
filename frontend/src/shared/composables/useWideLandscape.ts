import { onBeforeUnmount, onMounted, ref } from 'vue'

const QUERY = '(width >= 768px)'

// 宽屏（手机横屏 / 平板横竖屏）：JS 侧判断是否走分栏交互（如列表本地选中而非路由跳转）。
// 只按宽度判断，和 CSS 分栏断点保持一致；短屏压缩由各自媒体查询处理。
export const useWideLandscape = () => {
  const matched = ref(false)
  let mq: MediaQueryList | null = null

  const sync = () => {
    matched.value = mq?.matches ?? false
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    mq = window.matchMedia(QUERY)
    sync()
    mq.addEventListener('change', sync)
  })

  onBeforeUnmount(() => {
    mq?.removeEventListener('change', sync)
    mq = null
  })

  return matched
}
