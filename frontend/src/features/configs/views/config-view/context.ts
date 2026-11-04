import type { InjectionKey } from 'vue'
import type { ConfigListApi } from '@/features/configs/composables/useConfigList'

/** 配置页共享状态（index.vue 提供，ConfigList / ConfigDetail 注入） */
export const CONFIG_LIST_KEY: InjectionKey<ConfigListApi> = Symbol('config-list')
