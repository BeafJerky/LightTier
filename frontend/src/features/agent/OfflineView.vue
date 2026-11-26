<script setup lang="ts">
/**
 * agent 离线页。
 *
 * 生产浏览器 / `?agent=1` 探测不到 lighttier-agent 时，main.ts 用独立 createApp
 * 直接挂载本组件（不装配路由与 store）：只展示原因与重试入口，绝不回退 Mock，
 * 避免用户误以为自己在操作真实配置。
 */
import { t } from '@/shared/i18n/t'
import { LtButton } from '@/shared/ui'

const title = t('newAuth.offlineTitle')
const body = t('newAuth.offlineBody')
const retryText = t('newAuth.offlineRetry')

const retry = () => {
  // 整页重载：重新走一次模式探测，无需在此处维护重试状态
  location.reload()
}
</script>

<template>
  <div class="lt-offline">
    <section class="lt-offline__card" role="alert">
      <h1 class="lt-offline__title">{{ title }}</h1>
      <p class="lt-offline__body">{{ body }}</p>
      <LtButton variant="primary" @click="retry">{{ retryText }}</LtButton>
    </section>
  </div>
</template>

<style scoped>
.lt-offline {
  display: flex;
  min-height: 100vh;
  padding: var(--theme-space-6);
  font-family: var(--theme-font-body);
  color: var(--theme-text-primary);
  background: var(--theme-bg);
  align-items: center;
  justify-content: center;
}

.lt-offline__card {
  display: flex;
  width: min(32rem, 100%);
  padding: var(--theme-space-6);
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-xl);
  box-shadow: 0 12px 32px rgb(0 0 0 / 8%);
  flex-direction: column;
  align-items: flex-start;
  gap: var(--theme-space-4);
}

.lt-offline__title {
  margin: 0;
  font-family: var(--theme-font-display);
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.4;
}

.lt-offline__body {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.6;
  color: var(--theme-text-secondary);
}
</style>
