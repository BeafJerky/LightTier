import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOG_COUNT,
  DEFAULT_LOG_SIZE_MB,
  formatLogLineTime,
  getKernelLogScope,
  getLogLineLevel,
  isActiveKernelLogFile,
  isKernelLogFile,
  normalizeLogLevel,
  parsePositiveInt,
  pickLogTarget
} from '@/utils/coreLogUtil'

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
  it('未改动名称原样使用，去掉 .toml', () => {
    expect(getKernelLogScope('server.toml')).toBe('server')
    expect(getKernelLogScope('盐城立体库.toml')).toBe('盐城立体库')
    expect(getKernelLogScope('a_b')).toBe('a_b')
  })

  it('清理路径非法字符，改变名称时追加稳定后缀', () => {
    expect(getKernelLogScope('a/b:c*.toml')).toMatch(/^a_b_c_~[a-z0-9]+$/)
    expect(getKernelLogScope('Alice Home.toml')).toMatch(/^Alice_Home~[a-z0-9]+$/)
    // 同一次输入必须稳定（启动写日志与读取日志共用）
    expect(getKernelLogScope('Alice Home.toml')).toBe(getKernelLogScope('Alice Home'))
  })

  it('仅靠空格/下划线区分的配置不共用日志目录（F-07 衍生回归）', () => {
    expect(getKernelLogScope('a b.toml')).not.toBe(getKernelLogScope('a_b.toml'))
    expect(getKernelLogScope('办公室 组网_2')).not.toBe(getKernelLogScope('办公室_组网_2'))
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

describe('formatLogLineTime（日志时间转本地时区）', () => {
  const timestampOf = (formatted: string) =>
    new Date(`${formatted.slice(0, 10)}T${formatted.slice(11, 23)}`).getTime()

  it('UTC 时间戳转为本地时间并保留毫秒与正文', () => {
    const out = formatLogLineTime('2026-10-26T06:49:57.778Z  INFO core: up')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.778 {2}INFO core: up$/)
    expect(timestampOf(out)).toBe(Date.parse('2026-10-26T06:49:57.778Z'))
  })

  it('带 +08:00 偏移的时间戳同样换算到本地时区', () => {
    const out = formatLogLineTime('2026-10-26T14:49:57.778+08:00 WARN core: slow')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.778 WARN core: slow$/)
    expect(timestampOf(out)).toBe(Date.parse('2026-10-26T06:49:57.778Z'))
    expect(getLogLineLevel(out)).toBe('warn')
  })

  it('无时区标记、非时间戳与 TOML 续行保持原样', () => {
    const localLine = '2026-10-26 14:49:57 INFO local time'
    expect(formatLogLineTime(localLine)).toBe(localLine)
    expect(formatLogLineTime('############### TOML ###############')).toBe(
      '############### TOML ###############'
    )
    expect(formatLogLineTime('hostname = "BJTianXuan"')).toBe('hostname = "BJTianXuan"')
  })

  it('纳秒精度截断为毫秒显示', () => {
    const out = formatLogLineTime('2026-10-26T06:49:57.123456789Z INFO ns')
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.123 INFO ns$/)
    expect(timestampOf(out)).toBe(Date.parse('2026-10-26T06:49:57.123Z'))
  })
})
