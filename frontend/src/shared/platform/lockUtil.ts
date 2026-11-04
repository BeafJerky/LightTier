/**
 * 锁屏密码校验工具（M-06）
 *
 * 存储格式：`sha256$<salt>$<hex>`（盐随机 16 字节、SHA-256(salt + password)），
 * 避免明文落盘（pinia persist 会整体写入 localStorage）。
 * 旧版明细文（无前缀）由 verify 直接比对、migrateLockPassword 升级为哈希；
 * SHA-256 为纯 JS 实现（无 crypto.subtle / 环境依赖，任意 WebView 行为一致），
 * 强度定位为本地防窥屏，不替代系统级磁盘加密。
 */

// SHA-256 轮常量（FIPS 180-4）
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0

/**
 * 计算字符串（UTF-8）的 SHA-256 十六进制摘要（纯 JS 实现）
 * 仅用于锁屏校验场景，输入为短口令，性能无虞
 */
export const sha256Hex = (text: string): string => {
  const bytes = new TextEncoder().encode(text)
  const len = bytes.length
  // 填充：message + 0x80 + 0x00… 使总长 ≡ 56 (mod 64)，末 8 字节存比特长度
  const padded = ((len + 8) >> 6) * 64 + 64
  const buf = new Uint8Array(padded)
  buf.set(bytes)
  buf[len] = 0x80
  const dv = new DataView(buf.buffer)
  dv.setUint32(padded - 8, Math.floor((len * 8) / 0x100000000))
  dv.setUint32(padded - 4, (len * 8) >>> 0)

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ])
  const w = new Uint32Array(64)

  for (let i = 0; i < padded; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + (j << 2))
    for (let j = 16; j < 64; j++) {
      const x = w[j - 15]
      const y = w[j - 2]
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0
    }

    let a = h[0]
    let b = h[1]
    let c = h[2]
    let d = h[3]
    let e = h[4]
    let f = h[5]
    let g = h[6]
    let hh = h[7]

    for (let j = 0; j < 64; j++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[j] + w[j]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

// 随机盐（16 字节 hex）；极端环境无 getRandomValues 时退回 Math.random（防窥屏场景可接受）
const randomSaltHex = (): string => {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const LOCK_PASSWORD_PREFIX = 'sha256$'

/** 判断存储值是否已是加盐哈希校验串 */
export const isLockPasswordHashed = (stored: string): boolean =>
  stored.startsWith(LOCK_PASSWORD_PREFIX)

/** 生成加盐校验串：sha256$<salt>$<SHA-256(salt + password)> */
export const hashLockPassword = (password: string): string => {
  const salt = randomSaltHex()
  return `${LOCK_PASSWORD_PREFIX}${salt}$${sha256Hex(salt + password)}`
}

/**
 * 校验输入密码是否匹配存储值
 * 存储为空 → false；旧版明文（无前缀）→ 直接比对（兼容未迁移的历史值）
 */
export const verifyLockPassword = (password: string, stored: string): boolean => {
  if (!stored) return false
  if (!isLockPasswordHashed(stored)) return password === stored
  const parts = stored.split('$')
  if (parts.length !== 3 || !parts[1] || !parts[2]) return false
  return sha256Hex(parts[1] + password) === parts[2]
}

/** 迁移旧版明文密码为加盐校验串（已是哈希或为空则原样返回） */
export const migrateLockPassword = (stored: string): string => {
  if (!stored || isLockPasswordHashed(stored)) return stored
  return hashLockPassword(stored)
}
