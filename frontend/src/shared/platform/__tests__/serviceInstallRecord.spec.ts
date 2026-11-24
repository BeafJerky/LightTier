import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearServiceInstallMethod,
  isServiceConfigStorageName,
  readServiceInstallMethod,
  saveServiceInstallMethod
} from '@/shared/platform/serviceInstallRecord'

const installStorage = () => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    }
  })
  return store
}

afterEach(() => vi.unstubAllGlobals())

describe('serviceInstallRecord', () => {
  it('按类型写入记录，普通服务写入和清除不影响同名 Web 服务', () => {
    const store = installStorage()
    store.set('service-config:easytierweb-home', '{"installMethod":"nssm"}')

    saveServiceInstallMethod('easytier-home', 'official')

    expect(store.get('service-config:service:easytier-home')).toBe('{"installMethod":"official"}')
    expect(readServiceInstallMethod('easytier-home')).toBe('official')
    expect(readServiceInstallMethod('easytierweb-home')).toBe('nssm')
    clearServiceInstallMethod('easytier-home')
    expect(readServiceInstallMethod('easytier-home')).toBeNull()
    expect(readServiceInstallMethod('easytierweb-home')).toBe('nssm')
  })

  it('普通与 Web 完整旧键按各自归属迁移到类型化键', () => {
    const store = installStorage()
    store.set('service-config:easytier-home', '{"installMethod":"official"}')
    store.set('service-config:easytierweb-home', '{"installMethod":"nssm"}')

    expect(readServiceInstallMethod('easytier-home')).toBe('official')
    expect(readServiceInstallMethod('easytierweb-home')).toBe('nssm')

    expect(store.get('service-config:service:easytier-home')).toBe('{"installMethod":"official"}')
    expect(store.get('service-config:web:easytierweb-home')).toBe('{"installMethod":"nssm"}')
    expect(store.has('service-config:easytier-home')).toBe(false)
    expect(store.has('service-config:easytierweb-home')).toBe(false)
  })

  it('普通服务只迁移真正无歧义的旧配置名记录，Web 服务不读取该旧键', () => {
    const store = installStorage()
    store.set('service-config:home', '{"installMethod":"official"}')

    expect(readServiceInstallMethod('easytier-home')).toBe('official')
    expect(readServiceInstallMethod('easytierweb-home')).toBeNull()

    expect(store.get('service-config:service:easytier-home')).toBe('{"installMethod":"official"}')
    expect(store.has('service-config:home')).toBe(false)
  })

  it('普通配置名本身以 Web 前缀开头时不读取与 Web home 碰撞的旧键', () => {
    const store = installStorage()
    store.set('service-config:easytierweb-home', '{"installMethod":"nssm"}')

    expect(readServiceInstallMethod('easytier-easytierweb-home')).toBeNull()
    expect(readServiceInstallMethod('easytierweb-home')).toBe('nssm')
    expect(store.get('service-config:web:easytierweb-home')).toBe('{"installMethod":"nssm"}')
  })

  it('有歧义的普通旧键在保存和清除普通记录时保持不变', () => {
    const store = installStorage()
    store.set('service-config:easytierweb-home', '{"installMethod":"nssm"}')

    saveServiceInstallMethod('easytier-easytierweb-home', 'official')
    expect(store.get('service-config:easytierweb-home')).toBe('{"installMethod":"nssm"}')
    clearServiceInstallMethod('easytier-easytierweb-home')
    expect(store.get('service-config:easytierweb-home')).toBe('{"installMethod":"nssm"}')
    expect(readServiceInstallMethod('easytierweb-home')).toBe('nssm')
  })

  it('类型化存储名可被备份识别，但仍拒绝非法服务名与损坏记录', () => {
    installStorage()
    expect(isServiceConfigStorageName('service:easytier-home')).toBe(true)
    expect(isServiceConfigStorageName('web:easytierweb-home')).toBe(true)
    expect(isServiceConfigStorageName('service:easytierweb-home')).toBe(false)
    expect(isServiceConfigStorageName('web:../evil')).toBe(false)

    localStorage.setItem('service-config:service:easytier-home', '{broken')
    expect(readServiceInstallMethod('easytier-home')).toBeNull()
    expect(readServiceInstallMethod('../evil')).toBeNull()
    saveServiceInstallMethod('../evil', 'nssm')
    expect(localStorage.length).toBe(1)
  })
})
