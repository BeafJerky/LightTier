import type { InjectionKey } from 'vue'
import type { ConfigEditorApi } from '@/features/configs/composables/useConfigEditor'

export const CONFIG_EDITOR_KEY: InjectionKey<ConfigEditorApi> = Symbol('config-editor')
