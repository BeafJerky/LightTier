/**
 * i18n 装配
 *
 * 按 locale store 当前语言动态 import 对应语言包（zh-CN / en），
 * 采用 Composition API 模式（legacy: false），关闭缺词/回退告警避免控制台噪音。
 */
import type { App } from 'vue'
import { createI18n } from 'vue-i18n'
import { useLocaleStoreWithOut } from '@/store/modules/locale'
import type { I18nOptions } from 'vue-i18n'
import { setHtmlPageLang } from './helper'

export let i18n: ReturnType<typeof createI18n>

const createI18nOptions = async (): Promise<I18nOptions> => {
  const localeStore = useLocaleStoreWithOut()
  const locale = localeStore.getCurrentLocale
  const localeMap = localeStore.getLocaleMap
  // 动态导入语言包，避免同时打包两套文案
  const defaultLocal = await import(`../../locales/${locale.lang}.ts`)
  const message = defaultLocal.default ?? {}

  setHtmlPageLang(locale.lang)

  localeStore.setCurrentLocale({ lang: locale.lang })

  return {
    legacy: false,
    locale: locale.lang,
    fallbackLocale: locale.lang,
    messages: {
      [locale.lang]: message
    },
    availableLocales: localeMap.map((v) => v.lang),
    sync: true,
    silentTranslationWarn: true,
    missingWarn: false,
    silentFallbackWarn: true
  }
}

export const setupI18n = async (app: App<Element>) => {
  const options = await createI18nOptions()
  i18n = createI18n(options)
  app.use(i18n)
}
