import { resolve } from 'path'
import type { ConfigEnv, UserConfig } from 'vite'
import { loadEnv } from 'vite'
import Vue from '@vitejs/plugin-vue'
import VueJsx from '@vitejs/plugin-vue-jsx'
import progress from 'vite-plugin-progress'
import { ViteEjsPlugin } from 'vite-plugin-ejs'
import ServerUrlCopy from 'vite-plugin-url-copy'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import UnoCSS from 'unocss/vite'
import { visualizer } from 'rollup-plugin-visualizer'
import VueDevTools from 'vite-plugin-vue-devtools'

// https://vitejs.dev/config/
const root = process.cwd()

function pathResolve(dir: string) {
  return resolve(root, '.', dir)
}

export default ({ command, mode }: ConfigEnv): UserConfig => {
  let env = {} as any
  const isBuild = command === 'build'
  if (!isBuild) {
    env = loadEnv(process.argv[3] === '--mode' ? process.argv[4] : process.argv[3], root)
  } else {
    env = loadEnv(mode, root)
  }
  return {
    base: env.VITE_BASE_PATH,
    plugins: [
      Vue(),
      VueJsx(),
      ServerUrlCopy(),
      isBuild ? undefined : progress(),
      isBuild
        ? undefined
        : VueDevTools({
            // 启用 Vue DevTools
            componentInspector: true
          }),
      VueI18nPlugin({
        runtimeOnly: true,
        compositionOnly: true,
        include: [resolve(__dirname, 'src/locales/**')]
      }),
      ViteEjsPlugin({
        title: env.VITE_APP_TITLE
      }),
      UnoCSS()
    ],

    css: {
      preprocessorOptions: {
        less: {
          additionalData: `@import "${pathResolve('src/styles/variables.module.less').replace(/\\/g, '/')}";`,
          javascriptEnabled: true,
          math: 'always'
        }
      }
    },
    resolve: {
      alias: [
        {
          find: 'vue-i18n',
          replacement: 'vue-i18n/dist/vue-i18n.cjs.js'
        },
        {
          find: /\@\//,
          replacement: `${pathResolve('src')}/`
        }
      ]
    },
    esbuild: {
      pure: env.VITE_DROP_CONSOLE === 'true' ? ['console.log'] : undefined,
      drop: env.VITE_DROP_DEBUGGER === 'true' ? ['debugger'] : undefined
    },
    build: {
      target: 'ESNext',
      outDir: env.VITE_OUT_DIR || 'dist',
      assetsDir: 'assets',
      sourcemap: env.VITE_SOURCEMAP === 'true',
      // 使用 esbuild 作为压缩器，比 terser 快 20-40 倍
      minify: 'esbuild',
      reportCompressedSize: false, // 禁用 gzip 压缩大小报告，提升打包速度
      rollupOptions: {
        maxParallelFileOps: 3,
        plugins: env.VITE_USE_BUNDLE_ANALYZER === 'true' ? [visualizer()] : undefined,
        // 拆包
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (
                id.includes('vue') ||
                id.includes('pinia') ||
                id.includes('vue-router') ||
                id.includes('vue-i18n')
              ) {
                return 'vue-chunks'
              }
              // Monaco Editor 不分割语言模块，避免循环依赖
              if (id.includes('monaco-editor')) {
                return 'monaco-editor'
              }
              return 'vendor'
            }
          }
        }
      },
      cssCodeSplit: !(env.VITE_USE_CSS_SPLIT === 'false')
    },
    worker: {
      format: 'es'
    },
    server: {
      port: 4000,
      host: '0.0.0.0',
      watch: {
        // tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**']
      }
    },
    optimizeDeps: {
      include: ['vue', 'vue-router', 'vue-types', 'naive-ui', '@vueuse/core', 'dayjs']
    },
    clearScreen: false,
    // Env variables starting with the item of `envPrefix` will be exposed in tauri's source code through `import.meta.env`.
    envPrefix: ['VITE_', 'TAURI_ENV_*']
  }
}
