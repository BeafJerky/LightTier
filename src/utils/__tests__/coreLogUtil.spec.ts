import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_LOG_COUNT,
  DEFAULT_LOG_SIZE_MB,
  getKernelLogScope,
  getLogLineLevel,
  isAbsolutePath,
  isActiveKernelLogFile,
  isKernelLogFile,
  normalizeLogLevel,
  parsePositiveInt,
  pickLogTarget,
  resolveLogDir
} from '@/utils/coreLogUtil'

describe('isAbsolutePath（绝对路径判定）', () => {
  it('识别 Windows 盘符（正反斜杠）与 UNC 路径', () => {
    expect(isAbsolutePath('C:\\logs')).toBe(true)
    expect(isAbsolutePath('d:/data/logs')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share\\logs')).toBe(true)
  })

  it('识别 Unix 根路径', () => {
    expect(isAbsolutePath('/var/log')).toBe(true)
  })

  it('相对路径与空值返回 false', () => {
    expect(isAbsolutePath('./log')).toBe(false)
    expect(isAbsolutePath('logs')).toBe(false)
    expect(isAbsolutePath('.')).toBe(false)
    expect(isAbsolutePath('')).toBe(false)
    expect(isAbsolutePath('~/logs')).toBe(false)
  })
})

describe('resolveLogDir（日志目录归一化）', () => {
  it('绝对路径原样保留，且不触发 fallback', async () => {
    const fallback = vi.fn(async () => '/app/logs')
    await expect(resolveLogDir('C:/custom/logs', fallback)).resolves.toBe('C:/custom/logs')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('空/相对/非字符串值回落到应用 logs 目录', async () => {
    const fallback = vi.fn(async () => '/app/logs')
    await expect(resolveLogDir('', fallback)).resolves.toBe('/app/logs')
    await expect(resolveLogDir('./log', fallback)).resolves.toBe('/app/logs')
    await expect(resolveLogDir('.', fallback)).resolves.toBe('/app/logs')
    await expect(resolveLogDir(undefined, fallback)).resolves.toBe('/app/logs')
    await expect(resolveLogDir(123 as unknown, fallback)).resolves.toBe('/app/logs')
    expect(fallback).toHaveBeenCalledTimes(5)
  })

  it('空白字符视为未配置', async () => {
    await expect(resolveLogDir('   ', async () => '/app/logs')).resolves.toBe('/app/logs')
  })
})

describe('parsePositiveInt（正整数解析）', () => {
  it('合法数值/数字字符串直接使用', () => {
    expect(parsePositiveInt(5, DEFAULT_LOG_SIZE_MB)).toBe(5)
    expect(parsePositiveInt('20', DEFAULT_LOG_COUNT)).toBe(20)
  })

  it('非法值回落默认', () => {
    expect(parsePositiveInt(undefined, DEFAULT_LOG_SIZE_MB)).toBe(DEFAULT_LOG_SIZE_MB)
    expect(parsePositiveInt('', DEFAULT_LOG_COUNT)).toBe(DEFAULT_LOG_COUNT)
    expect(parsePositiveInt('abc', DEFAULT_LOG_SIZE_MB)).toBe(DEFAULT_LOG_SIZE_MB)
    expect(parsePositiveInt(0, DEFAULT_LOG_COUNT)).toBe(DEFAULT_LOG_COUNT)
    expect(parsePositiveInt(-3, DEFAULT_LOG_SIZE_MB)).toBe(DEFAULT_LOG_SIZE_MB)
    expect(parsePositiveInt(1.5, DEFAULT_LOG_COUNT)).toBe(DEFAULT_LOG_COUNT)
  })
})

describe('normalizeLogLevel（日志级别校验）', () => {
  it('合法级别（大小写/空白容错）原样归一', () => {
    expect(normalizeLogLevel('info')).toBe('info')
    expect(normalizeLogLevel('Error')).toBe('error')
    expect(normalizeLogLevel('  WARN ')).toBe('warn')
    expect(normalizeLogLevel('off')).toBe('off')
  })

  it('非法/缺失值回落 fallback（避免内核 .unwrap() panic）', () => {
    expect(normalizeLogLevel('verbose')).toBe('info')
    expect(normalizeLogLevel('warning')).toBe('info')
    expect(normalizeLogLevel(undefined)).toBe('info')
    expect(normalizeLogLevel(3 as unknown)).toBe('info')
    expect(normalizeLogLevel('', 'error')).toBe('error')
  })
})

describe('pickLogTarget（日志读取目标选择）', () => {
  it('当前内核正在写入的 easytier.log 优先于旧版按配置名日志', () => {
    expect(pickLogTarget(['easytier.log', 'server.log', 'server.log.1'], 'server')).toBe(
      'easytier.log'
    )
  })

  it('没有当前文件时回退旧版 {configName}.log', () => {
    expect(pickLogTarget(['server.log', 'server.log.1'], 'server')).toBe('server.log')
    // 调用方传入的配置名可能带 .toml，需按基名匹配旧版日志
    expect(pickLogTarget(['server.log', 'server.log.1'], 'server.toml')).toBe('server.log')
  })

  it('仅历史分段时取编号最小（.1 最新，.9 比 .10 新）', () => {
    expect(pickLogTarget(['easytier.log.1', 'easytier.log.2'], 'server')).toBe('easytier.log.1')
    expect(pickLogTarget(['easytier.log.9', 'easytier.log.10'], 'server')).toBe('easytier.log.9')
    expect(pickLogTarget(['server.log.2', 'server.log.10'], 'server')).toBe('server.log.2')
  })

  it('日期后缀分段取日期最大', () => {
    expect(pickLogTarget(['server.2026-10-19.log', 'server.2026-10-20.log'], 'server')).toBe(
      'server.2026-10-20.log'
    )
    expect(pickLogTarget(['easytier.log.2026-10-19', 'easytier.log.2026-10-20'], 'server')).toBe(
      'easytier.log.2026-10-20'
    )
  })

  it('目录为空时兜底 easytier.log', () => {
    expect(pickLogTarget([], 'server')).toBe('easytier.log')
    expect(pickLogTarget(['resource', 'other.txt'], 'server')).toBe('easytier.log')
  })
})

describe('isKernelLogFile（清理目标匹配）', () => {
  it('匹配当前与轮转日志文件', () => {
    expect(isKernelLogFile('easytier.log', 'easytier')).toBe(true)
    expect(isKernelLogFile('easytier.log', 'server')).toBe(true)
    expect(isKernelLogFile('easytier.log.3', 'server')).toBe(true)
    expect(isKernelLogFile('server.log', 'server')).toBe(true)
    expect(isKernelLogFile('server.log.2', 'server')).toBe(true)
  })

  it('匹配旧版裸文件名与日期后缀文件', () => {
    expect(isKernelLogFile('server', 'server')).toBe(true)
    expect(isKernelLogFile('server.2026-10-20', 'server')).toBe(true)
    expect(isKernelLogFile('server.2026-10-20.log', 'server')).toBe(true)
    expect(isKernelLogFile('server.log.2026-10-20', 'server')).toBe(true)
  })

  it('不匹配无关文件（不再宽匹配 {configName}.*）', () => {
    expect(isKernelLogFile('lighttier.log', 'server')).toBe(false)
    expect(isKernelLogFile('server.toml', 'server')).toBe(false)
    expect(isKernelLogFile('server-config.toml', 'server')).toBe(false)
    expect(isKernelLogFile('easytier.logx', 'server')).toBe(false)
    expect(isKernelLogFile('server.toml', 'server.toml')).toBe(false)
    expect(isKernelLogFile('resource', 'server')).toBe(false)
  })
})

describe('isActiveKernelLogFile（清理时保留写入中的文件）', () => {
  it('当前共享文件与旧版配置当前文件视为活跃', () => {
    expect(isActiveKernelLogFile('easytier.log', 'server')).toBe(true)
    expect(isActiveKernelLogFile('server.log', 'server')).toBe(true)
    expect(isActiveKernelLogFile('server', 'server')).toBe(true)
  })

  it('轮转与日期分段不是活跃文件', () => {
    expect(isActiveKernelLogFile('easytier.log.1', 'server')).toBe(false)
    expect(isActiveKernelLogFile('server.log.2', 'server')).toBe(false)
    expect(isActiveKernelLogFile('server.2026-10-20.log', 'server')).toBe(false)
  })
})

describe('getKernelLogScope（按配置隔离目录名）', () => {
  it('去掉 .toml 并清理路径非法字符', () => {
    expect(getKernelLogScope('server.toml')).toBe('server')
    expect(getKernelLogScope('Alice Home.toml')).toBe('Alice_Home')
    expect(getKernelLogScope('a/b:c*.toml')).toBe('a_b_c_')
  })

  it('空名回退 default', () => {
    expect(getKernelLogScope('')).toBe('default')
    expect(getKernelLogScope('.toml')).toBe('default')
  })
})

describe('getLogLineLevel（行首级别识别）', () => {
  it('识别标准时间戳格式的 error/warn/fatal', () => {
    expect(getLogLineLevel('2026-10-21 12:00:00 ERROR [core]: boom')).toBe('error')
    expect(getLogLineLevel('2026-10-21 12:00:00.123 WARN  [core]: slow')).toBe('warn')
    expect(getLogLineLevel('2026-10-21T12:00:00 FATAL [core]: dead')).toBe('error')
  })

  it('识别 EasyTier RFC3339 时区后缀（+08:00 / Z）', () => {
    expect(getLogLineLevel('2026-10-21T12:00:00.123456789+08:00  INFO core: up')).toBe('')
    expect(getLogLineLevel('2026-10-21T12:00:00.123456789+08:00 ERROR core: down')).toBe('error')
    expect(getLogLineLevel('2026-10-21T04:00:00.123Z  WARN core: slow')).toBe('warn')
  })

  it('识别方括号级别与大小写', () => {
    expect(getLogLineLevel('[ERROR] failed')).toBe('error')
    expect(getLogLineLevel('[warn] slow')).toBe('warn')
  })

  it('正文中出现 error/warn 不误判', () => {
    expect(getLogLineLevel('2026-10-21 12:00:00 INFO  [core]: error rate is 0')).toBe('')
    expect(getLogLineLevel('2026-10-21 12:00:00 DEBUG [core]: warning text')).toBe('')
    expect(getLogLineLevel('received ERROR from peer')).toBe('')
  })
})
