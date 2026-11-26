/**
 * 正式包守卫：`frontend/dist` 中不得出现演示配置样例。
 *
 * 演示数据在 `--mode pro` 下由 Vite 静态替换后摇掉；本脚本是第二道闸门，
 * 防止将来把样例直接写进仍会被打包的代码路径。只匹配 ASCII 标记：中文名在
 * 压缩后可能以 `\uXXXX` 形式出现，而样例里的 hostname 一定保持原样。
 *
 * 由根 `build` 脚本调用；命中即退出码 1，构建失败。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../frontend/dist/', import.meta.url))
const MARKERS = [
  'tokyo-relay-01',
  'tokyo-node-01',
  'sgp-relay',
  'sgp-gateway',
  'home-router',
  'office-gw',
  'public-node-1',
  'asia-backbone'
]

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else files.push(path)
  }
}

walk(DIST)

const hits = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const marker of MARKERS) {
    if (text.includes(marker)) hits.push(`${file}: ${marker}`)
  }
}

if (hits.length) {
  console.error('release bundle contains demo fixtures:')
  for (const hit of hits) console.error('  ' + hit)
  process.exit(1)
}
console.log(`release bundle clean (${files.length} files, no demo fixtures)`)