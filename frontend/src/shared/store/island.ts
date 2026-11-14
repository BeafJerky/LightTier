import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { t } from '@/shared/i18n/t'
import { diffRunningNames, ExpectedStops } from '@/shared/lib/island/health'
import { classifyQuality, QualityEpisode, type QualitySample } from '@/shared/lib/island/quality'
import {
  createNotice,
  dismissNotice,
  dismissNoticeBySource,
  enqueueNotice,
  pruneNotices
} from '@/shared/lib/island/queue'
import {
  createDefaultIslandSettings,
  normalizeIslandSettings,
  type IslandIdleMode,
  type IslandMotionPreference,
  type IslandSettings
} from '@/shared/lib/island/settings'
import type {
  IslandNoticeInput,
  IslandNoticeType,
  IslandQueueState
} from '@/shared/lib/island/types'

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000

export const useIslandStore = defineStore(
  'island',
  () => {
    const settings = ref<IslandSettings>(createDefaultIslandSettings())
    const queueState = ref<IslandQueueState>({ current: null, queue: [] })
    const expanded = ref(false)
    const baselineReady = ref(false)
    const latestManagerVersion = ref('')
    const lastUpdateCheckAt = ref(0)
    const updateChecking = ref(false)

    let baseline = new Set<string>()
    const expectedStops = new ExpectedStops()
    const qualityEpisodes = new Map<string, QualityEpisode>()

    const current = computed(() => queueState.value.current)
    const queueLength = computed(() => queueState.value.queue.length)
    const pendingCount = computed(() => (current.value ? 1 : 0) + queueLength.value)

    const hasError = computed(
      () =>
        current.value?.type === 'error' ||
        queueState.value.queue.some((notice) => notice.type === 'error')
    )

    const hasAttention = computed(
      () =>
        hasError.value ||
        queueState.value.queue.some(
          (notice) => notice.type === 'update' || notice.type === 'quality'
        ) ||
        current.value?.type === 'update' ||
        current.value?.type === 'quality'
    )

    const badgeType = computed<IslandNoticeType | null>(() => {
      if (hasError.value) return 'error'
      if (
        current.value?.type === 'update' ||
        queueState.value.queue.some((notice) => notice.type === 'update')
      ) {
        return 'update'
      }
      if (
        current.value?.type === 'quality' ||
        queueState.value.queue.some((notice) => notice.type === 'quality')
      ) {
        return 'quality'
      }
      return pendingCount.value > 0 ? 'feedback' : null
    })

    function notify(input: IslandNoticeInput): boolean {
      if (!settings.value.enabled) return false
      if (!settings.value.types[input.type]) return false
      queueState.value = enqueueNotice(queueState.value, createNotice(input))
      return true
    }

    function dismiss(id?: string): void {
      queueState.value = dismissNotice(queueState.value, id)
      if (!queueState.value.current) expanded.value = false
    }

    function dismissSource(sourceKey: string): void {
      queueState.value = dismissNoticeBySource(queueState.value, sourceKey)
      if (!queueState.value.current) expanded.value = false
    }

    function setExpanded(value: boolean): void {
      expanded.value = value
    }

    function markBaseline(names: string[]): void {
      baseline = new Set(names)
      baselineReady.value = true
    }

    function applyRunningNames(names: string[]): void {
      if (!baselineReady.value) {
        markBaseline(names)
        return
      }
      const diff = diffRunningNames(baseline, names)
      baseline = new Set(names)

      for (const name of diff.started) qualityEpisodes.delete(name)

      for (const name of diff.stopped) {
        const expected = expectedStops.consume(name)
        qualityEpisodes.delete(name)
        if (expected) continue
        notify({
          type: 'error',
          title: t('newIsland.instanceStopped', { name }),
          detail: t('newIsland.instanceStoppedDesc'),
          sourceKey: `health:down:${name}`,
          action: { kind: 'open-monitor', configFileName: name }
        })
      }

      for (const name of diff.started) {
        dismissSource(`health:down:${name}`)
      }
    }

    function expectStop(name: string): void {
      expectedStops.expect(name)
    }

    function reportQuality(name: string, sample: QualitySample): void {
      let episode = qualityEpisodes.get(name)
      if (!episode) {
        episode = new QualityEpisode()
        qualityEpisodes.set(name, episode)
      }
      const event = episode.push(classifyQuality(sample))
      if (event === 'enter') {
        notify({
          type: 'quality',
          title: t('newIsland.qualityPoor', { name }),
          detail: t('newIsland.qualityPoorDesc'),
          sourceKey: `quality:${name}`,
          action: { kind: 'open-monitor', configFileName: name }
        })
      } else if (event === 'recover') {
        dismissSource(`quality:${name}`)
      }
    }

    function forgetQuality(name: string): void {
      qualityEpisodes.delete(name)
    }

    function absorbManagerRelease(version: string): void {
      latestManagerVersion.value = version
      lastUpdateCheckAt.value = Date.now()
    }

    function invalidateManagerUpdate(): void {
      latestManagerVersion.value = ''
      lastUpdateCheckAt.value = 0
    }

    function shouldCheckManagerUpdate(now = Date.now()): boolean {
      if (updateChecking.value) return false
      return now - lastUpdateCheckAt.value >= UPDATE_CHECK_INTERVAL_MS
    }

    function setUpdateChecking(value: boolean): void {
      updateChecking.value = value
    }

    function setEnabled(value: boolean): void {
      settings.value = { ...settings.value, enabled: value }
      if (!value) {
        queueState.value = { current: null, queue: [] }
        expanded.value = false
      }
    }

    function setIdle(value: IslandIdleMode): void {
      settings.value = { ...settings.value, idle: value }
    }

    function setTypeEnabled(type: IslandNoticeType, value: boolean): void {
      settings.value = {
        ...settings.value,
        types: { ...settings.value.types, [type]: value }
      }
      queueState.value = pruneNotices(queueState.value, settings.value.types)
      if (!queueState.value.current) expanded.value = false
    }

    function setSilent(value: boolean): void {
      settings.value = { ...settings.value, silent: value }
    }

    function setMotion(value: IslandMotionPreference): void {
      settings.value = { ...settings.value, motion: value }
    }

    function setFace(value: boolean): void {
      settings.value = { ...settings.value, face: value }
    }

    function resetSettings(): void {
      settings.value = createDefaultIslandSettings()
    }

    return {
      settings,
      queueState,
      expanded,
      baselineReady,
      latestManagerVersion,
      lastUpdateCheckAt,
      updateChecking,
      current,
      queueLength,
      pendingCount,
      hasError,
      hasAttention,
      badgeType,
      notify,
      dismiss,
      dismissSource,
      setExpanded,
      markBaseline,
      applyRunningNames,
      expectStop,
      reportQuality,
      forgetQuality,
      absorbManagerRelease,
      invalidateManagerUpdate,
      shouldCheckManagerUpdate,
      setUpdateChecking,
      setEnabled,
      setIdle,
      setTypeEnabled,
      setSilent,
      setMotion,
      setFace,
      resetSettings
    }
  },
  {
    persist: {
      key: 'lighttier.island',
      storage: localStorage,
      omit: ['queueState', 'expanded', 'baselineReady', 'updateChecking'],
      afterHydrate: (ctx) => {
        const store = ctx.store as unknown as { settings: IslandSettings }
        store.settings = normalizeIslandSettings(store.settings)
      }
    }
  }
)
