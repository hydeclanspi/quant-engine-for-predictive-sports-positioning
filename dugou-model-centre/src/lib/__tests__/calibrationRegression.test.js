import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ config: {}, investments: [], writes: [], rejectSave: false }))

vi.mock('../localData', () => ({
  getInvestments: () => state.investments,
  getSystemConfig: () => state.config,
  getTeamProfiles: () => [],
  findTeamProfile: () => null,
  saveSystemConfig: (update) => {
    state.writes.push(update)
    if (state.rejectSave) return { ...state.config, ...update }
    state.config = { ...state.config, ...update }
    return state.config
  },
}))

import {
  autoApplyAdaptiveWeights,
  backtestComboHyperparams,
  buildEntryCorrelationMatrix,
  buildIsotonicRegression,
  computeAdaptiveWeightSuggestions,
  __testables,
} from '../analytics'
import { predictMatchProbability } from '../matchPrediction'

const makeMatch = (extra = {}) => ({
  id: 'match', home_team: 'Home', away_team: 'Away', entry_market_type: 'moneyline',
  conf: 0.75, odds: 2, mode: '赌一把', tys_home: 'S', tys_away: 'H', fid: 0.75,
  fse_home: 0.5, fse_away: 0.5, is_correct: true, match_rating: 0.8,
  ...extra,
})

const makeInvestment = (id, matches = [makeMatch()]) => ({
  id: `inv-${id}`, created_at: new Date(Date.UTC(2026, 0, id + 1)).toISOString(),
  outcome_available_at: new Date(Date.UTC(2026, 0, id + 1, 1)).toISOString(),
  inputs: 10, profit: 10, status: 'win', matches,
})

beforeEach(() => {
  state.config = {
    weightConf: 0.45, weightMode: 0.16, weightTys: 0.12,
    weightFid: 0.14, weightOdds: 0.06, weightFse: 0.07,
    adaptiveWeights: { enabled: true, mode: 'auto', minSamples: 50, updateEveryN: 5 },
  }
  state.investments = []
  state.writes = []
  state.rejectSave = false
})

describe('PAV calibration ties', () => {
  it('gives the same fitted probability after reordering equal-conf samples', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ conf: 0.5, actual: i < 15 ? 0 : 1 }))
    const forward = buildIsotonicRegression(rows)
    const reverse = buildIsotonicRegression([...rows].reverse())
    expect(forward.nodes).toEqual([{ x: 0.5, y: 0.5, n: 30 }])
    expect(reverse.nodes).toEqual(forward.nodes)
    expect(forward.calibrate(0.5)).toBe(0.5)
    expect(reverse.calibrate(0.5)).toBe(0.5)
  })

  it('preserves monotonicity when tied buckets violate the order', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      conf: i < 20 ? 0.3 : 0.7, actual: i < 20 ? 1 : 0,
    }))
    const fit = buildIsotonicRegression(rows)
    expect(fit.calibrate(0.3)).toBe(0.5)
    expect(fit.calibrate(0.7)).toBe(0.5)
  })
})

describe('entry pair marginal alignment', () => {
  it('does not change estimates when different-type legs change input order', () => {
    state.investments = Array.from({ length: 24 }, (_, i) => makeInvestment(i, [
      makeMatch({ entry_market_type: 'score', is_correct: i % 3 !== 0 }),
      makeMatch({ entry_market_type: 'moneyline', is_correct: i % 4 !== 0 }),
    ]))
    const baseline = buildEntryCorrelationMatrix().getCorrelation('score', 'moneyline')
    state.investments = state.investments.map((inv, i) => ({
      ...inv, matches: i % 2 ? inv.matches : [...inv.matches].reverse(),
    }))
    expect(buildEntryCorrelationMatrix().getCorrelation('moneyline', 'score')).toEqual(baseline)
  })

  it('treats same-type pairs as exchangeable rather than position-specific', () => {
    state.investments = Array.from({ length: 20 }, (_, i) => makeInvestment(i, [
      makeMatch({ is_correct: true }), makeMatch({ is_correct: false }),
    ]))
    const baseline = buildEntryCorrelationMatrix().getCorrelation('moneyline', 'moneyline')
    expect(baseline.pA).toBe(0.5)
    expect(baseline.pB).toBe(0.5)
    state.investments.forEach((inv, i) => { if (i % 2) inv.matches.reverse() })
    expect(buildEntryCorrelationMatrix().getCorrelation('moneyline', 'moneyline')).toEqual(baseline)
  })

  it('does not assign reliability to constant marginals', () => {
    state.investments = Array.from({ length: 20 }, (_, i) => makeInvestment(i, [
      makeMatch({ entry_market_type: 'score', is_correct: true }),
      makeMatch({ entry_market_type: 'moneyline', is_correct: false }),
    ]))
    expect(buildEntryCorrelationMatrix().ready).toBe(false)
    state.investments.forEach((inv, i) => { if (i % 2) inv.matches.reverse() })
    expect(buildEntryCorrelationMatrix().getCorrelation('score', 'moneyline')).toEqual({
      rho: 0, samples: 0, reliability: 0,
    })
  })
})

describe('combo prequential evaluation', () => {
  it('actually evaluates seven-match test windows', () => {
    state.investments = Array.from({ length: 50 }, (_, i) => makeInvestment(i))
    const wins = backtestComboHyperparams().temporalSplit
    expect(wins.enabled).toBe(true)
    expect(wins.windowCount).toBe(3)
    expect(wins.holdoutSamples).toBe(21)
    expect(wins.holdoutStrongHitRate).toBe(1)
    expect(wins.holdoutQuality).toBeLessThan(1)
    state.investments.forEach((inv) => { inv.matches[0].is_correct = false })
    expect(backtestComboHyperparams().temporalSplit.holdoutStrongHitRate).toBe(0)
  })

  it('does not label an insufficient holdout as evaluated', () => {
    state.investments = Array.from({ length: 30 }, (_, i) => makeInvestment(i))
    expect(backtestComboHyperparams().temporalSplit).toMatchObject({
      enabled: false, holdoutSamples: 0, windowCount: 0, holdoutQuality: null,
    })
  })

  it('does not count unusable windows as successful evaluations', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      created_at: makeInvestment(i).created_at, conf: 0.6, odds: 0, actual: 1,
    }))
    const result = __testables.evaluateComboPrequentialQuality(rows)
    expect(result).toMatchObject({ enabled: false, windowCount: 0, quality: null, samples: 0 })
    const invalidLabels = rows.slice(0, 7).map((r) => ({ ...r, odds: 2, actual: null }))
    expect(__testables.evaluateComboTemporalHoldoutQuality(invalidLabels, {
      strongEdge: 0.1, moderateEdge: 0.03, neutral: -0.03,
    }, 0.05)).toMatchObject({ quality: null, samples: 0 })
  })
})

describe('adaptive feature extraction', () => {
  it('reads modern per-match TYS, FID and mode fields', () => {
    state.investments = Array.from({ length: 50 }, (_, i) => makeInvestment(i))
    const { components } = __testables.computeInvestmentScore(state.investments[0], state.config)
    expect(components.tys).toBeCloseTo(0.6)
    expect(components.fid).toBeCloseTo(0.75)
    expect(components.mode).toBeCloseTo(0.1)
  })

  it('supports legacy field names and preserves zero-valued features', () => {
    const match = { conf: 0.6, odds: 2, tys_base_home: 'L', tys_base_away: 'S', fid_base_home: 0, fse_home: 0.5, fse_away: 0.5 }
    state.investments = Array.from({ length: 50 }, (_, i) => ({ ...makeInvestment(i, [{ ...match }]), mode: '常规-稳' }))
    const { components } = __testables.computeInvestmentScore(state.investments[0], state.config)
    expect(components.tys).toBeCloseTo(0.7)
    expect(components.fid).toBe(0)
    expect(components.mode).toBeCloseTo(0.7)
  })

  it('does not advertise a production-effective auto-change for weightConf', () => {
    state.investments = Array.from({ length: 50 }, (_, i) => makeInvestment(i))
    expect(computeAdaptiveWeightSuggestions().suggestions.find((s) => s.key === 'weightConf')).toMatchObject({
      current: 0.45, suggested: 0.45, change: 0, gradient: 0, confidence: 0,
    })
  })
})

describe('adaptive auto-apply permissions and revision cadence', () => {
  beforeEach(() => {
    state.investments = Array.from({ length: 50 }, (_, i) => makeInvestment(i, [makeMatch({ mode: '常规' })]))
  })

  it.each([
    { enabled: false, mode: 'auto' },
    { enabled: true, mode: 'suggest' },
    { enabled: true, mode: 'disabled' },
  ])('does not write when config is %j', (settings) => {
    state.config.adaptiveWeights = { ...state.config.adaptiveWeights, ...settings }
    expect(autoApplyAdaptiveWeights().applied).toBe(false)
    expect(state.writes).toHaveLength(0)
  })
  it('reports a rejected/read-only save instead of claiming success', () => {
    state.rejectSave = true
    expect(autoApplyAdaptiveWeights().reason).toBe('save_rejected')
    expect(state.config.adaptiveWeights.lastAppliedDataSignature).toBeUndefined()
  })
  it('assumes a missing settlement time 72 hours after creation and labels it', () => {
    state.investments.forEach((inv) => { delete inv.outcome_available_at })
    const rows = __testables.getBinaryOutcomeRows()
    expect(rows.every((row) => row.outcome_availability_basis === 'derived_created_at_plus_72h')).toBe(true)
    const windows = __testables.buildPrequentialWalkForwardWindows(rows)
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.every((w) => w.timeBasis === 'contains_derived_availability')).toBe(true)
  })

  it('refuses a temporal split when a record has no time at all', () => {
    state.investments.forEach((inv) => { delete inv.outcome_available_at; delete inv.created_at })
    expect(__testables.buildPrequentialWalkForwardWindows(__testables.getBinaryOutcomeRows())).toEqual([])
  })

  it('applies once per training revision and ignores record-order changes', () => {
    expect(autoApplyAdaptiveWeights().applied).toBe(true)
    expect(state.writes[0]).not.toHaveProperty('weightConf')
    expect(autoApplyAdaptiveWeights().reason).toBe('unchanged_data')
    state.investments.reverse()
    expect(autoApplyAdaptiveWeights().reason).toBe('unchanged_data')
    expect(state.writes).toHaveLength(1)
  })

  it('waits for updateEveryN new matches before applying again', () => {
    expect(autoApplyAdaptiveWeights().applied).toBe(true)
    state.investments.push(makeInvestment(50))
    expect(autoApplyAdaptiveWeights().reason).toBe('waiting_for_samples')
    state.investments.push(...Array.from({ length: 4 }, (_, i) => makeInvestment(51 + i)))
    expect(autoApplyAdaptiveWeights().applied).toBe(true)
    expect(state.writes).toHaveLength(2)
    expect(state.config.adaptiveWeights.lastAppliedMatchCount).toBe(55)
  })

  it('recognizes a correction to existing settled data without sample growth', () => {
    expect(autoApplyAdaptiveWeights().applied).toBe(true)
    state.investments[0].matches[0].match_rating = 0.7
    expect(autoApplyAdaptiveWeights().applied).toBe(true)
    expect(autoApplyAdaptiveWeights().reason).toBe('unchanged_data')
    expect(state.writes).toHaveLength(2)
  })
  it('does not retrain probabilities merely because the currency amount was corrected', () => {
    expect(autoApplyAdaptiveWeights().applied).toBe(true)
    state.investments[0].profit = 9
    expect(autoApplyAdaptiveWeights().reason).toBe('unchanged_data')
  })

  it('includes resolved legacy fallback features in the training revision', () => {
    state.investments[0].matches[0].fid = ''
    state.investments[0].matches[0].fid_base_home = 0.4
    expect(autoApplyAdaptiveWeights().applied).toBe(true)
    state.investments[0].matches[0].fid_base_home = 0.7
    expect(autoApplyAdaptiveWeights().applied).toBe(true)
    expect(autoApplyAdaptiveWeights().reason).toBe('unchanged_data')
  })
})

describe('production weight sensitivity', () => {
  // 先验全部 > 1（保险产品 1.08、TYS H 1.08、FID 0.75 1.1、FSE 1.12），
  // 所以任一有效权重调高都应把概率推高；落在 0.95 上限前可区分。
  const baseConfig = { weightMode: 0.16, weightTys: 0.12, weightFid: 0.14, weightFse: 0.07, defaultOdds: 2.5 }
  const match = {
    conf: 0.7, odds: 2, mode: '保险产品', tys_home: 'H', tys_away: 'H', fid: 0.75,
    fse_home: 1, fse_away: 1, entries: [{ name: 'win', odds: 2 }],
  }

  it.each([
    ['weightMode', 0.16, 1.5],
    ['weightTys', 0.12, 1.5],
    ['weightFid', 0.14, 1.5],
    ['weightFse', 0.07, 1.5],
  ])('%s demonstrably moves the production probability', (key, low, high) => {
    const lowP = predictMatchProbability(match, { ...baseConfig, [key]: low }, {})
    const highP = predictMatchProbability(match, { ...baseConfig, [key]: high }, {})
    expect(Number.isFinite(lowP)).toBe(true)
    expect(highP).toBeGreaterThan(lowP)
  })

  it('keeps weightConf out of the production probability', () => {
    const a = predictMatchProbability(match, { ...baseConfig, weightConf: 0.25 }, {})
    const b = predictMatchProbability(match, { ...baseConfig, weightConf: 0.65 }, {})
    expect(a).toBe(b)
  })
})

describe('isotonic regression fixed fixture', () => {
  const rows = (entries) =>
    entries.flatMap(([conf, hits, n]) => Array.from({ length: n }, (_, i) => ({ conf, actual: i < hits ? 1 : 0 })))

  it('passes through a monotone fit unchanged', () => {
    // 各 10 条、命中率与 conf 完全同序，无需合并：节点 x=conf、y=命中率、n=10。
    const model = buildIsotonicRegression(rows([[0.2, 2, 10], [0.4, 4, 10], [0.6, 6, 10], [0.8, 8, 10]]))
    expect(model.ready).toBe(true)
    expect(model.nodes.map((node) => [node.x, node.y, node.n])).toEqual([
      [0.2, 0.2, 10], [0.4, 0.4, 10], [0.6, 0.6, 10], [0.8, 0.8, 10],
    ])
    // 分段线性：0.5 落在 0.4→0.6 段中点 → 0.5。
    expect(model.calibrate(0.5)).toBeCloseTo(0.5, 10)
  })

  it('pools equal conf values and merges adjacent violators', () => {
    // 0.5 桶 3/10、0.7 桶 2/10 构成违序，PAV 合并为 5/20=0.25，节点 x 取桶中点 0.6。
    const model = buildIsotonicRegression(rows([[0.2, 2, 10], [0.5, 3, 10], [0.7, 2, 10], [0.9, 9, 10]]))
    expect(model.ready).toBe(true)
    expect(model.nodes.map((node) => [node.x, node.y, node.n])).toEqual([
      [0.2, 0.2, 10], [0.6, 0.25, 20], [0.9, 0.9, 10],
    ])
    expect(model.calibrate(0.6)).toBeCloseTo(0.25, 10)
    // 分段线性：0.4 落在 0.2→0.6 段，t=(0.4-0.2)/0.4=0.5 → 0.2 + 0.5*(0.25-0.2)=0.225。
    expect(model.calibrate(0.4)).toBeCloseTo(0.225, 10)
  })
})
