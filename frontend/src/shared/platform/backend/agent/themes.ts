/**
 * 主题能力（M4）。
 *
 * agent 把导入的主题存到服务端 `<data>/themes`，浏览器只负责读取与上传：
 * - `GET /api/v1/themes` 返回元信息，完整 CSS 由逐项 `GET /themes/{name}` 拉取，
 *   与设计文档的端点划分保持一致；
 * - 名称只允许 `[A-Za-z0-9_-]`，路径仍统一编码；
 * - 服务端已做大小与变量数校验，失败错误码 `invalid_theme` / `invalid_id`。
 */
import { request } from '../http'
import type { Backend } from '../types'

type ThemeListWire = { themes?: { name: string }[] }
type ThemeDocumentWire = { name: string; cssText: string }

const themePath = (name: string): string => `/api/v1/themes/${encodeURIComponent(name)}`

export const agentThemes: Backend['themes'] = {
  list: async () => {
    const payload = await request<ThemeListWire>('/api/v1/themes')
    const names = Array.isArray(payload?.themes) ? payload.themes.map((item) => item.name) : []
    // 主题总量小（用户手工导入），逐项取回完整 CSS 换取更简单的服务端契约
    const documents = await Promise.all(
      names.map((name) => request<ThemeDocumentWire>(themePath(name)))
    )
    return documents.map((doc) => ({ name: doc.name, cssText: doc.cssText }))
  },

  read: async (name) => {
    const document = await request<ThemeDocumentWire>(themePath(name))
    return document.cssText
  },

  save: async (name, cssText) => {
    await request('/api/v1/themes', { method: 'POST', body: { name, cssText } })
  },

  remove: async (name) => {
    await request(themePath(name), { method: 'DELETE' })
  }
}
