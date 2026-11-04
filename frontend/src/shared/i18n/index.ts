/**
 * 多语言装配与切换
 *
 * 启动时按 locale store 的语言动态加载语言包；切换语言时按需加载新语言包、
 * 更新 i18n 实例、locale store 与 <html lang>，保持一致。
 * 使用 Composition API 模式（legacy: false），关闭缺词/回退告警避免控制台噪音。
 */
import type { App } from 'vue'
import { createI18n } from 'vue-i18n'
import { useLocaleStoreWithOut } from '@/shared/store/locale'

export let i18n: ReturnType<typeof createI18n>

const loadLocaleMessages = async (locale: LocaleType) => {
  const module = await import(`./locales/${locale}.ts`)
  return module.default ?? {}
}

const applyLocale = (locale: LocaleType) => {
  ;(i18n.global.locale as unknown as { value: LocaleType }).value = locale
  useLocaleStoreWithOut().setCurrentLocale({ lang: locale })
  document.documentElement.lang = locale
}

export const setupI18n = async (app: App<Element>) => {
  const locale = useLocaleStoreWithOut().getCurrentLocale.lang

  i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: locale,
    messages: { [locale]: await loadLocaleMessages(locale) },
    missingWarn: false,
    fallbackWarn: false
  })
  applyLocale(locale)
  app.use(i18n)
}

/** 切换语言（幂等，重复切换只会覆盖同一语言包） */
export const changeLocale = async (locale: LocaleType) => {
  i18n.global.setLocaleMessage(locale, await loadLocaleMessages(locale))
  applyLocale(locale)
}
