// 引入vue模版的eslint
import pluginVue from 'eslint-plugin-vue'
import eslint from '@eslint/js'
// ts-eslint解析器，使 eslint 可以解析 ts 语法
import tseslint from 'typescript-eslint'
// vue文件解析器
import vueParser from 'vue-eslint-parser'
import prettier from 'eslint-plugin-prettier'

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      'prettier.config.cjs',
      'dist',
      'src-tauri',
      'target',
      'auto-imports.d.ts',
      'components.d.ts',
      'frontend/src/**/*.d.ts'
    ]
  },
  {
  files: ['frontend/src/**/*.ts', 'frontend/src/**/*.tsx', 'frontend/src/**/*.vue'],
  // tseslint.config添加了extends扁平函数，直接用。否则是eslint9.0版本是没有extends的
  extends: [
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs['flat/essential']
  ],
  plugins: {
    prettier
  },
  languageOptions: {
    parser: vueParser, // 使用vue解析器，这个可以识别vue文件
    parserOptions: {
      parser: tseslint.parser, // 在vue文件上使用ts解析器
      sourceType: 'module',
      ecmaVersion: 2020,
      ecmaFeatures: {
        jsx: true
      }
    }
  },
  rules: {
    'prettier/prettier': 'error',
    'no-undef': 0, // TS 负责标识符检查；ESLint no-undef 对 TS 类型与浏览器全局误报较多
    '@typescript-eslint/explicit-function-return-type': 0, // 仅要求导出 API 显式返回类型时再启用
    '@typescript-eslint/no-explicit-any': 0, // 历史平台桥接代码大量 any，逐模块收敛后再启用
    '@typescript-eslint/no-empty-function': 0, // 大量事件占位回调，启用需逐个标注意图
    'vue/custom-event-name-casing': 0, // 代码库统一使用 kebab-case 事件名，保持现状
    'no-use-before-define': 0,
    '@typescript-eslint/no-use-before-define': 0,
    '@typescript-eslint/no-non-null-assertion': 0,
    '@typescript-eslint/explicit-module-boundary-types': 0,
    '@typescript-eslint/no-unused-vars': 0, // 待单独批次清理未使用变量后启用
    'no-unused-vars': 0,
    'space-before-function-paren': 0, // 与 Prettier 冲突，交由 Prettier 决定
    'vue/attributes-order': 0,
    'vue/one-component-per-file': 0,
    'vue/html-closing-bracket-newline': 0,
    'vue/max-attributes-per-line': 0,
    'vue/multiline-html-element-content-newline': 0,
    'vue/singleline-html-element-content-newline': 0,
    'vue/attribute-hyphenation': 0,
    'vue/require-default-prop': 0,
    'vue/html-self-closing': [
      1,
      {
        html: {
          void: 'always',
          normal: 'never',
          component: 'always'
        },
        svg: 'always',
        math: 'always'
      }
    ],
    'vue/multi-word-component-names': 0, // 单文件页面组件命名与路由目录保持一致
    // shellUtil 中 6 处 async Promise executor 属历史写法，重构涉及进程检测主链路，
    // 留待单独批次改造后再启用该规则。
    'no-async-promise-executor': 0
  }
  },
  {
    files: ['frontend/src/shared/**/*.ts', 'frontend/src/shared/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features/**', '@/app/**'], message: 'shared 不得依赖 features 或 app' }
          ]
        }
      ]
    }
  },
  {
    files: ['frontend/src/entities/**/*.ts', 'frontend/src/entities/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features/**', '@/app/**'], message: 'entities 不得依赖 features 或 app' },
            { group: ['@/shared/platform/**'], message: 'entities 不得依赖平台调用' },
            { group: ['@/shared/store/**'], message: 'entities 不得依赖 store' },
            { group: ['@/shared/ui/**'], message: 'entities 不得依赖 UI' },
            { group: ['@/shared/composables/**'], message: 'entities 不得依赖编排 composable' }
          ]
        }
      ]
    }
  },
  {
    files: ['frontend/src/features/instances/**/*.ts', 'frontend/src/features/instances/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/**'], message: 'feature 不得依赖 app' },
            {
              group: [
                '@/features/configs/**',
                '@/features/web-configs/**',
                '@/features/settings/**',
                '@/features/themes/**'
              ],
              message: 'feature 之间禁止互相依赖'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['frontend/src/features/configs/**/*.ts', 'frontend/src/features/configs/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/**'], message: 'feature 不得依赖 app' },
            {
              group: [
                '@/features/instances/**',
                '@/features/web-configs/**',
                '@/features/settings/**',
                '@/features/themes/**'
              ],
              message: 'feature 之间禁止互相依赖'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['frontend/src/features/web-configs/**/*.ts', 'frontend/src/features/web-configs/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/**'], message: 'feature 不得依赖 app' },
            {
              group: [
                '@/features/instances/**',
                '@/features/configs/**',
                '@/features/settings/**',
                '@/features/themes/**'
              ],
              message: 'feature 之间禁止互相依赖'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['frontend/src/features/settings/**/*.ts', 'frontend/src/features/settings/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/**'], message: 'feature 不得依赖 app' },
            {
              group: [
                '@/features/instances/**',
                '@/features/configs/**',
                '@/features/web-configs/**',
                '@/features/themes/**'
              ],
              message: 'feature 之间禁止互相依赖'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['frontend/src/features/themes/**/*.ts', 'frontend/src/features/themes/**/*.vue'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/**'], message: 'feature 不得依赖 app' },
            {
              group: [
                '@/features/instances/**',
                '@/features/configs/**',
                '@/features/web-configs/**',
                '@/features/settings/**'
              ],
              message: 'feature 之间禁止互相依赖'
            }
          ]
        }
      ]
    }
  }
)
