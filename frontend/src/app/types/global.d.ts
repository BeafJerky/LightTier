declare global {
  type LocaleType = 'zh-CN' | 'en'

  type TimeoutHandle = ReturnType<typeof setTimeout>

  interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string
    readonly VITE_BASE_PATH: string
    readonly VITE_DROP_DEBUGGER: string
    readonly VITE_DROP_CONSOLE: string
    readonly VITE_SOURCEMAP: string
    readonly VITE_OUT_DIR: string
    readonly VITE_USE_BUNDLE_ANALYZER: string
    readonly VITE_USE_CSS_SPLIT: string
  }
}

export {}
