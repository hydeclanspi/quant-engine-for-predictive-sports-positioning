import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

beforeAll(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })
  vi.stubGlobal('CustomEvent', class {
    constructor(type) { this.type = type }
  })
})

// 模块级会话状态：每个用例前清空
const { clearSessionGlassThemes, getEffectiveGlassTheme, getPageGlassDefault, getSessionGlassTheme, setSessionGlassTheme } = await import('../../design/themeSession')

beforeEach(() => {
  clearSessionGlassThemes()
})

describe('review-phase per-page glass themes', () => {
  it('resolves per-page defaults by longest route prefix', () => {
    expect(getPageGlassDefault('/new')).toBe('moon')
    expect(getPageGlassDefault('/new/')).toBe('moon')
    expect(getPageGlassDefault('/combo')).toBe('sand')
    expect(getPageGlassDefault('/settle')).toBe('hongguo')
    expect(getPageGlassDefault('/history')).toBe('daylight')
    expect(getPageGlassDefault('/history/teams')).toBe('moon')
    expect(getPageGlassDefault('/dashboard')).toBe('moon')
    expect(getPageGlassDefault('/dashboard/analysis')).toBe('moon')
    expect(getPageGlassDefault('/params')).toBe('hongguo')
    expect(getPageGlassDefault('/unknown')).toBe('sand')
  })

  it('lets session picks override one page without touching the others', () => {
    expect(getEffectiveGlassTheme('/params')).toBe('hongguo')
    setSessionGlassTheme('/params', 'spectra')
    expect(getEffectiveGlassTheme('/params')).toBe('spectra')
    expect(getSessionGlassTheme('/params')).toBe('spectra')
    expect(getEffectiveGlassTheme('/dashboard')).toBe('moon')
    setSessionGlassTheme('/dashboard/analysis', 'vivid')
    expect(getEffectiveGlassTheme('/dashboard/analysis')).toBe('vivid')
    expect(getEffectiveGlassTheme('/dashboard')).toBe('moon')
  })

  it('clears every session pick with reset', () => {
    setSessionGlassTheme('/params', 'xuanji')
    setSessionGlassTheme('/new', 'starward')
    clearSessionGlassThemes()
    expect(getEffectiveGlassTheme('/params')).toBe('hongguo')
    expect(getEffectiveGlassTheme('/new')).toBe('moon')
  })

  it('normalizes unknown styles back to the page default', () => {
    setSessionGlassTheme('/combo', 'not-a-theme')
    expect(getEffectiveGlassTheme('/combo')).toBe('sand')
  })
})
