import { afterEach, describe, expect, it, vi } from 'vitest'

const local = vi.hoisted(() => ({ config: {}, investments: [], teamProfiles: [] }))
vi.mock('../localData', () => ({
  getSystemConfig: () => structuredClone(local.config),
  getInvestments: () => structuredClone(local.investments),
  getTeamProfiles: () => structuredClone(local.teamProfiles),
  findTeamProfile: (query, profiles = local.teamProfiles) =>
    profiles.find((profile) => [profile.teamName, ...(profile.abbreviations || [])].includes(query)) || null,
  saveSystemConfig: vi.fn(),
}))
vi.mock('../displayMode', () => ({ isPreviewMode: () => false }))

afterEach(() => vi.resetModules())

// Compare the entire fitted result, including nested numerical diagnostics.
// Function behavior is checked separately; fit time and the optional diagnostic
// are the only data fields excluded from the comparison.
const fittedData = (value) => {
  if (Array.isArray(value)) return value.map(fittedData)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !['adaptiveWeightResult', 'fitted_at'].includes(key) && typeof item !== 'function')
    .map(([key, item]) => [key, fittedData(item)]))
}

describe('optional Console weight suggestions preserve the production fit', () => {
  it('keeps full prediction outputs and separate caches while default tuning still runs', async () => {
    vi.resetModules()
    local.config = {
      initialCapital: 600, riskCapRatio: 0.12, defaultOdds: 2, kellyDivisor: 4,
      weightConf: 0.45, weightMode: 0.16, weightTys: 0.12,
      weightFid: 0.14, weightOdds: 0.13, weightFse: 0.07,
      adaptiveWeights: { minSamples: 24 },
    }
    local.teamProfiles = [
      { teamName: 'Home', abbreviations: ['Home alias'] },
      { teamName: 'Away', abbreviations: ['Away alias'] },
    ]
    // Independent daily selections yield two temporal windows. This exercises
    // actual weight tuning without the much larger demo fixture's runtime.
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
    const { getPredictionCalibrationContext } = await import('../analytics')
    const { predictMatchProbability } = await import('../matchPrediction')
    const predictionOnly = getPredictionCalibrationContext({ detail: 'full', includeWeightSuggestions: false })
    expect(predictionOnly.adaptiveWeightResult).toMatchObject({
      ready: false, applied: false, reason: 'not_requested', suggestions: [], sampleCount: 28,
    })
    const complete = getPredictionCalibrationContext({ detail: 'full' })
    expect(complete).not.toBe(predictionOnly)
    expect(getPredictionCalibrationContext({ detail: 'full', includeWeightSuggestions: false })).toBe(predictionOnly)
    expect(getPredictionCalibrationContext({ detail: 'full', includeWeightSuggestions: true })).toBe(complete)
    expect(getPredictionCalibrationContext()).toBe(complete)
    expect(complete.adaptiveWeightResult).toMatchObject({
      ready: true, applied: false, minSamples: 24, sampleCount: 28,
      evaluationBasis: 'production_brier_temporal_tuning',
    })
    expect(complete.adaptiveWeightResult.reason).not.toBe('not_requested')
    expect(complete.adaptiveWeightResult.suggestions).toHaveLength(6)
    expect(complete.adaptiveWeightResult.validation.samples).toBeGreaterThan(0)
    expect(complete.adaptiveWeightResult.suggestions.some((suggestion) => Math.abs(suggestion.gradient) > 0)).toBe(true)

    expect(fittedData(predictionOnly)).toEqual(fittedData(complete))
    expect(predictionOnly.comboHyperparams).toEqual(complete.comboHyperparams)
    expect(predictionOnly.marketBlend.walkForward.length).toBeGreaterThan(0)
    for (const conf of [0.05, 0.35, 0.65, 0.95]) {
      expect(predictionOnly.calibrate(conf)).toBe(complete.calibrate(conf))
      for (const odds of [1.3, 2, 4.5]) {
        for (const homeTeam of ['Home alias', 'Unseen team']) {
          const input = { conf, odds, homeTeam, awayTeam: 'Away' }
          const expected = complete.calibrateProbabilityForMatch(input)
          expect(Number.isFinite(expected)).toBe(true)
          expect(predictionOnly.calibrateProbabilityForMatch(input)).toBe(expected)
          const withBase = { ...input, baseProbability: conf * 0.9 }
          expect(predictionOnly.calibrateProbabilityForMatch(withBase)).toBe(complete.calibrateProbabilityForMatch(withBase))
          const match = { ...local.investments[0].matches[0], conf, odds, home_team: homeTeam, entries: [{ name: 'win', odds }] }
          expect(predictMatchProbability(match, local.config, predictionOnly)).toBe(predictMatchProbability(match, local.config, complete))
        }
      }
    }
    const { saveSystemConfig } = await import('../localData')
    expect(saveSystemConfig).not.toHaveBeenCalled()
  }, 30000)
})
