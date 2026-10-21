/**
 * 应用外观状态（组件尺寸 / 暗黑模式 / 灰色模式）
 *
 * - state 整体持久化（persist: true），刷新后保留外观设置
 * - 主题外观由 theme.css 的 --theme-* 变量驱动；组件库色板经 ConfigGlobal 映射，
 *   JS 不再写死或内联组件库色值
 */
// @ts-ignore
// @ts-nocheck
import { defineStore } from 'pinia'
import { store } from '../index'
import { useDark } from '@vueuse/core'

type AppComponentSize = 'default' | 'small' | 'large'

interface AppState {
  sizeMap: AppComponentSize[]
  title: string
  isDark: boolean
  currentSize: AppComponentSize
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
        // 历史备份字段：保留读写以兼容旧备份文件，不再参与实际主题渲染
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
    getCurrentSize(): AppComponentSize {
      return this.currentSize
    },
    getSizeMap(): AppComponentSize[] {
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
    // 切换暗黑模式：同步 html 的 dark/light 类名（useDark 兼容层）
    setIsDark(isDark: boolean) {
      this.isDark = isDark
      if (this.isDark) {
        document.documentElement.classList.add('dark')
        document.documentElement.classList.remove('light')
      } else {
        document.documentElement.classList.add('light')
        document.documentElement.classList.remove('dark')
      }
    },
    setCurrentSize(currentSize: AppComponentSize) {
      this.currentSize = currentSize
    },
    setTheme(theme: ThemeTypes) {
      this.theme = Object.assign(this.theme, theme)
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
