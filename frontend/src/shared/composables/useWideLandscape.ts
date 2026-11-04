import { onBeforeUnmount, onMounted, ref } from 'vue'

const QUERY = '(width >= 700px) and (orientation: landscape)'

// 横屏宽屏（手机横屏 / 平板）：JS 侧判断是否需要走分栏交互（如列表本地选中而非路由跳转）
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
