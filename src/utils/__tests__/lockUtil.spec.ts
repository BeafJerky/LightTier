import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  hashLockPassword,
  isLockPasswordHashed,
  migrateLockPassword,
  sha256Hex,
  verifyLockPassword
} from '@/utils/lockUtil'

const nodeSha256Hex = (text: string) => createHash('sha256').update(text, 'utf-8').digest('hex')

describe('sha256Hex（纯 JS 实现与 Node crypto 交叉验证）', () => {
  it('标准测试向量', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(sha256Hex('hello world')).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    )
  })

  it('覆盖分组边界与 UTF-8 输入，与 Node crypto 完全一致', () => {
    // 55/56/64 是 SHA-256 填充的关键边界（跨分组）
    for (let len = 0; len <= 130; len++) {
      const s = 'a'.repeat(len)
      expect(sha256Hex(s)).toBe(nodeSha256Hex(s))
    }
    for (const s of ['中文口令测试', 'p@ssw0rd!\u0000mix', '👍emoji🔒', 'x'.repeat(1000)]) {
      expect(sha256Hex(s)).toBe(nodeSha256Hex(s))
    }
  })
})

describe('锁屏密码哈希与校验', () => {
  it('hashLockPassword 生成 sha256$salt$hash 格式且每次盐不同', () => {
    const h1 = hashLockPassword('secret')
    const h2 = hashLockPassword('secret')
    expect(isLockPasswordHashed(h1)).toBe(true)
    expect(h1.split('$').length).toBe(3)
    expect(h1).not.toBe(h2) // 盐随机
    expect(h1).not.toContain('secret') // 不泄漏明文
  })

  it('verifyLockPassword 对哈希值正确匹配/拒绝', () => {
    const stored = hashLockPassword('my-password')
    expect(verifyLockPassword('my-password', stored)).toBe(true)
    expect(verifyLockPassword('my-password ', stored)).toBe(false)
    expect(verifyLockPassword('', stored)).toBe(false)
  })

  it('兼容旧版明文存储（未迁移时仍可解锁）', () => {
    expect(verifyLockPassword('legacy123', 'legacy123')).toBe(true)
    expect(verifyLockPassword('wrong', 'legacy123')).toBe(false)
  })

  it('空存储一律拒绝', () => {
    expect(verifyLockPassword('', '')).toBe(false)
    expect(verifyLockPassword('anything', '')).toBe(false)
  })

  it('损坏的哈希串拒绝而非抛错', () => {
    expect(verifyLockPassword('x', 'sha256$salt-only')).toBe(false)
    expect(verifyLockPassword('x', 'sha256$$')).toBe(false)
    expect(verifyLockPassword('x', 'sha256$salt$')).toBe(false)
  })

  it('migrateLockPassword：明文升级为哈希，哈希与空值原样保留', () => {
    const migrated = migrateLockPassword('plain123')
    expect(isLockPasswordHashed(migrated)).toBe(true)
    expect(verifyLockPassword('plain123', migrated)).toBe(true)
    expect(verifyLockPassword('other', migrated)).toBe(false)

    const already = hashLockPassword('abc')
    expect(migrateLockPassword(already)).toBe(already)
    expect(migrateLockPassword('')).toBe('')
  })
})
