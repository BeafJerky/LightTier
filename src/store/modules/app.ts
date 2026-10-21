/**
 * 应用外观状态（组件尺寸 / 暗黑模式 / 灰色模式）
 *
 * - state 整体持久化（persist: true），刷新后保留外观设置
 * - Element Plus 主色由 theme.css 中 `--el-color-primary: var(--theme-accent-primary)`
 *   统一映射到当前主题，不再在 JS 中写死内联色值（内联变量会覆盖样式表映射）
 */
// @ts-ignore
// @ts-nocheck
import { defineStore } from 'pinia'
import { store } from '../index'
import { ComponentSize } from 'element-plus'
import { useDark } from '@vueuse/core'

interface AppState {
  sizeMap: ComponentSize[]
  title: string
  isDark: boolean
  currentSize: ComponentSize
  greyMode: boolean
  theme: ThemeTypes
}

export const useAppStore = defineStore('app', {
  state: (): AppState => {
    return {
      sizeMap: ['default', 'large', 'small'],
      title: import.meta.env.VITE_APP_TITLE, // 标题
      isDark: false, // 是否是暗黑模式
      currentSize: 'default', // 组件尺寸
      greyMode: false, // 是否开启灰色模式，用于特殊悼念日
      theme: {
        // 主题色
        elColorPrimary: '#409eff'
      }
    }
  },
  getters: {
    getTitle(): string {
      return this.title
    },
    getIsDark(): boolean {
      return this.isDark
    },
    getCurrentSize(): ComponentSize {
      return this.currentSize
    },
    getSizeMap(): ComponentSize[] {
      return this.sizeMap
    },
    getGreyMode(): boolean {
      return this.greyMode
    },
    getTheme(): ThemeTypes {
      return this.theme
    }
  },
  actions: {
    setGreyMode(greyMode: boolean) {
      this.greyMode = greyMode
    },
    // 切换暗黑模式：html 挂载 dark/light 类名（Element Plus 与自定义变量均依赖）
    setIsDark(isDark: boolean) {
      this.isDark = isDark
      if (this.isDark) {
        document.documentElement.classList.add('dark')
        document.documentElement.classList.remove('light')
      } else {
        document.documentElement.classList.add('light')
        document.documentElement.classList.remove('dark')
      }
      this.setPrimaryLight()
    },
    setCurrentSize(currentSize: ComponentSize) {
      this.currentSize = currentSize
    },
    setTheme(theme: ThemeTypes) {
      this.theme = Object.assign(this.theme, theme)
    },
    // 兼容旧调用：主色变量已由 theme.css 按当前主题映射，JS 不再写内联色值
    setCssVarTheme() {
      this.setPrimaryLight()
    },
    // 旧版会在根节点内联写入 --el-color-primary 及其梯度，优先级高于 [data-theme] 映射，
    // 导致切换主题后 Element Plus 仍为默认蓝色。现统一交给 theme.css 的 color-mix 派生。
    setPrimaryLight() {
      /* no-op：保留方法签名，避免历史调用点报错 */
    },
    // 初始化主题：同步 vueuse useDark 与 store 状态（App.vue onBeforeMount 调用）
    initTheme() {
      const isDark = useDark({
        valueDark: 'dark',
        valueLight: 'light'
      })
      isDark.value = this.getIsDark
    }
  },
  persist: true
})

export const useAppStoreWithOut = () => {
  return useAppStore(store)
}
