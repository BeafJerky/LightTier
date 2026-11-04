/**
 * 设置弹窗上下文：父组件实例化各分类 composable 后 provide，
 * 分类子组件 inject 复用同一份状态（关闭弹窗清理、跨分类共享的加速源等依赖单实例）。
 */
import type { InjectionKey } from 'vue'
import type { useSettingsPreferences } from '../../composables/useSettingsPreferences'
import type { useSettingsKernel } from '../../composables/useSettingsKernel'
import type { useSettingsUpdate } from '../../composables/useSettingsUpdate'
import type { useSettingsData } from '../../composables/useSettingsData'
import type { useSettingsSecurity } from '../../composables/useSettingsSecurity'
import type { SettingsEnv } from '../../composables/settingsTypes'

export type SettingsPreferencesApi = ReturnType<typeof useSettingsPreferences>
export type SettingsKernelApi = ReturnType<typeof useSettingsKernel>
export type SettingsUpdateApi = ReturnType<typeof useSettingsUpdate>
export type SettingsDataApi = ReturnType<typeof useSettingsData>
export type SettingsSecurityApi = ReturnType<typeof useSettingsSecurity>

export const SETTINGS_ENV_KEY: InjectionKey<SettingsEnv> = Symbol('settings-env')
export const SETTINGS_PREFERENCES_KEY: InjectionKey<SettingsPreferencesApi> =
  Symbol('settings-preferences')
export const SETTINGS_KERNEL_KEY: InjectionKey<SettingsKernelApi> = Symbol('settings-kernel')
export const SETTINGS_UPDATE_KEY: InjectionKey<SettingsUpdateApi> = Symbol('settings-update')
export const SETTINGS_DATA_KEY: InjectionKey<SettingsDataApi> = Symbol('settings-data')
export const SETTINGS_SECURITY_KEY: InjectionKey<SettingsSecurityApi> = Symbol('settings-security')
