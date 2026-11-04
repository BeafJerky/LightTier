/**
 * Pinia 实例
 *
 * 注册 persistedstate 插件（各 store 通过 persist 选项声明持久化字段）。
 * 独立成文件，避免 i18n → store/index → 全部 store 的模块环。
 */
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

export const pinia = createPinia()

pinia.use(piniaPluginPersistedstate)
