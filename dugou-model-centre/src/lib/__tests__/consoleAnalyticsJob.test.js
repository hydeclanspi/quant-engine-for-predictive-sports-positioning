import { afterEach, describe, expect, it, vi } from 'vitest'

const local = vi.hoisted(() => ({ config: { initialCapital: 600 }, investments: [], teamProfiles: [] }))
vi.mock('../localData', () => ({
  getSystemConfig: () => structuredClone(local.config),
  getInvestments: () => structuredClone(local.investments),
  getTeamProfiles: () => structuredClone(local.teamProfiles),
  findTeamProfile: vi.fn((query, profiles = local.teamProfiles) =>
    profiles.find((profile) => [profile.teamName, ...(profile.abbreviations || [])].includes(query)) || null),
  saveSystemConfig: vi.fn(),
}))
vi.mock('../displayMode', () => ({ isPreviewMode: () => false }))
afterEach(() => vi.unstubAllGlobals())

describe('worker data and result contracts', () => {
  it('returns the same display results as the ordinary engine, with cloneable unavailable states', async () => {
    vi.resetModules()
    const { runConsoleAnalytics: foreground } = await import('../consoleAnalyticsJob')
    const expected = []
    foreground((phase, result) => expected.push({ phase, result }))
    const snapshot = structuredClone(local)
    vi.resetModules()
    const source = await import('../analyticsSource')
    source.setAnalyticsWorkerSnapshot(snapshot)
    // Caller mutation cannot alter the in-flight job or its configuration.
    snapshot.config.initialCapital = 999
    snapshot.investments.push({ id: 'late-record' })
    expect(source.getSystemConfig().initialCapital).toBe(600)
    expect(source.getInvestments()).toHaveLength(0)
    const { runConsoleAnalytics } = await import('../consoleAnalyticsJob')
    const received = []
    runConsoleAnalytics((phase, result) => received.push(structuredClone({ phase, result })))
    expect(received).toEqual(expected)
    expect(received.at(-1).result.modelValidation).toMatchObject({ ready: false, stability: 'insufficient' })
    expect(received[2].result.adaptiveSuggestions.ready).toBe(false)
    const { saveSystemConfig } = await import('../localData')
    expect(saveSystemConfig).not.toHaveBeenCalled()
  })

  it('rejects reusing a worker snapshot or installing one into the UI realm', async () => {
    vi.resetModules()
    const { setAnalyticsWorkerSnapshot } = await import('../analyticsSource')
    expect(() => setAnalyticsWorkerSnapshot({})).toThrow('Invalid analytics snapshot')
    vi.stubGlobal('window', {})
    expect(() => setAnalyticsWorkerSnapshot(local)).toThrow('fresh worker')
    vi.unstubAllGlobals()
    setAnalyticsWorkerSnapshot(local)
    expect(() => setAnalyticsWorkerSnapshot(local)).toThrow('fresh worker')
  })

  it('preserves nonempty prediction, Kelly and team-profile results after live data changes', async () => {
    const previous = structuredClone(local)
    try {
      local.config = {
        initialCapital: 600, riskCapRatio: 0.12, defaultOdds: 2, kellyDivisor: 4,
        weightConf: 0.45, weightMode: 0.16, weightTys: 0.12,
        weightFid: 0.14, weightOdds: 0.13, weightFse: 0.07,
        adaptiveWeights: { minSamples: 50 },
      }
      local.teamProfiles = [
        { teamName: 'Home', abbreviations: ['Home alias'] },
        { teamName: 'Away', abbreviations: ['Away alias'] },
      ]
      // The production-validation fixture's daily, independent single selections:
      // enough for real walk-forward predictions, below adaptive tuning's minimum.
      local.investments = Array.from({ length: 28 }, (_, i) => ({
        id: `i${i}`, created_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
        outcome_available_at: new Date(Date.UTC(2026, 0, i + 1, 1)).toISOString(),
        status: i % 3 ? 'win' : 'lose', inputs: 10, profit: i % 3 ? 10 : -10,
        expected_rating: 0.55 + (i % 3) / 10,
        matches: [{
          id: `m${i}`, event_id: `e${i}`,
          home_team: i % 2 ? 'Home' : 'Home alias', away_team: i % 2 ? 'Away alias' : 'Away',
          conf: 0.3 + (i % 6) / 10, odds: 2, mode: '常规', tys_home: 'M', tys_away: 'L',
          fid: 0.4, fse_home: 0.3, fse_away: 0.7, match_rating: i % 3 ? 0.8 : 0.4,
          is_correct: i % 3 !== 0, entries: [{ name: 'win', odds: 2 }],
        }],
      }))
      vi.resetModules()
      const { runConsoleAnalytics: foreground } = await import('../consoleAnalyticsJob')
      const expected = []
      foreground((phase, result) => expected.push(structuredClone({ phase, result })))
      const snapshot = structuredClone(local)

      vi.resetModules()
      const source = await import('../analyticsSource')
      source.setAnalyticsWorkerSnapshot(snapshot)
      local.config = { initialCapital: 9999, weightOdds: 0.9, kellyDivisor: 12 }
      local.investments = []
      local.teamProfiles = [{ teamName: 'Wrong live team', abbreviations: ['Home alias', 'Away alias'] }]
      const { findTeamProfile, saveSystemConfig } = await import('../localData')
      findTeamProfile.mockClear()
      saveSystemConfig.mockClear()

      const { runConsoleAnalytics } = await import('../consoleAnalyticsJob')
      const received = []
      runConsoleAnalytics((phase, result) => received.push(structuredClone({ phase, result })))
      expect(received).toEqual(expected)
      expect(received.map(({ phase }) => phase)).toEqual(['rating', 'kelly', 'calibration', 'validation'])
      expect(received[0].result.ratingRows).toHaveLength(28)
      expect(received[0].result.modeKellyRows.find((row) => row.mode === '常规').samples).toBe(28)
      expect(received[2].result.adaptiveSuggestions).toMatchObject({ ready: false, sampleCount: 28, minSamples: 50 })
      const validation = received[3].result.modelValidation
      expect(validation).toMatchObject({ ready: true, sampleCount: 28, timeBasis: 'recorded_only' })
      expect(validation.walkForward.length).toBeGreaterThan(0)
      expect(validation.walkForward[0].predictions.length).toBeGreaterThan(0)
      expect(Number.isFinite(validation.walkForward[0].predictions[0].probability)).toBe(true)
      expect(findTeamProfile.mock.calls.some(([, profiles]) =>
        profiles.some((profile) => profile.teamName === 'Home'))).toBe(true)
      expect(findTeamProfile.mock.calls.every(([, profiles]) =>
        !profiles.some((profile) => profile.teamName === 'Wrong live team'))).toBe(true)
      const { getPredictionCalibrationContext } = await import('../analytics')
      expect(getPredictionCalibrationContext().teamCalibration.topTeams.map((team) => team.teamName).sort())
        .toEqual(['Away', 'Home'])
      expect(saveSystemConfig).not.toHaveBeenCalled()
    } finally {
      Object.assign(local, previous)
      vi.resetModules()
    }
  }, 30000)
})
