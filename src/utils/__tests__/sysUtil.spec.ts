/**
 * sysUtil 单测：PS_ADAPTER_FILTER_CLAUSE 网卡排除矩阵（M-02 回归防护）
 *
 * 背景：PowerShell -notlike 大小写不敏感，宽泛的 "et*" 会把默认名为 Ethernet 的物理网卡
 * 一并排除；正确模式是 "et_*"（EasyTier v2.6.4 虚拟网卡名为 et_<序号>_<随机4位>）+ "easytier*"。
 */
import { describe, it, expect } from 'vitest'
import { PS_ADAPTER_FILTER_CLAUSE } from '@/utils/sysUtil'

/** PowerShell -like 语义模拟：大小写不敏感 + `*` 通配 */
const like = (name: string, pattern: string): boolean => {
  const re = new RegExp(
    '^' +
      pattern
        .split('*')
        .map((s) => s.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&'))
        .join('.*') +
      '$',
    'i'
  )
  return re.test(name)
}

/** 与生产子句保持一致的排除判定 */
const isExcluded = (name: string) => like(name, 'et_*') || like(name, 'easytier*')

describe('PS_ADAPTER_FILTER_CLAUSE 网卡排除矩阵（M-02）', () => {
  it('物理网卡不被排除：Ethernet / Wi-Fi / 中文接口名', () => {
    for (const name of [
      'Ethernet',
      'Ethernet 2',
      'Ethernet 3',
      'Wi-Fi',
      'WLAN',
      '以太网',
      '本地连接'
    ]) {
      expect(isExcluded(name), `不应排除 ${name}`).toBe(false)
    }
  })

  it('EasyTier 虚拟网卡被排除：et_<序号>_<随机位> 与 easytier*', () => {
    for (const name of [
      'et_3_a1b2',
      'et_0_zzzz',
      'et_12_ab34',
      'ET_5_X9K2',
      'EasyTier',
      'easytier0'
    ]) {
      expect(isExcluded(name), `应排除 ${name}`).toBe(true)
    }
  })

  it('子句包含双排除模式且不含宽泛的 "et*"（防回归）', () => {
    expect(PS_ADAPTER_FILTER_CLAUSE).toContain('-notlike "et_*"')
    expect(PS_ADAPTER_FILTER_CLAUSE).toContain('-notlike "easytier*"')
    expect(PS_ADAPTER_FILTER_CLAUSE).not.toContain('"et*"')
  })
})
