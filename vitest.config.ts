import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default defineConfig((env) => {
  const base = viteConfig({ command: 'serve', mode: env.mode })
  return mergeConfig(base, {
    test: {
      css: true
    }
  })
})
