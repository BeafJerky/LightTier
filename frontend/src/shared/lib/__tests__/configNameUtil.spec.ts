/**
 * configNameUtil 单测：配置名允许中文，拦截路径分隔符、非法文件名字符与系统保留名
 */
import { describe, it, expect } from 'vitest'
import { isConfigNameTaken, isValidConfigName } from '@/shared/lib/configNameUtil'

describe('configNameUtil', () => {
  it('允许中文、字母、数字及空格 . _ -', () => {
    expect(isValidConfigName('家庭局域网')).toBe(true)
    expect(isValidConfigName('办公室 组网_2')).toBe(true)
    expect(isValidConfigName('测试节点.v1-beta')).toBe(true)
    expect(isValidConfigName('  Tokyo-1  ')).toBe(true) // 首尾空白被忽略
  })

  it('拒绝空名称与非法起始字符', () => {
    expect(isValidConfigName('')).toBe(false)
    expect(isValidConfigName('   ')).toBe(false)
    expect(isValidConfigName('.hidden')).toBe(false)
    expect(isValidConfigName('-leading')).toBe(false)
    expect(isValidConfigName('_leading')).toBe(false)
    expect(isValidConfigName('节点/子目录')).toBe(false)
    expect(isValidConfigName('节点\\子目录')).toBe(false)
  })

  it('拒绝 Windows 非法文件名字符与控制字符', () => {
    for (const ch of [':', '*', '?', '"', '<', '>', '|']) {
      expect(isValidConfigName(`节点${ch}名称`)).toBe(false)
    }
    expect(isValidConfigName('节点\u0000名称')).toBe(false)
  })

  it('拒绝 Windows 系统保留名（带扩展名同样保留）', () => {
    expect(isValidConfigName('CON')).toBe(false)
    expect(isValidConfigName('con.toml')).toBe(false)
    expect(isValidConfigName('COM1')).toBe(false)
    expect(isValidConfigName('LPT9.backup')).toBe(false)
    expect(isValidConfigName('console')).toBe(true)
    expect(isValidConfigName('COM10')).toBe(true)
  })

  it('超过 64 个字符的名称被拒绝（与后端 id 规则对齐）', () => {
    expect(isValidConfigName('a'.repeat(64))).toBe(true)
    expect(isValidConfigName('a'.repeat(65))).toBe(false)
    // 按字符数而非字节数计算：64 个汉字仍是 192 字节但合法
    expect(isValidConfigName('家'.repeat(64))).toBe(true)
    expect(isValidConfigName('家'.repeat(65))).toBe(false)
  })
})

describe('isConfigNameTaken', () => {
  const existing = ['Home', '办公室', 'node_2']

  it('默认精确比较（大小写敏感文件系统）', () => {
    expect(isConfigNameTaken('Home', existing)).toBe(true)
    expect(isConfigNameTaken('  Home  ', existing)).toBe(true)
    expect(isConfigNameTaken('home', existing)).toBe(false)
  })

  it('大小写不敏感时拦截仅大小写不同的重名（Windows）', () => {
    expect(isConfigNameTaken('home', existing, true)).toBe(true)
    expect(isConfigNameTaken('HOME', existing, true)).toBe(true)
    expect(isConfigNameTaken('Node_2', existing, true)).toBe(true)
    expect(isConfigNameTaken('other', existing, true)).toBe(false)
  })

  it('现有名称为空或未提供时不报重名', () => {
    expect(isConfigNameTaken('home', [])).toBe(false)
    expect(isConfigNameTaken('home', undefined)).toBe(false)
    expect(isConfigNameTaken('home', undefined, true)).toBe(false)
  })
})
