/**
 * configNameUtil 单测：配置名允许中文，拦截路径分隔符、非法文件名字符与系统保留名
 */
import { describe, it, expect } from 'vitest'
import { isValidConfigName } from '@/utils/configNameUtil'

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
})
