/**
 * TOML 草稿实时校验：代码模式下 300ms 防抖校验语法，错误直接展示在编辑区顶部。
 * 只负责“文本 → 语法问题 / 保存错误”的状态，不持有文本本身，便于与表单模型解耦。
 */
import { onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { validateToml } from '@/shared/lib/tomlValidationUtil'

interface UseTomlDraftOptions {
  /** 当前 TOML 文本 getter（调用方持有 ref，切换配置时无需重建组合式函数） */
  text: () => string
  /** 仅代码模式需要实时校验，表单模式下文本变更由表单回写驱动 */
  isCodeMode: () => boolean
}

export function useTomlDraft(options: UseTomlDraftOptions) {
  const { t } = useI18n()

  // 语法问题（空串表示无问题）与归一化/写盘结果错误
  const codeIssue = ref('')
  const saveError = ref('')
  let timer: ReturnType<typeof setTimeout> | null = null

  const runValidation = () => {
    const result = validateToml(options.text())
    codeIssue.value = result.ok
      ? ''
      : t('newEdit.codeInvalid', {
          line: result.error.line,
          column: result.error.column
        })
  }

  const scheduleValidation = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      runValidation()
    }, 300)
  }

  const resetIssues = () => {
    codeIssue.value = ''
    saveError.value = ''
  }

  watch(options.text, () => {
    if (!options.isCodeMode()) return
    saveError.value = ''
    scheduleValidation()
  })

  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return { codeIssue, saveError, runValidation, scheduleValidation, resetIssues }
}
