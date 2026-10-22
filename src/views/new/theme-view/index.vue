<template>
  <div class="ntv-page">
    <ThemeDialog v-model="visible" inline />
  </div>
</template>

<script setup lang="ts">
/** theme-view — 主题二级页面（Android 专属）：将 ThemeDialog 以 inline 卡片形式承载 */
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ThemeDialog from '@/components/ThemeDialog/index.vue'

defineOptions({ name: 'NewThemeView' })

const router = useRouter()
// 先关后开：触发面板内部 watch(visible) 的初始化逻辑（主题列表与预览渲染，与点击入口打开弹窗时一致）
const visible = ref(false)
onMounted(() => {
  visible.value = true
})

// 面板关闭（取消/应用主题后）→ 回退设置首页；无历史时同样回设置
watch(visible, (v) => {
  if (!v) {
    if (window.history.state?.back) router.back()
    else router.push('/new/settings')
  }
})
</script>

<style scoped>
.ntv-page {
  height: 100%;
}
</style>
