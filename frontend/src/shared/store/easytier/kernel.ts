/**
 * 内核版本域：探测结果与版本能力。
 * detectedCoreVersion 是表单字段可见性、CLI/服务参数格式等版本适配的唯一依据。
 */
import { computed, ref } from 'vue'
import { parseCoreVersion, resolveCoreCapabilities } from '@/entities/kernel/kernelCompatUtil'

export function createKernelDomain() {
  // 已安装内核版本（规范化 vX.Y.Z）；null 表示未安装或无法识别
  const detectedCoreVersion = ref<string | null>(null)
  // 原始版本输出（如 easytier-cli 2.6.4），用于设置页原样展示
  const coreVersionRaw = ref('')
  const coreVersionDetecting = ref(false)
  const coreCaps = computed(() => resolveCoreCapabilities(detectedCoreVersion.value))

  // 写入探测结果：无法解析时置空（兼容旧版 403 等异常输出）
  const applyCoreVersionRaw = (raw: unknown): string | null => {
    const text = typeof raw === 'string' ? raw.trim() : ''
    coreVersionRaw.value = text
    detectedCoreVersion.value = parseCoreVersion(text)
    return detectedCoreVersion.value
  }

  /**
   * 重新探测已安装内核版本（桌面 easytier-cli -V / Android 编译期版本）。
   * 失败不抛出，返回 null，避免启动流程被内核缺失阻断。
   */
  const detectCoreVersion = async (): Promise<string | null> => {
    if (coreVersionDetecting.value) return detectedCoreVersion.value
    coreVersionDetecting.value = true
    try {
      const { getCoreVersion } = await import('@/shared/platform/coreApi')
      return applyCoreVersionRaw(await getCoreVersion())
    } catch {
      return applyCoreVersionRaw('')
    } finally {
      coreVersionDetecting.value = false
    }
  }

  return {
    detectedCoreVersion,
    coreVersionRaw,
    coreVersionDetecting,
    coreCaps,
    detectCoreVersion
  }
}
