import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LIQUID_GLASS_QUALITY, LIQUID_GLASS_THEMES, normalizeLiquidGlassQuality } from '../../design/liquidGlassThemes'

const session = vi.hoisted(() => ({ historical: null, preview: false }))
vi.mock('../cloudSync', () => ({
  getTimeMachineSession: () => session.historical,
  isInTimeMachineSession: () => Boolean(session.historical),
}))
vi.mock('../gitSync', () => ({ scheduleGitCommit: vi.fn() }))
vi.mock('../displayMode', () => ({
  isPreviewMode: () => session.preview,
  DISPLAY_MODE_CHANGE_EVENT: 'test:display-mode',
}))

const key = 'dugou.system_config.v1'
let storage
let dispatchEvent
let getSystemConfig
let saveSystemConfig
let initializeFlagshipGlassDefault
let resetPreviewStore
let exportDataBundle
let importDataBundle

beforeAll(async () => {
  dispatchEvent = vi.fn()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (name) => storage.get(name) ?? null,
      setItem: (name, value) => storage.set(name, value),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent,
  })
  vi.stubGlobal('CustomEvent', class {
    constructor(type, options) { this.type = type; this.detail = options.detail }
  })
  ;({ getSystemConfig, saveSystemConfig, initializeFlagshipGlassDefault, exportDataBundle, importDataBundle } = await import('../localData'))
  ;({ resetPreviewStore } = await import('../previewStore'))
})

beforeEach(() => {
  session.historical = null
  session.preview = false
  storage = new Map([
    ['dugou.genesis_applied.v1', '1'],
    ['dugou.data_patch.v20260205', '1'],
    ['dugou.data_patch.v20260206', '1'],
    [key, JSON.stringify({ liquidGlassStyle: 'vivid', liquidGlassEnabled: true, initialCapital: 12345 })],
  ])
  dispatchEvent.mockClear()
  resetPreviewStore()
})

afterAll(() => vi.unstubAllGlobals())

describe('liquid glass UI preferences', () => {
  it.each(['vivid', 'hongguo', 'daylight', 'moon', 'sand', 'xuanji', 'spectra', 'starward'])('persists and reads %s without changing other settings', (style) => {
    saveSystemConfig({ liquidGlassStyle: style })
    expect(JSON.parse(storage.get(key))).toMatchObject({ liquidGlassStyle: style, initialCapital: 12345, liquidGlassEnabled: true })
    expect(getSystemConfig().liquidGlassStyle).toBe(style)
    expect(dispatchEvent.mock.calls.at(-1)[0].detail.key).toBe(key)
  })

  it.each(['daylight', 'moon', 'sand', 'xuanji', 'spectra', 'starward'])('retains current %s while browsing an older snapshot', (style) => {
    saveSystemConfig({ liquidGlassStyle: style })
    session.historical = { bundle: { system_config: { liquidGlassStyle: 'hongguo', initialCapital: 500 } } }
    expect(getSystemConfig()).toMatchObject({ liquidGlassStyle: style, initialCapital: 500 })
  })

  it('keeps demo choices in the demo store', () => {
    session.preview = true
    const storedBefore = storage.get(key)
    saveSystemConfig({ liquidGlassStyle: 'moon' })
    expect(getSystemConfig().liquidGlassStyle).toBe('moon')
    expect(storage.get(key)).toBe(storedBefore)
  })

  it('uses the flagship default for missing or unrecognized saved themes', () => {
    for (const style of [undefined, 'unrecognized']) {
      storage.set(key, JSON.stringify({ liquidGlassStyle: style }))
      expect(getSystemConfig().liquidGlassStyle).toBe('spectra')
    }
  })

  it('self-heals legacy light themes to the flagship default until the user pins a choice', () => {
    initializeFlagshipGlassDefault()
    expect(getSystemConfig().liquidGlassStyle).toBe('spectra')
    expect(JSON.parse(storage.get(key))).toMatchObject({ initialCapital: 12345, liquidGlassEnabled: true })

    // 云端快照把旧值打回来后（无 pinned），下次启动再次自愈
    storage.set(key, JSON.stringify({ liquidGlassStyle: 'hongguo', initialCapital: 12345 }))
    initializeFlagshipGlassDefault()
    expect(getSystemConfig().liquidGlassStyle).toBe('spectra')

    // 用户在选择器里手动钉选浅色主题 → 永久尊重，不再拉回
    saveSystemConfig({ liquidGlassStyle: 'moon', liquidGlassStylePinned: true })
    initializeFlagshipGlassDefault()
    expect(getSystemConfig().liquidGlassStyle).toBe('moon')
  })

  it('leaves an existing flagship choice untouched during migration', () => {
    storage.set(key, JSON.stringify({ liquidGlassStyle: 'xuanji', initialCapital: 999 }))
    initializeFlagshipGlassDefault()
    expect(getSystemConfig().liquidGlassStyle).toBe('xuanji')
  })

  it('defaults missing and invalid quality to smooth without changing the theme', () => {
    expect(DEFAULT_LIQUID_GLASS_QUALITY).toBe('smooth')
    for (const quality of [undefined, null, '', 'ultra', true]) {
      storage.set(key, JSON.stringify({ liquidGlassStyle: 'moon', liquidGlassQuality: quality }))
      expect(normalizeLiquidGlassQuality(quality)).toBe('smooth')
      expect(getSystemConfig()).toMatchObject({ liquidGlassStyle: 'moon', liquidGlassQuality: 'smooth' })
    }
    expect(saveSystemConfig({ liquidGlassQuality: 'unknown' }).liquidGlassQuality).toBe('smooth')
    expect(JSON.parse(storage.get(key)).liquidGlassQuality).toBe('smooth')
  })

  it.each(['smooth', 'full'])('persists and exports %s quality across every theme', (quality) => {
    for (const { key: style } of LIQUID_GLASS_THEMES) {
      saveSystemConfig({ liquidGlassStyle: style, liquidGlassQuality: quality })
      expect(getSystemConfig()).toMatchObject({ liquidGlassStyle: style, liquidGlassQuality: quality })
      expect(JSON.parse(storage.get(key))).toMatchObject({ liquidGlassQuality: quality, initialCapital: 12345 })
      expect(exportDataBundle().system_config.liquidGlassQuality).toBe(quality)
    }
  })

  it.each(['smooth', 'full'])('keeps %s quality local to preview without changing owner storage', (quality) => {
    const storedBefore = storage.get(key)
    session.preview = true
    expect(getSystemConfig().liquidGlassQuality).toBe('smooth')
    saveSystemConfig({ liquidGlassQuality: quality })
    expect(getSystemConfig().liquidGlassQuality).toBe(quality)
    expect(storage.get(key)).toBe(storedBefore)
    session.preview = false
    expect(getSystemConfig().liquidGlassQuality).toBe('smooth')
  })

  it.each(['smooth', 'full'])('preserves current %s quality when reading historical snapshots', (quality) => {
    saveSystemConfig({ liquidGlassQuality: quality })
    session.historical = { bundle: { system_config: { initialCapital: 500, liquidGlassQuality: quality === 'full' ? 'smooth' : 'full' } } }
    expect(getSystemConfig()).toMatchObject({ initialCapital: 500, liquidGlassQuality: quality })
  })

  it.each(['merge', 'replace'])('keeps the device quality when importing in %s mode', (mode) => {
    for (const quality of [undefined, 'smooth', 'full']) {
      storage.set(key, JSON.stringify({ initialCapital: 12345, liquidGlassQuality: quality }))
      const incoming = quality === 'full' ? 'smooth' : 'full'
      expect(importDataBundle({ system_config: { initialCapital: 900, liquidGlassQuality: incoming } }, mode)).toBe(true)
      expect(getSystemConfig()).toMatchObject({ initialCapital: 900, liquidGlassQuality: quality || 'smooth' })
    }
  })

  it('does not enable full quality from a snapshot when current preferences are missing', () => {
    session.historical = { bundle: { system_config: { liquidGlassQuality: 'full' } } }
    expect(getSystemConfig().liquidGlassQuality).toBe('smooth')
  })

  it('saves quality during Time Machine without overwriting live parameters or the snapshot', () => {
    const snapshot = { initialCapital: 500, liquidGlassQuality: 'smooth' }
    session.historical = { bundle: { system_config: snapshot } }
    saveSystemConfig({ liquidGlassQuality: 'full' })
    expect(getSystemConfig()).toMatchObject({ initialCapital: 500, liquidGlassQuality: 'full' })
    expect(JSON.parse(storage.get(key))).toMatchObject({ initialCapital: 12345, liquidGlassQuality: 'full' })
    expect(snapshot).toEqual({ initialCapital: 500, liquidGlassQuality: 'smooth' })
    saveSystemConfig({ liquidGlassQuality: 'smooth' })
    expect(getSystemConfig().liquidGlassQuality).toBe('smooth')
    session.historical = null
    expect(getSystemConfig()).toMatchObject({ initialCapital: 12345, liquidGlassQuality: 'smooth' })
  })

  it.each([false, true])('marks only appearance changes as UI-only (preview=%s)', (preview) => {
    session.preview = preview
    for (const patch of [{ liquidGlassQuality: 'full' }, { liquidGlassStyle: 'sand', liquidGlassStylePinned: true }, { liquidGlassEnabled: false }]) {
      saveSystemConfig(patch)
      const event = dispatchEvent.mock.calls.at(-1)[0]
      expect(event.type).toBe('dugou:data-changed')
      expect(event.detail).toMatchObject({ key, uiOnly: true })
      if (preview) expect(event.detail.preview).toBe(true)
    }
    saveSystemConfig({ initialCapital: 999, liquidGlassQuality: 'smooth' })
    expect(dispatchEvent.mock.calls.at(-1)[0].detail.uiOnly).not.toBe(true)
    expect(getSystemConfig().initialCapital).toBe(999)
  })
})
