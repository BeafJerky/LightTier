/**
 * 主题预览模板 — Shadow DOM 内的界面骨架与样式
 *
 * 预览区通过 attachShadow 样式隔离：内置主题显式声明 CSS 变量
 * （不依赖全局 :root，避免全局已切暗色时奶油预览不生效），外部主题把 :root
 * 改写为 :host 后注入。文案随当前语言，由调用方传入 t。
 * 透明度底纹用 rgb(var(--theme-xxx-rgb)) 组合，旧版 WebView 无 color-mix()。
 */
import { parseCssColor } from '@/shared/lib/themeColorUtil'

type TranslateFn = (key: string) => string

/** 混色回退需要的 RGB 分量变量（与 theme.css 保持一致） */
const PREVIEW_RGB_VARS = [
  '--theme-bg',
  '--theme-bg-card',
  '--theme-text-primary',
  '--theme-text-muted',
  '--theme-accent-primary',
  '--theme-accent-secondary',
  '--theme-color-success',
  '--theme-color-danger',
  '--theme-color-warning'
]

/** 外部主题按自身声明值派生分量，避免继承到当前全局主题的颜色 */
const buildPreviewRgbVars = (cssText: string): string => {
  const lines = PREVIEW_RGB_VARS.flatMap((name) => {
    const declared = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(cssText)?.[1]
    const rgb = parseCssColor(declared)
    return rgb ? [`    ${name}-rgb: ${rgb.join(', ')};`] : []
  })
  return lines.length ? `  :host {\n${lines.join('\n')}\n  }\n` : ''
}

// 预览区结构与样式模板：桌面/移动分别用对应平台的真实界面骨架展示主题效果
const pvIcons = {
  overview:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  monitor:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
  config:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h5"/></svg>',
  theme:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  network:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.2 11.1l7.6-4.1M8.2 12.9l7.6 4.1"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10-6.5a1 1 0 0 0 0-1.72l-10-6.5A1 1 0 0 0 8 5.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
}

const buildDesktopPreviewHTML = (t: TranslateFn) => `
  <div class="pv-d" aria-hidden="true">
    <div class="pv-d-side">
      <div class="pv-d-brand">
        <span class="pv-d-logo">L</span>
        <span class="pv-d-brand-name">LightTier</span>
      </div>
      <div class="pv-d-nav">
        <div class="pv-d-nav-item active">${pvIcons.overview}<span>${t('newLayout.overview')}</span></div>
        <div class="pv-d-nav-item">${pvIcons.monitor}<span>${t('newLayout.monitor')}</span></div>
        <div class="pv-d-nav-item">${pvIcons.config}<span>${t('newLayout.config')}</span></div>
        <div class="pv-d-nav-item">${pvIcons.theme}<span>${t('newLayout.theme')}</span></div>
      </div>
    </div>
    <div class="pv-d-main">
      <div class="pv-d-head">
        <div class="pv-d-heading">
          <div class="pv-d-title">${t('newLayout.overview')}</div>
          <div class="pv-d-sub">${t('newLayout.overviewSub')}</div>
        </div>
        <span class="pv-d-create">${pvIcons.plus}<span>${t('newCommon.createConfig')}</span></span>
      </div>
      <div class="pv-d-stats">
        <div class="pv-d-stat success"><b>1</b><small>${t('newCommon.running')}</small></div>
        <div class="pv-d-stat muted"><b>1</b><small>${t('newCommon.stopped')}</small></div>
        <div class="pv-d-stat accent"><b>2</b><small>${t('newOverview.totalConfig')}</small></div>
      </div>
      <div class="pv-d-sec">${t('newOverview.myConfigs')}</div>
      <div class="pv-d-grid">
        <div class="pv-d-card on">
          <div class="pv-d-card-top">
            <span class="pv-d-status"><i class="pv-d-dot on"></i>${t('newCommon.running')}</span>
            <span class="pv-d-vip">10.144.0.1/24</span>
          </div>
          <div class="pv-d-name">global-mesh</div>
          <div class="pv-d-meta">3 · ${t('newOverview.nodes')} · 18 ms</div>
          <div class="pv-d-card-actions">
            <span class="pv-d-btn stop">${t('newCommon.stop')}</span>
            <span class="pv-d-btn ghost">${t('newOverview.configDetail')}</span>
          </div>
        </div>
        <div class="pv-d-card">
          <div class="pv-d-card-top">
            <span class="pv-d-status"><i class="pv-d-dot"></i>${t('newCommon.stopped')}</span>
          </div>
          <div class="pv-d-name">office-net</div>
          <div class="pv-d-meta">10.144.1.1/24</div>
          <div class="pv-d-card-actions">
            <span class="pv-d-btn run">${t('newCommon.run')}</span>
            <span class="pv-d-btn ghost">${t('newOverview.configDetail')}</span>
          </div>
        </div>
      </div>
      <div class="pv-d-toast-row">
        <span class="pv-d-toast"><i>${pvIcons.check}</i>${t('newCommon.startSuccess')}</span>
      </div>
    </div>
  </div>
`

const buildMobilePreviewHTML = (t: TranslateFn) => `
  <div class="pv-m" aria-hidden="true">
    <div class="pv-m-head">
      <div class="pv-m-title">${t('newLayout.overview')}</div>
      <div class="pv-m-sub">${t('newLayout.overviewSub')}</div>
    </div>
    <div class="pv-m-hero">
      <div class="pv-m-hero-top">
        <span class="pv-m-state"><i></i>${t('newOverview.connected')}</span>
        <span class="pv-m-ip">10.144.0.1/24</span>
      </div>
      <div class="pv-m-name">global-mesh</div>
      <div class="pv-m-metrics">
        <span class="pv-m-metric"><small>${t('newOverview.nodes')}</small><b>3</b></span>
        <span class="pv-m-metric"><small>${t('newMonitor.avgLatency')}</small><b>18 ms</b></span>
      </div>
      <div class="pv-m-actions">
        <span class="pv-m-btn stop">${pvIcons.stop}${t('newCommon.stop')}</span>
        <span class="pv-m-btn ghost">${t('newOverview.viewMonitor')}</span>
      </div>
    </div>
    <div class="pv-m-sec"><span>${t('newOverview.myConfigs')}</span><span class="pv-m-add">${pvIcons.plus}</span></div>
    <div class="pv-m-group">
      <div class="pv-m-row on">
        <span class="pv-m-tile on">${pvIcons.network}</span>
        <span class="pv-m-row-text"><b>global-mesh</b><small>10.144.0.1/24</small></span>
        <span class="pv-m-chev">${pvIcons.chevron}</span>
        <span class="pv-m-act stop">${pvIcons.stop}</span>
      </div>
      <div class="pv-m-row">
        <span class="pv-m-tile">${pvIcons.network}</span>
        <span class="pv-m-row-text"><b>office-net</b><small>${t('newOverview.disconnected')}</small></span>
        <span class="pv-m-chev">${pvIcons.chevron}</span>
        <span class="pv-m-act run">${pvIcons.play}</span>
      </div>
    </div>
  </div>
`

export const buildPreviewHTML = (inline: boolean, t: TranslateFn): string =>
  inline ? buildMobilePreviewHTML(t) : buildDesktopPreviewHTML(t)

export const previewStyle = `
  .pv-d, .pv-m { height: 100%; overflow: hidden; font-family: var(--theme-font-body, 'Sora', sans-serif); background: var(--theme-bg, #fdf8f4); color: var(--theme-text-primary, #4a3728); box-sizing: border-box; }

  /* ===== 桌面端：迷你工作区（侧栏 + 总览） ===== */
  .pv-d { display: flex; }
  .pv-d-side { display: flex; width: 112px; padding: 12px 8px 10px; flex-shrink: 0; flex-direction: column; gap: 10px; background: var(--theme-bg-sidebar, var(--theme-bg, #fdf8f4)); border-right: 1px solid var(--theme-border, #ede4db); }
  .pv-d-brand { display: flex; padding: 0 4px; align-items: center; gap: 6px; }
  .pv-d-logo { display: flex; width: 20px; height: 20px; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 11px; font-weight: 700; color: var(--theme-text-on-accent, var(--theme-text-white, #fff)); background: linear-gradient(135deg, var(--theme-accent-primary, #e8a0a0), var(--theme-accent-secondary, var(--theme-accent-primary, #e8a0a0))); border-radius: 6px; align-items: center; justify-content: center; flex-shrink: 0; }
  .pv-d-brand-name { overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 10px; font-weight: 700; letter-spacing: -0.2px; white-space: nowrap; }
  .pv-d-nav { display: flex; flex-direction: column; gap: 2px; }
  .pv-d-nav-item { display: flex; height: 26px; padding: 0 6px; overflow: hidden; font-size: 9.5px; color: var(--theme-text-secondary, var(--theme-text-muted, #7a6e5e)); border-radius: 7px; align-items: center; gap: 5px; }
  .pv-d-nav-item svg { width: 12px; height: 12px; opacity: 0.6; flex-shrink: 0; }
  .pv-d-nav-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-nav-item.active { color: var(--theme-text-primary, #4a3728); background: var(--theme-bg-active, rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.1)); box-shadow: inset 2px 0 0 var(--theme-accent-primary, #e8a0a0); }
  .pv-d-nav-item.active svg { color: var(--theme-accent-primary, #e8a0a0); opacity: 1; }
  .pv-d-main { display: flex; min-width: 0; padding: 14px 16px 12px; flex: 1; flex-direction: column; gap: 9px; }
  .pv-d-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .pv-d-heading { min-width: 0; }
  .pv-d-title { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 16px; font-weight: 600; line-height: 1.2; }
  .pv-d-sub { margin-top: 2px; overflow: hidden; font-size: 9px; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-create { display: inline-flex; height: 22px; padding: 0 9px; font-size: 9px; font-weight: 600; color: var(--theme-text-on-accent, var(--theme-text-white, #fff)); white-space: nowrap; background: var(--theme-accent-primary, #e8a0a0); border-radius: var(--theme-radius-pill, 100px); align-items: center; gap: 3px; flex-shrink: 0; }
  .pv-d-create svg { width: 9px; height: 9px; }
  .pv-d-stats { display: flex; gap: 6px; }
  .pv-d-stat { display: flex; min-width: 0; padding: 8px 10px; flex-direction: column; gap: 1px; background: var(--theme-bg-card, #fff); border: 1px solid var(--theme-border-light, var(--theme-border, #ede4db)); border-radius: 10px; flex: 1; }
  .pv-d-stat b { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 14px; font-weight: 600; line-height: 1.1; }
  .pv-d-stat.success b { color: var(--theme-color-success, #7fba8a); }
  .pv-d-stat.muted b { color: var(--theme-text-muted, #c8bdb2); }
  .pv-d-stat.accent b { color: var(--theme-accent-secondary, var(--theme-accent-primary, #e8a0a0)); }
  .pv-d-stat small { overflow: hidden; font-size: 8.5px; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-sec { padding: 0 1px; font-size: 10px; font-weight: 600; color: var(--theme-text-primary, #4a3728); }
  .pv-d-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
  .pv-d-card { display: flex; min-width: 0; padding: 10px 11px; flex-direction: column; gap: 4px; background: var(--theme-bg-card, #fff); border: 1px solid var(--theme-border-light, var(--theme-border, #ede4db)); border-radius: var(--theme-radius-lg, 10px); }
  .pv-d-card.on { background: linear-gradient(160deg, rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.07), rgb(var(--theme-color-success-rgb, 127, 186, 138), 0)), var(--theme-bg-card, #fff); border-color: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.24); }
  .pv-d-card-top { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 4px; }
  .pv-d-status { display: flex; font-size: 8.5px; color: var(--theme-text-muted, #c8bdb2); align-items: center; gap: 4px; white-space: nowrap; }
  .pv-d-dot { width: 5px; height: 5px; background: var(--theme-text-muted, #c8bdb2); border-radius: 50%; flex-shrink: 0; }
  .pv-d-dot.on { background: var(--theme-color-success, #7fba8a); box-shadow: 0 0 0 2px rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.15); }
  .pv-d-vip { padding: 1px 5px; overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 8px; color: var(--theme-accent-primary, #e8a0a0); text-overflow: ellipsis; white-space: nowrap; background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.1); border-radius: var(--theme-radius-pill, 100px); }
  .pv-d-name { overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 12px; font-weight: 600; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-meta { overflow: hidden; font-size: 8.5px; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-d-card-actions { display: flex; margin-top: 2px; gap: 4px; }
  .pv-d-btn { display: inline-flex; height: 20px; padding: 0 8px; font-size: 8.5px; font-weight: 600; border: 1px solid transparent; border-radius: var(--theme-radius-pill, 100px); align-items: center; white-space: nowrap; }
  .pv-d-btn.stop { color: var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)); background: rgb(var(--theme-color-danger-rgb, 232, 160, 160), 0.1); border-color: rgb(var(--theme-color-danger-rgb, 232, 160, 160), 0.24); }
  .pv-d-btn.run { color: var(--theme-text-on-accent, var(--theme-text-white, #fff)); background: var(--theme-color-success, #7fba8a); }
  .pv-d-btn.ghost { color: var(--theme-text-secondary, var(--theme-text-muted, #7a6e5e)); background: var(--theme-bg-hover, rgb(var(--theme-text-primary-rgb, 74, 55, 40), 0.05)); }
  .pv-d-toast-row { display: flex; margin-top: auto; justify-content: flex-end; }
  .pv-d-toast { display: inline-flex; padding: 5px 10px; font-size: 8.5px; color: var(--theme-text-primary, #4a3728); background: var(--theme-bg-card, #fff); border: 1px solid rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.26); border-radius: var(--theme-radius-pill, 100px); box-shadow: var(--theme-shadow-sm, 0 4px 12px rgba(0, 0, 0, 0.06)); align-items: center; gap: 4px; }
  .pv-d-toast i { display: flex; width: 13px; height: 13px; color: var(--theme-color-success, #7fba8a); background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.12); border-radius: 50%; align-items: center; justify-content: center; }
  .pv-d-toast svg { width: 8px; height: 8px; }

  /* ===== 移动端：总览页（连接卡片 + 分组配置列表） ===== */
  .pv-m { display: flex; padding: 12px 14px; flex-direction: column; gap: 8px; }
  .pv-m-head { display: flex; flex-direction: column; align-items: flex-start; }
  .pv-m-title { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 15px; font-weight: 600; line-height: 1.2; }
  .pv-m-sub { margin-top: 1px; overflow: hidden; font-size: 9px; line-height: 1.3; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-m-add { display: inline-flex; width: 24px; height: 24px; color: var(--theme-accent-primary, #e8a0a0); background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.1); border-radius: 50%; align-items: center; justify-content: center; flex-shrink: 0; }
  .pv-m-add svg { width: 12px; height: 12px; }
  .pv-m-hero { padding: 9px 12px 10px; background: radial-gradient(120% 90% at 100% 0%, rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.16), transparent 62%), var(--theme-bg-card, #fff); border: 1px solid rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.26); border-radius: var(--theme-radius-xl, 14px); }
  .pv-m-hero-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pv-m-state { display: flex; font-size: 8.5px; font-weight: 600; letter-spacing: 0.4px; color: var(--theme-text-muted, #c8bdb2); text-transform: uppercase; align-items: center; gap: 5px; }
  .pv-m-state i { width: 5px; height: 5px; background: var(--theme-color-success, #7fba8a); border-radius: 50%; box-shadow: 0 0 0 3px rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.14); flex-shrink: 0; }
  .pv-m-ip { padding: 1px 6px; overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 8.5px; color: var(--theme-accent-primary, #e8a0a0); text-overflow: ellipsis; white-space: nowrap; background: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.1); border-radius: var(--theme-radius-pill, 100px); }
  .pv-m-name { margin-top: 3px; overflow: hidden; font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 16px; font-weight: 600; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .pv-m-metrics { display: flex; margin-top: 5px; align-items: center; gap: 10px; }
  .pv-m-metric { display: flex; align-items: baseline; gap: 4px; }
  .pv-m-metric small { font-size: 8px; color: var(--theme-text-muted, #c8bdb2); }
  .pv-m-metric b { font-family: var(--theme-font-display, 'Quicksand', sans-serif); font-size: 11px; font-weight: 600; }
  .pv-m-metric + .pv-m-metric { padding-left: 10px; border-left: 1px solid var(--theme-border-light, var(--theme-border, #ede4db)); }
  .pv-m-actions { display: flex; margin-top: 7px; gap: 6px; }
  .pv-m-btn { display: flex; height: 26px; font-size: 9.5px; font-weight: 600; border: 1px solid transparent; border-radius: var(--theme-radius-pill, 100px); flex: 1; align-items: center; justify-content: center; gap: 4px; }
  .pv-m-btn svg { width: 9px; height: 9px; }
  .pv-m-btn.stop { color: var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)); background: rgb(var(--theme-color-danger-rgb, 232, 160, 160), 0.1); border-color: rgb(var(--theme-color-danger-rgb, 232, 160, 160), 0.24); }
  .pv-m-btn.ghost { color: var(--theme-text-secondary, var(--theme-text-muted, #7a6e5e)); background: var(--theme-bg-hover, rgb(var(--theme-text-primary-rgb, 74, 55, 40), 0.05)); }
  .pv-m-sec { display: flex; padding: 0 2px; font-size: 10px; font-weight: 600; color: var(--theme-text-primary, #4a3728); align-items: center; justify-content: space-between; }
  .pv-m-sec .pv-m-add { width: 20px; height: 20px; }
  .pv-m-sec .pv-m-add svg { width: 10px; height: 10px; }
  .pv-m-group { overflow: hidden; background: var(--theme-bg-card, #fff); border: 1px solid var(--theme-border, #ede4db); border-radius: var(--theme-radius-lg, 12px); }
  .pv-m-row { display: flex; height: 42px; padding: 0 6px 0 10px; align-items: center; gap: 8px; }
  .pv-m-row + .pv-m-row { border-top: 1px solid var(--theme-border-light, var(--theme-border, #ede4db)); }
  .pv-m-row.on { background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.05); }
  .pv-m-tile { display: flex; width: 26px; height: 26px; color: var(--theme-text-muted, #c8bdb2); background: var(--theme-bg-hover, rgb(var(--theme-text-primary-rgb, 74, 55, 40), 0.05)); border-radius: 8px; align-items: center; justify-content: center; flex-shrink: 0; }
  .pv-m-tile.on { color: var(--theme-color-success, #7fba8a); background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.12); }
  .pv-m-tile svg { width: 13px; height: 13px; }
  .pv-m-row-text { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
  .pv-m-row-text b { overflow: hidden; font-size: 11px; font-weight: 600; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
  .pv-m-row-text small { overflow: hidden; font-size: 8px; color: var(--theme-text-muted, #c8bdb2); text-overflow: ellipsis; white-space: nowrap; }
  .pv-m-chev { display: flex; width: 8px; color: var(--theme-text-muted, #c8bdb2); opacity: 0.45; flex-shrink: 0; }
  .pv-m-chev svg { width: 8px; height: 8px; }
  .pv-m-act { display: flex; width: 26px; height: 26px; border-radius: 50%; align-items: center; justify-content: center; flex-shrink: 0; }
  .pv-m-act svg { width: 10px; height: 10px; }
  .pv-m-act.stop { color: var(--theme-color-danger, var(--theme-accent-primary, #e8a0a0)); background: rgb(var(--theme-color-danger-rgb, 232, 160, 160), 0.1); }
  .pv-m-act.run { color: var(--theme-color-success-dark, var(--theme-color-success, #7fba8a)); background: rgb(var(--theme-color-success-rgb, 127, 186, 138), 0.12); }
`

// 内置主题：显式设置全部预用变量（不依赖全局 :root，避免全局暗色时预览不变化）
export const getBuiltinPreviewStyle = (name: string): string | null => {
  if (name === 'cream') {
    return `
      :host { display: block; height: 100%;
        --theme-bg: #fdf8f4; --theme-bg-card: #ffffff; --theme-bg-hover: rgba(232,160,160,0.06);
        --theme-bg-active: rgba(232,160,160,0.1); --theme-bg-tag: #f5ede6;
        --theme-bg-sidebar: linear-gradient(180deg, #faf5f0, #f5efe8);
        --theme-text-primary: #4a3728; --theme-text-secondary: #7a6e5e; --theme-text-muted: #c8bdb2;
        --theme-text-white: #fff; --theme-text-on-accent: #fff;
        --theme-accent-primary: #e8a0a0; --theme-accent-secondary: #b8a9c9;
        --theme-color-success: #7fba8a; --theme-color-success-dark: #6aaa78; --theme-color-danger: #e8a0a0;
        --theme-border: #ede4db; --theme-border-light: #f5ede6;
        --theme-bg-rgb: 253, 248, 244; --theme-bg-card-rgb: 255, 255, 255;
        --theme-text-primary-rgb: 74, 55, 40; --theme-text-muted-rgb: 200, 189, 178;
        --theme-accent-primary-rgb: 232, 160, 160; --theme-accent-secondary-rgb: 184, 169, 201;
        --theme-color-success-rgb: 127, 186, 138; --theme-color-danger-rgb: 232, 160, 160;
        --theme-color-warning-rgb: 230, 162, 60;
        --theme-shadow-sm: 0 8px 28px rgba(74,55,40,0.06);
        --theme-radius-lg: 14px; --theme-radius-xl: 18px; --theme-radius-pill: 100px;
        --theme-font-body: 'Sora', sans-serif; --theme-font-display: 'Quicksand', sans-serif;
      }
      ${previewStyle}`
  }
  if (name === 'dark') {
    return `
      :host { display: block; height: 100%;
        --theme-bg: #0d1b2a; --theme-bg-card: #1b2838; --theme-bg-hover: rgba(100,180,255,0.08);
        --theme-bg-active: rgba(100,180,255,0.12); --theme-bg-tag: #1e3040;
        --theme-bg-sidebar: linear-gradient(180deg, #0f1923, #0f1923);
        --theme-text-primary: #e0e8f0; --theme-text-secondary: #8a9bb0; --theme-text-muted: #5a6b80;
        --theme-text-white: #fff; --theme-text-on-accent: #fff;
        --theme-accent-primary: #6ba8e0; --theme-accent-secondary: #5a8ab0;
        --theme-color-success: #5ab08a; --theme-color-success-dark: #4a9a78; --theme-color-danger: #d48080;
        --theme-border: #2a4055; --theme-border-light: #243848;
        --theme-bg-rgb: 13, 27, 42; --theme-bg-card-rgb: 27, 40, 56;
        --theme-text-primary-rgb: 224, 232, 240; --theme-text-muted-rgb: 90, 107, 128;
        --theme-accent-primary-rgb: 107, 168, 224; --theme-accent-secondary-rgb: 90, 138, 176;
        --theme-color-success-rgb: 90, 176, 138; --theme-color-danger-rgb: 212, 128, 128;
        --theme-color-warning-rgb: 230, 162, 60;
        --theme-shadow-sm: 0 8px 28px rgba(0,0,0,0.25);
        --theme-radius-lg: 14px; --theme-radius-xl: 18px; --theme-radius-pill: 100px;
        --theme-font-body: 'Sora', sans-serif; --theme-font-display: 'Quicksand', sans-serif;
      }
      ${previewStyle}`
  }
  return null
}

// 外部主题：读取 CSS 并注入 Shadow DOM；先给出缺省变量，主题自身定义会覆盖
export const getExternalPreviewStyle = (cssText: string): string => `
  :host { display: block; height: 100%;
    --theme-bg-sidebar: var(--theme-bg, #fdf8f4);
    --theme-text-secondary: var(--theme-text-muted, #7a6e5e);
    --theme-text-on-accent: var(--theme-text-white, #fff);
    --theme-accent-secondary: var(--theme-accent-primary, #e8a0a0);
    --theme-color-danger: var(--theme-accent-primary, #e8a0a0);
    --theme-border-light: var(--theme-border, #ede4db);
    --theme-bg-active: rgb(var(--theme-accent-primary-rgb, 232, 160, 160), 0.1);
    --theme-shadow-sm: 0 4px 12px rgba(0,0,0,0.08);
    --theme-radius-lg: 12px; --theme-radius-xl: 16px; --theme-radius-pill: 100px;
  }
  ${buildPreviewRgbVars(cssText)}
  ${cssText.replace(/:root/g, ':host')}
  ${previewStyle}`
