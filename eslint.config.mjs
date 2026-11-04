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
    'no-useless-escape': 0, // TODO: evaluate whether to re-enable
    'no-undef': 0, // TODO: evaluate whether to re-enable
    'vue/no-reserved-component-names': 0, // TODO: evaluate whether to re-enable
    '@typescript-eslint/explicit-function-return-type': 0, // TODO: evaluate whether to re-enable
    '@typescript-eslint/no-explicit-any': 0, // TODO: evaluate whether to re-enable
    '@typescript-eslint/no-empty-function': 0, // TODO: evaluate whether to re-enable
    'vue/custom-event-name-casing': 0, // TODO: evaluate whether to re-enable
    'no-use-before-define': 0, // TODO: evaluate whether to re-enable
    '@typescript-eslint/no-use-before-define': 0, // TODO: evaluate whether to re-enable
    '@typescript-eslint/ban-ts-comment': 0, // TODO: evaluate whether to re-enable
    '@typescript-eslint/no-non-null-assertion': 0, // TODO: evaluate whether to re-enable
    '@typescript-eslint/explicit-module-boundary-types': 0, // TODO: evaluate whether to re-enable
    '@typescript-eslint/no-unused-vars': 0, // TODO: evaluate whether to re-enable
    'no-unused-vars': 0, // TODO: evaluate whether to re-enable
    'space-before-function-paren': 0, // TODO: evaluate whether to re-enable
    'vue/attributes-order': 0, // TODO: evaluate whether to re-enable
    'vue/one-component-per-file': 0, // TODO: evaluate whether to re-enable
    'vue/html-closing-bracket-newline': 0, // TODO: evaluate whether to re-enable
    'vue/max-attributes-per-line': 0, // TODO: evaluate whether to re-enable
    'vue/multiline-html-element-content-newline': 0, // TODO: evaluate whether to re-enable
    'vue/singleline-html-element-content-newline': 0, // TODO: evaluate whether to re-enable
    'vue/attribute-hyphenation': 0, // TODO: evaluate whether to re-enable
    'vue/require-default-prop': 0, // TODO: evaluate whether to re-enable
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
    'vue/multi-word-component-names': 0, // TODO: evaluate whether to re-enable
    'vue/no-v-html': 0, // TODO: evaluate whether to re-enable
    'no-async-promise-executor': 0 // TODO: evaluate whether to re-enable
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
