/**
 * lighttierConfigUtil 单测：LightTier 私有元数据 [lighttier] 的读写与旧版迁移
 * 旧版位置：flags._enable_exit_route、顶层 config_exit_nodes_route
 */
import { describe, it, expect } from 'vitest'
import {
  getLightTierConfig,
  isExitRouteEnabled,
  migrateLightTierConfig,
  setExitRouteEnabled
} from '@/utils/lighttierConfigUtil'

describe('lighttierConfigUtil', () => {
  describe('getLightTierConfig', () => {
    it('缺失或结构非法时返回空对象', () => {
      expect(getLightTierConfig(undefined)).toEqual({})
      expect(getLightTierConfig({})).toEqual({})
      expect(getLightTierConfig({ lighttier: [] })).toEqual({})
      expect(getLightTierConfig({ lighttier: 'x' })).toEqual({})
    })

    it('返回 [lighttier] 表内容', () => {
      expect(getLightTierConfig({ lighttier: { exit_route_enabled: true } })).toEqual({
        exit_route_enabled: true
      })
    })
  })

  describe('isExitRouteEnabled', () => {
    it('无任何标记时为 false', () => {
      expect(isExitRouteEnabled(undefined)).toBe(false)
      expect(isExitRouteEnabled({})).toBe(false)
      expect(isExitRouteEnabled({ lighttier: {} })).toBe(false)
    })

    it('优先读取 [lighttier].exit_route_enabled', () => {
      expect(isExitRouteEnabled({ lighttier: { exit_route_enabled: true } })).toBe(true)
      expect(isExitRouteEnabled({ lighttier: { exit_route_enabled: false } })).toBe(false)
      // 新位置优先于旧位置
      expect(
        isExitRouteEnabled({
          lighttier: { exit_route_enabled: false },
          flags: { _enable_exit_route: true }
        })
      ).toBe(false)
    })

    it('兼容旧版 flags._enable_exit_route', () => {
      expect(isExitRouteEnabled({ flags: { _enable_exit_route: true } })).toBe(true)
      expect(isExitRouteEnabled({ flags: { _enable_exit_route: false } })).toBe(false)
    })

    it('兼容更早版本的顶层 config_exit_nodes_route', () => {
      expect(isExitRouteEnabled({ config_exit_nodes_route: true })).toBe(true)
      expect(isExitRouteEnabled({ config_exit_nodes_route: false })).toBe(false)
    })
  })

  describe('setExitRouteEnabled', () => {
    it('开启时写入 [lighttier] 并清除旧版标记，保留其它 flags', () => {
      const cfg: Record<string, any> = {
        flags: { _enable_exit_route: true, latency_first: true },
        config_exit_nodes_route: true
      }
      expect(setExitRouteEnabled(cfg, true)).toBe(true)
      expect(cfg).toEqual({
        flags: { latency_first: true },
        lighttier: { exit_route_enabled: true }
      })
    })

    it('旧标记清除后 flags 为空时整表删除', () => {
      const cfg: Record<string, any> = { flags: { _enable_exit_route: true } }
      expect(setExitRouteEnabled(cfg, true)).toBe(true)
      expect(cfg).toEqual({ lighttier: { exit_route_enabled: true } })
      expect('flags' in cfg).toBe(false)
    })

    it('关闭时删除开关，段内无其它字段则删除整表', () => {
      const cfg: Record<string, any> = { lighttier: { exit_route_enabled: true } }
      expect(setExitRouteEnabled(cfg, false)).toBe(true)
      expect('lighttier' in cfg).toBe(false)
    })

    it('关闭时保留 [lighttier] 内的其它私有字段', () => {
      const cfg: Record<string, any> = {
        lighttier: { exit_route_enabled: true, other: 'keep' }
      }
      expect(setExitRouteEnabled(cfg, false)).toBe(true)
      expect(cfg).toEqual({ lighttier: { other: 'keep' } })
    })

    it('无变化时返回 false', () => {
      expect(setExitRouteEnabled({}, false)).toBe(false)
      expect(setExitRouteEnabled({ lighttier: { exit_route_enabled: true } }, true)).toBe(false)
    })
  })

  describe('migrateLightTierConfig', () => {
    it('无旧标记时返回 false 且不写入 [lighttier]', () => {
      const cfg: Record<string, any> = { hostname: 'h' }
      expect(migrateLightTierConfig(cfg)).toBe(false)
      expect(cfg).toEqual({ hostname: 'h' })
    })

    it('迁移 flags._enable_exit_route = true', () => {
      const cfg: Record<string, any> = { flags: { _enable_exit_route: true, dhcp: true } }
      expect(migrateLightTierConfig(cfg)).toBe(true)
      expect(cfg.flags).toEqual({ dhcp: true })
      expect(isExitRouteEnabled(cfg)).toBe(true)
    })

    it('迁移顶层 config_exit_nodes_route = true', () => {
      const cfg: Record<string, any> = { config_exit_nodes_route: true }
      expect(migrateLightTierConfig(cfg)).toBe(true)
      expect('config_exit_nodes_route' in cfg).toBe(false)
      expect(cfg.lighttier).toEqual({ exit_route_enabled: true })
    })

    it('旧标记为 false 时迁移后不写入开关（保持关闭）', () => {
      const cfg: Record<string, any> = { flags: { _enable_exit_route: false } }
      expect(migrateLightTierConfig(cfg)).toBe(true)
      expect(cfg).toEqual({})
      expect(isExitRouteEnabled(cfg)).toBe(false)
    })
  })
})
