import { describe, expect, it } from 'vitest'
import { getExternalPreviewStyle } from '../themePreview'

describe('getExternalPreviewStyle', () => {
  it('rewrites :root variables onto the shadow host', () => {
    const out = getExternalPreviewStyle(':root { --theme-bg: #fff; }')
    expect(out).toContain('--theme-bg: #fff')
    expect(out).not.toContain(':root')
  })

  it('rewrites html[data-theme] scopes so they match the shadow host', () => {
    const out = getExternalPreviewStyle(
      "html[data-theme='famicom'] .pv-d-card { border-color: #2b241e; }"
    )
    expect(out).toContain(":host([data-theme='famicom']) .pv-d-card")
    expect(out).not.toContain('html[data-theme')
  })

  it('handles double quotes and unquoted attribute values', () => {
    const out = getExternalPreviewStyle(
      'html[data-theme="famicom"] .a { color: red; }\nhtml[data-theme=famicom] .b { color: blue; }'
    )
    expect(out).toContain(":host([data-theme='famicom']) .a")
    expect(out).toContain(":host([data-theme='famicom']) .b")
  })

  it('keeps selectors outside the theme scope unchanged', () => {
    const out = getExternalPreviewStyle('.plain { color: red; }')
    expect(out).toContain('.plain { color: red; }')
  })
})
