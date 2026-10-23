<script setup lang="ts">
/**
 * CodeEditor — Monaco 代码编辑器（TOML 配置编辑专用，EditDialog 代码模式）
 *
 * 关键设计：
 * - Monaco Worker 与 TOML 语法注册均为模块级单次初始化（ensureTomlLanguage 幂等），
 *   避免多实例重复注册导致重复高亮 / 内存膨胀；
 * - 外部 modelValue 变更走 updateMonacoVal：先比对避免回环，临时解除 readOnly 后
 *   写入并自动格式化（格式化依赖 model 内容，10ms 延迟等待渲染）；
 * - 组件卸载时 dispose 编辑器，防止 Monaco 实例泄漏。
 * 注意：monaco 为强制独立 chunk（vite manualChunks），勿改分包策略。
 */
// @ts-ignore
// @ts-nocheck
import * as monaco from 'monaco-editor'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Monaco Worker 环境（模块级，仅初始化一次）
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === 'json') {
      return new jsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  }
}

// TOML 语法高亮注册（模块级单次）
let tomlRegistered = false
const ensureTomlLanguage = () => {
  if (tomlRegistered) return
  tomlRegistered = true
  monaco.languages.register({ id: 'toml' })
  monaco.languages.setMonarchTokensProvider('toml', {
    tokenizer: {
      root: [
        [/#.*$/, 'comment'], // 注释
        [/\[.*?\]/, 'section'], // 节
        [/[a-zA-Z_][a-zA-Z0-9_]*/, 'key'], // 键
        [/\s*=\s*/, 'operator'], // 操作符
        [/"([^"\\]|\\.)*"/, 'string'], // 字符串
        [/'([^'\\]|\\.)*'/, 'string'], // 字符串
        [/\d+/, 'number'], // 数字
        [/\s+/, 'white'], // 空白
        [/./, 'text'] // 文本
      ]
    }
  })
}

const props = withDefaults(
  defineProps<{
    width?: string | number
    height?: string | number
    language?: string
    theme?: string
    editorOption?: object
    modelValue: string
    readOnly?: boolean // 是否只读 取值 true | false
    wordWrap?: string // 开启自动换行 取值 off | on
  }>(),
  {
    width: '100%',
    height: '100%',
    language: 'plaintext',
    theme: 'vs-dark',
    editorOption: () => ({}),
    modelValue: '',
    readOnly: false, // 是否只读 取值 true | false
    wordWrap: 'off' // 开启自动换行
  }
)

const emits = defineEmits<{
  (e: 'blur'): void
  (e: 'update:modelValue', val: string): void
}>()

const monacoEditorRef = ref<HTMLElement>()
let monacoEditor: monaco.editor.IStandaloneCodeEditor | null = null
// 显式持有的 model：editor.dispose() 不会释放外部传入的 model
let monacoModel: monaco.editor.ITextModel | null = null

const monacoEditorStyle = computed(() => {
  return {
    width: typeof props.width === 'string' ? props.width : props.width + 'px',
    height: typeof props.height === 'string' ? props.height : props.height + 'px'
  }
})

onMounted(() => {
  ensureTomlLanguage()
  if (!monacoEditorRef.value) return
  monacoModel = monaco.editor.createModel('', props.language)
  monacoEditor = monaco.editor.create(monacoEditorRef.value, {
    // 初始模型
    model: monacoModel,
    // 是否启用预览图
    minimap: { enabled: true },
    // 圆角
    roundedSelection: true,
    // 主题
    theme: props.theme,
    readOnly: props.readOnly,
    wordWrap: props.wordWrap as monaco.editor.IEditorOptions['wordWrap'],
    // 主键
    multiCursorModifier: 'ctrlCmd',
    // 滚动条
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8
    },
    // 行号
    lineNumbers: 'on',
    // tab大小
    tabSize: 2,
    //字体大小
    fontSize: 14,
    // 控制编辑器在用户键入、粘贴、移动或缩进行时是否应自动调整缩进
    autoIndent: 'advanced',
    // 自动布局
    automaticLayout: true,
    ...props.editorOption
  })
  updateMonacoVal(props.modelValue)
  monacoEditor.onDidChangeModelContent(() => {
    emits('update:modelValue', monacoEditor!.getValue())
  })
  monacoEditor.onDidBlurEditorText(() => {
    emits('blur')
  })
})

watch(
  () => props.modelValue,
  () => {
    updateMonacoVal(props.modelValue)
  }
)

// 外部值 → 编辑器：相同值跳过（防 v-model 回环）。
// setValue 需要只读解锁（格式化命令同样依赖可写状态），写入后必须恢复原只读状态
function updateMonacoVal(val: string) {
  if (val === monacoEditor?.getValue()) return
  nextTick(() => {
    if (!monacoEditor) return
    const wasReadOnly = monacoEditor.getOption(monaco.editor.EditorOption.readOnly)
    if (wasReadOnly) monacoEditor.updateOptions({ readOnly: false })
    monacoEditor.setValue(val)
    setTimeout(async () => {
      if (!monacoEditor) return
      try {
        await monacoEditor.getAction('editor.action.formatDocument')?.run()
      } finally {
        if (wasReadOnly) monacoEditor?.updateOptions({ readOnly: true })
      }
    }, 10)
  })
}

// 供父组件动态更新编辑器选项（defineExpose 暴露）
const updateOptions = (opt: monaco.editor.IStandaloneEditorConstructionOptions) => {
  monacoEditor?.updateOptions(opt)
}

// 页面离开 销毁（model 为外部创建，需单独释放，否则每次打开弹窗都会泄漏一份）
onBeforeUnmount(() => {
  monacoEditor?.dispose()
  monacoEditor = null
  monacoModel?.dispose()
  monacoModel = null
})

defineExpose({ updateOptions })
</script>

<template>
  <div ref="monacoEditorRef" :style="monacoEditorStyle"></div>
</template>
