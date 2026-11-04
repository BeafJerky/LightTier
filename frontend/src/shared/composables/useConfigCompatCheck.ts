/**
 * 配置兼容性检查（启动前 / 服务安装前共用）
 *
 * 读取 TOML → 迁移旧版 LightTier 私有标记并回写 → 按当前内核版本返回兼容性问题。
 * 读取或解析失败时不拦截（返回空列表），避免文件暂时不可读阻断启动。
 */
import * as toml from 'smol-toml'
import { useEasyTierStore } from '@/shared/store/easytier'
import { useMockData } from '@/shared/platform/mockData'
import { CONFIG_PATH } from '@/shared/constants/easytier'
import { checkConfigCompat, type CompatIssue } from '@/entities/kernel/kernelCompatUtil'
import { migrateLightTierConfig } from '@/entities/config/lighttierConfigUtil'

export function useConfigCompatCheck() {
  const easyTierStore = useEasyTierStore()
  const { readFileContent, writeFileContent } = useMockData()

  const getCompatIssues = async (fileName: string): Promise<CompatIssue[]> => {
    try {
      const raw = (await readFileContent(`${CONFIG_PATH}/${fileName}`)) as string
      const cfg = toml.parse(raw) as Record<string, any>
      // 旧版 LightTier 私有标记先迁移并落盘：v2.7.0 会把 flags._enable_exit_route 当作未知键拒绝启动
      if (migrateLightTierConfig(cfg)) {
        try {
          await writeFileContent(`${CONFIG_PATH}/${fileName}`, toml.stringify(cfg))
        } catch {
          /* 回写失败不阻断校验，下次启动/编辑会再次尝试 */
        }
      }
      return checkConfigCompat(cfg, easyTierStore.detectedCoreVersion)
    } catch {
      return []
    }
  }

  return { getCompatIssues }
}
