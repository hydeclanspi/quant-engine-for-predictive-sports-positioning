import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
  ;({ getSystemConfig, saveSystemConfig, initializeFlagshipGlassDefault } = await import('../localData'))
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
})
