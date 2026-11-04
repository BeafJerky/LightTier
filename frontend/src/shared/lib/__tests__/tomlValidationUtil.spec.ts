import { describe, expect, it } from 'vitest'
import { validateToml } from '../tomlValidationUtil'

describe('validateToml', () => {
  it('accepts valid TOML', () => {
    expect(validateToml('hostname = "demo"\n').ok).toBe(true)
  })

  it('reports line and column for invalid TOML', () => {
    const result = validateToml('hostname = "demo"\nfoo = [\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.line).toBeGreaterThanOrEqual(1)
    expect(result.error.column).toBeGreaterThanOrEqual(0)
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('treats empty content as valid TOML', () => {
    expect(validateToml('').ok).toBe(true)
  })
})
