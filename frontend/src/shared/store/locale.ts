/**
 * 语言状态
 *
 * 当前语言持久化到 localStorage（键 lang），刷新后保持；
 * 语言包切换与 <html lang> 同步由 @/shared/i18n 负责，store 只保存业务语言标识。
 */
import { defineStore } from 'pinia'
import { pinia } from './pinia'
import { useStorage } from '@/shared/lib/useStorage'

export interface LocaleOption {
  lang: LocaleType
  name: string
}

const { getStorage, setStorage } = useStorage()

const readInitialLocale = (): LocaleType => (getStorage('lang') === 'en' ? 'en' : 'zh-CN')

export const useLocaleStore = defineStore('locales', {
  state: () => ({
    currentLocale: { lang: readInitialLocale() },
    localeMap: [
      { lang: 'zh-CN', name: '简体中文' },
      { lang: 'en', name: 'English' }
    ] as LocaleOption[]
  }),
  getters: {
    getCurrentLocale: (state) => state.currentLocale,
    getLocaleMap: (state) => state.localeMap
  },
  actions: {
    setCurrentLocale(locale: { lang: LocaleType }) {
      this.currentLocale.lang = locale.lang
      setStorage('lang', locale.lang)
    }
  }
})

export const useLocaleStoreWithOut = () => useLocaleStore(pinia)
