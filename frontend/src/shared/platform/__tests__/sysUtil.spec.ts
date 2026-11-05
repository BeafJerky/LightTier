/**
 * sysUtil 单测
 *
 * 1) PS_ADAPTER_FILTER_CLAUSE 网卡排除矩阵（M-02 回归防护）
 *    背景：PowerShell -notlike 大小写不敏感，宽泛的 "et*" 会把默认名为 Ethernet 的物理网卡
 *    一并排除；正确模式是 "et_*"（EasyTier v2.6.4 虚拟网卡名为 et_<序号>_<随机4位>）+ "easytier*"。
 * 2) compareVersions 版本比较：同日多次构建必须能判出新旧（关于页“检查更新”误报已是最新的回归防护）。
 */
import { describe, it, expect } from 'vitest'
import { PS_ADAPTER_FILTER_CLAUSE, compareVersions } from '@/shared/platform/sysUtil'

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

describe('compareVersions 版本比较', () => {
  it('正式版按数字段比较，忽略 v 前缀', () => {
    expect(compareVersions('v2.0.2', '2.0.1')).toBe(1)
    expect(compareVersions('2.0.2', 'v2.0.2')).toBe(0)
    expect(compareVersions('2.0.2', '2.0.10')).toBe(-1)
    expect(compareVersions('2.1.0', '2.0.99')).toBe(1)
  })

  it('正式版大于同版本预发布，预发布小于正式版', () => {
    expect(compareVersions('2.0.3', '2.0.3-nightly.20261105')).toBe(1)
    expect(compareVersions('2.0.3-nightly.20261105', '2.0.3')).toBe(-1)
    expect(compareVersions('2.0.3-nightly.20261105', '2.0.4-nightly.20261105')).toBe(-1)
  })

  it('同日构建序号按数值比较（.10 > .2，基础版 < 带序号版）', () => {
    expect(compareVersions('2.0.3-nightly.20261105.2', '2.0.3-nightly.20261105')).toBe(1)
    expect(compareVersions('2.0.3-nightly.20261105', '2.0.3-nightly.20261105.2')).toBe(-1)
    expect(compareVersions('2.0.3-nightly.20261105.10', '2.0.3-nightly.20261105.2')).toBe(1)
    expect(compareVersions('2.0.3-nightly.20261105.2', '2.0.3-nightly.20261105.2')).toBe(0)
  })

  it('不同日期按日期比较', () => {
    expect(compareVersions('2.0.3-nightly.20261106', '2.0.3-nightly.20261105.9')).toBe(1)
    expect(compareVersions('2.0.3-nightly.20261105.9', '2.0.3-nightly.20261106')).toBe(-1)
  })

  it('第二个连字符后只是发布标签装饰，不参与比较（防重复更新循环）', () => {
    expect(compareVersions('v2.0.3-nightly.20261105-2', '2.0.3-nightly.20261105')).toBe(0)
    expect(compareVersions('v2.0.3-nightly.20261105-2', '2.0.3-nightly.20261105.2')).toBe(-1)
  })

  it('字母段按字典序，纯数字段优先级低于字母段（semver）', () => {
    expect(compareVersions('2.0.3-beta', '2.0.3-alpha')).toBe(1)
    expect(compareVersions('2.0.3-nightly.1', '2.0.3-rc.1')).toBe(-1)
  })
})
