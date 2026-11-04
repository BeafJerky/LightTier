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

const root = __dirname

function pathResolve(dir: string) {
  return resolve(root, '.', dir)
}

export default ({ command, mode }: ConfigEnv): UserConfig => {
  const isBuild = command === 'build'
  const env = loadEnv(mode, root)
  return {
    root,
    base: env.VITE_BASE_PATH,
    plugins: [
      Vue(),
      VueJsx(),
      ServerUrlCopy(),
      isBuild ? undefined : progress(),
      isBuild
        ? undefined
        : VueDevTools({
            componentInspector: true
          }),
      VueI18nPlugin({
        runtimeOnly: true,
        compositionOnly: true,
        include: [resolve(__dirname, 'src/shared/i18n/locales/**')]
      }),
      ViteEjsPlugin({
        title: env.VITE_APP_TITLE
      }),
      // UnoCSS 按 process.cwd() 找配置；用 --config 从仓库根启动时必须显式指定
      UnoCSS({ configFile: resolve(__dirname, 'uno.config.ts') })
    ],

    css: {
      preprocessorOptions: {
        less: {
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
      // esbuild 压缩无需额外依赖，构建速度快
      minify: 'esbuild',
      reportCompressedSize: false, // 跳过 gzip 体积统计，缩短构建时间
      rollupOptions: {
        maxParallelFileOps: 3,
        plugins: env.VITE_USE_BUNDLE_ANALYZER === 'true' ? [visualizer()] : undefined,
        // 依赖按体积拆成独立 chunk，避免首屏加载整包
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // Monaco Editor 不分割语言模块，避免循环依赖
              if (id.includes('monaco-editor')) {
                return 'monaco-editor'
              }
              // Vue 与 UI 库互有依赖，拆成两个 chunk 会形成跨 chunk 循环引用，
              // 生产构建下触发 TDZ（Cannot access 'x' before initialization），首屏无法挂载
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
      // tauri.conf.json5 的 devUrl 固定 4000，被占用时必须直接失败，避免 Vite 自动换端口后应用连错地址
      strictPort: true,
      watch: {
        // Rust 构建产物不需要触发前端热更新
        ignored: ['**/src-tauri/**', '../src-tauri/**']
      }
    },
    optimizeDeps: {
      include: ['vue', 'vue-router', 'naive-ui', 'dayjs']
    },
    clearScreen: false,
    // TAURI_ENV_* 由 Tauri CLI 注入，供构建期读取目标平台等信息
    envPrefix: ['VITE_', 'TAURI_ENV_*']
  }
}
