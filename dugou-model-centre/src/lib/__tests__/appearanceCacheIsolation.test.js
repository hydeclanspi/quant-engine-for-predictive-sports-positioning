import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  config: { initialCapital: 600, capitalInjections: [], poolSettlements: [] },
}))
vi.mock('../localData', () => ({
  getSystemConfig: () => state.config,
  getInvestments: () => [],
  getTeamProfiles: () => [],
  getCycleTitles: () => [],
  findTeamProfile: () => null,
  saveSystemConfig: vi.fn(),
}))
vi.mock('../displayMode', () => ({ isPreviewMode: () => false }))

let getDashboardSnapshot
let getCyclePeriods
const host = new EventTarget()
const announce = (detail) => {
  const event = new Event('dugou:data-changed')
  event.detail = detail
  host.dispatchEvent(event)
}

beforeAll(async () => {
  vi.stubGlobal('window', host)
  ;({ getDashboardSnapshot } = await import('../analytics'))
  ;({ getCyclePeriods } = await import('../warReport'))
})
afterAll(() => vi.unstubAllGlobals())

describe('appearance changes preserve expensive model caches', () => {
  it('reuses the exact analytics and report objects for UI-only events', () => {
    const dashboard = getDashboardSnapshot()
    const periods = getCyclePeriods()
    for (const style of ['spectra', 'xuanji', 'starward', 'moon']) {
      state.config = { ...state.config, liquidGlassStyle: style, liquidGlassQuality: 'smooth' }
      announce({ key: 'dugou.system_config.v1', uiOnly: true })
      expect(getDashboardSnapshot()).toBe(dashboard)
      expect(getCyclePeriods()).toBe(periods)
    }
  })

  it.each([
    { key: 'dugou.system_config.v1' },
    { key: 'dugou.investments.v1' },
    { key: 'dugou.system_config.v1', preview: true },
    undefined,
  ])('still invalidates both caches for real model/data changes: %j', (detail) => {
    const dashboard = getDashboardSnapshot()
    const periods = getCyclePeriods()
    state.config = { ...state.config, initialCapital: state.config.initialCapital + 100 }
    announce(detail)
    expect(getDashboardSnapshot()).not.toBe(dashboard)
    const next = getCyclePeriods()
    expect(next).not.toBe(periods)
    expect(next.periods[0].baseCapital).toBe(state.config.initialCapital)
  })
})
