/**
 * Pinia 装配
 *
 * 实例与 persistedstate 插件见 ./pinia；这里只负责挂载到 Vue 应用。
 */
import type { App } from 'vue'
import { pinia } from './pinia'

export { pinia }

export const setupStore = (app: App<Element>) => {
  app.use(pinia)
}
