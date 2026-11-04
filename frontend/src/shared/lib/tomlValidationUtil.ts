import * as toml from 'smol-toml'

export interface TomlSyntaxError {
  line: number
  column: number
  message: string
}

export type TomlValidationResult =
  | { ok: true }
  | {
      ok: false
      error: TomlSyntaxError
    }

/**
 * 校验 TOML 文本语法（供编辑弹窗保存前与实时提示复用）。
 * 解析失败时返回 smol-toml 提供的行列信息，缺失时回退为 0。
 */
export const validateToml = (content: string): TomlValidationResult => {
  try {
    toml.parse(content)
    return { ok: true }
  } catch (error) {
    const err = error as { line?: number; column?: number; message?: string }
    return {
      ok: false,
      error: {
        line: typeof err.line === 'number' ? err.line : 0,
        column: typeof err.column === 'number' ? err.column : 0,
        message: err.message || String(error)
      }
    }
  }
}
