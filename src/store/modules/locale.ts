/**
 * 语言（locale）状态管理
 *
 * - currentLocale 持久化到 localStorage，刷新后保持上次语言
 * - 组件库语言包由 ConfigGlobal 按 lang 映射，store 只维护业务语言标识
 */
import { defineStore } from 'pinia'
import { store } from '../index'
import { useStorage } from '@/hooks/web/useStorage'

interface LocaleDropdownType {
  lang: LocaleType
  name?: string
}

const { getStorage, setStorage } = useStorage('localStorage')

interface LocaleState {
  currentLocale: LocaleDropdownType
  localeMap: LocaleDropdownType[]
}

export const useLocaleStore = defineStore('locales', {
  state: (): LocaleState => {
    return {
      // 初始语言：读取本地存储，默认简体中文
      currentLocale: {
        lang: (getStorage('lang') as LocaleType) || 'zh-CN'
      },
      // 多语言
      localeMap: [
        {
          lang: 'zh-CN',
          name: '简体中文'
        },
        {
          lang: 'en',
          name: 'English'
        }
      ]
    }
  },
  getters: {
    getCurrentLocale(): LocaleDropdownType {
      return this.currentLocale
    },
    getLocaleMap(): LocaleDropdownType[] {
      return this.localeMap
    }
  },
  actions: {
    setCurrentLocale(localeMap: LocaleDropdownType) {
      this.currentLocale.lang = localeMap?.lang
      setStorage('lang', localeMap?.lang)
    }
  }
})

export const useLocaleStoreWithOut = () => {
  return useLocaleStore(store)
}
