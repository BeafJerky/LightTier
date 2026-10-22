<template>
  <div class="ssv-page">
    <section v-for="group in groups" :key="group.key" class="ssv-group-wrap">
      <div v-if="group.label" class="ssv-group-label">{{ group.label }}</div>
      <div class="ssv-group">
        <button
          v-for="row in group.rows"
          :key="row.key"
          type="button"
          class="ssv-row"
          @click="handleRow(row)"
        >
          <span class="ssv-icon">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="row.icon" />
            </svg>
          </span>
          <span class="ssv-text">
            <span class="ssv-title">{{ row.title }}</span>
            <span class="ssv-desc">{{ row.desc }}</span>
          </span>
          <svg
            class="ssv-chev"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>
    </section>

    <!-- 语言切换：短操作走底部面板 -->
    <CreamDialog v-model="langSheetVisible" :title="t('newSettings.language')" width="380px">
      <div class="ssv-lang-list" role="radiogroup" :aria-label="t('newSettings.language')">
        <button
          v-for="item in langMap"
          :key="item.lang"
          type="button"
          class="ssv-lang-option"
          :class="{ active: currentLang === item.lang }"
          role="radio"
          :aria-checked="currentLang === item.lang"
          @click="switchLang(item.lang)"
        >
          <span>{{ item.name }}</span>
          <svg
            v-if="currentLang === item.lang"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </button>
      </div>
    </CreamDialog>
  </div>
</template>

<script setup lang="ts">
/** settings-view — Android 设置首页：分组列表，点击进入全屏分类子页 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import CreamDialog from '@/components/CreamDialog/index.vue'
import { useEasyTierStore } from '@/store/modules/easytier'
import { useLocaleStore } from '@/store/modules/locale'
import { useLocale } from '@/hooks/web/useLocale'
import { useThemeLoader } from '@/hooks/useThemeLoader'
import { getAppVersion } from '@/utils/sysUtil'

defineOptions({ name: 'NewSettingsView' })

const ICONS = {
  core: 'M3 5h18v6H3zM3 13h18v6H3zM7 7.5h.01M7 15.5h.01',
  theme:
    'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  general: 'M4 6h16M4 12h10M4 18h7',
  data: 'M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M5 6c0-1 3-2 7-2s7 1 7 2-3 2-7 2-7-1-7-2zM9 12h6M9 16h6',
  security: 'M5 11h14v10H5zM8 11V8a4 4 0 118 0v3',
  language: 'M4 5h9M8 3v2M6 5c0 4 3 7 7 8M11 5c0 4-3 7-7 8M14 21l4-9 4 9M16 17h4',
  about: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8h.01'
} as const

type RowKey = keyof typeof ICONS

interface SettingsRow {
  key: RowKey | 'language'
  title: string
  desc: string
  icon: string
}

const router = useRouter()
const { t } = useI18n()
const store = useEasyTierStore()
const localeStore = useLocaleStore()
const { currentTheme } = useThemeLoader()

const appVersion = ref('...')
const langSheetVisible = ref(false)

const langMap = computed(() => localeStore.getLocaleMap)
const currentLang = computed(() => localeStore.getCurrentLocale.lang)
const currentLangName = computed(
  () => langMap.value.find((l) => l.lang === currentLang.value)?.name || '中文'
)

const themeLabel = computed(() => {
  const name = currentTheme.value
  if (name === 'cream') return t('newTheme.cream')
  if (name === 'dark') return t('newTheme.dark')
  return name
})

const groups = computed(() => {
  const coreDesc = store.coreVersionDetecting
    ? t('newCommon.checking')
    : store.detectedCoreVersion
      ? `EasyTier ${store.detectedCoreVersion}`
      : t('newSettings.notInstalled')

  const rows: Record<RowKey | 'language', SettingsRow> = {
    core: { key: 'core', title: t('newSettings.coreMgmt'), desc: coreDesc, icon: ICONS.core },
    theme: { key: 'theme', title: t('newLayout.theme'), desc: themeLabel.value, icon: ICONS.theme },
    general: {
      key: 'general',
      title: t('newSettings.general'),
      desc: t('newSettings.generalDesc'),
      icon: ICONS.general
    },
    data: {
      key: 'data',
      title: t('newSettings.dataMgmt'),
      desc: t('newSettings.dataDesc'),
      icon: ICONS.data
    },
    security: {
      key: 'security',
      title: t('newSettings.security'),
      desc: store.lockPassword
        ? t('newSettings.lockPasswordEnabled')
        : t('newSettings.lockPasswordDisabled'),
      icon: ICONS.security
    },
    language: {
      key: 'language',
      title: t('newSettings.language'),
      desc: currentLangName.value,
      icon: ICONS.language
    },
    about: {
      key: 'about',
      title: t('newSettings.about'),
      desc: `LightTier v${appVersion.value}`,
      icon: ICONS.about
    }
  }

  return [
    { key: 'primary', label: '', rows: [rows.core, rows.theme] },
    {
      key: 'runtime',
      label: t('newSettings.groupRuntime'),
      rows: [rows.general, rows.data, rows.security]
    },
    { key: 'app', label: t('newSettings.groupApp'), rows: [rows.language, rows.about] }
  ]
})

const handleRow = (row: SettingsRow) => {
  if (row.key === 'language') {
    langSheetVisible.value = true
    return
  }
  router.push(`/new/settings/${row.key}`)
}

const switchLang = (lang: LocaleType) => {
  if (lang === currentLang.value) {
    langSheetVisible.value = false
    return
  }
  localeStore.setCurrentLocale({ lang })
  const { changeLocale } = useLocale()
  changeLocale(lang)
  // 整页刷新，确保所有已缓存文案完整切换
  window.location.reload()
}

onMounted(async () => {
  if (!store.detectedCoreVersion) store.detectCoreVersion().catch(() => {})
  try {
    appVersion.value = await getAppVersion()
  } catch {
    // 浏览器 Mock 无 Tauri 版本 API，明确显示未知而不是一直占位闪烁
    appVersion.value = t('newSettings.unknown')
  }
})
</script>

<style scoped>
.ssv-page {
  display: flex;
  padding-bottom: var(--theme-space-2);
  flex-direction: column;
  gap: var(--theme-space-4);
  font-family: var(--theme-font-body);
}

.ssv-group-wrap {
  display: flex;
  flex-direction: column;
  gap: var(--theme-space-2);
}

.ssv-group-label {
  padding: 0 var(--theme-space-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1.4px;
  color: var(--theme-text-muted);
  text-transform: uppercase;
}

.ssv-group {
  overflow: hidden;
  background: var(--theme-bg-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-radius-lg, 14px);
}

.ssv-row {
  display: flex;
  width: 100%;
  min-height: 58px;
  padding: 12px 14px;
  font-family: var(--theme-font-body);
  color: var(--theme-text-primary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  transition: background-color var(--theme-duration-fast) var(--theme-ease-out);
  align-items: center;
  gap: 12px;
}

.ssv-row + .ssv-row {
  border-top: 1px solid var(--theme-border-light);
}

.ssv-row:active {
  background: var(--theme-bg-hover);
}

.ssv-icon {
  display: flex;
  width: 32px;
  height: 32px;
  color: var(--theme-accent-primary);
  background: color-mix(in srgb, var(--theme-accent-primary) 12%, transparent);
  border-radius: 10px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
}

.ssv-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.ssv-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--theme-text-primary);
}

.ssv-desc {
  overflow: hidden;
  font-size: 11px;
  color: var(--theme-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ssv-chev {
  color: var(--theme-text-muted);
  opacity: 0.55;
  flex-shrink: 0;
}

.ssv-lang-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ssv-lang-option {
  display: flex;
  width: 100%;
  min-height: 48px;
  padding: 0 var(--theme-space-4);
  font-family: var(--theme-font-body);
  font-size: 14px;
  font-weight: 500;
  color: var(--theme-text-secondary);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--theme-radius-md);
  transition: var(--theme-transition-interactive);
  align-items: center;
  justify-content: space-between;
}

.ssv-lang-option:active {
  background: var(--theme-bg-hover);
}

.ssv-lang-option.active {
  color: var(--theme-accent-primary);
  background: var(--theme-bg-active);
}
</style>
