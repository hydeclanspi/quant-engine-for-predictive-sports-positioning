import { describe, expect, it } from 'vitest'
import { __portfolioTestables as p } from '../../pages/ComboPage'
import { buildAtomicMatchProfile, combineAtomicMatchProfiles, calcAtomicEquivalentOdds } from '../atomicParlay'

const config = { initialCapital: 1000, riskCapRatio: 0.12, defaultOdds: 2.5, kellyDivisor: 4,
  weightConf: 0.45, weightMode: 0.16, weightTys: 0.12, weightFid: 0.14, weightOdds: 0.06, weightFse: 0.07 }
const candidates = Array.from({ length: 10 }, (_, i) => ({
  key: `m${i}`, investmentId: `i${i}`, matchIndex: 0, homeTeam: `H${i}`, awayTeam: `A${i}`,
  entry: 'win', entries: [{ name: 'win', odds: 2 }], odds: 2, conf: 0.6, calibratedP: 0.6,
  confSurplus: { surplus: 0.1 }, mode: '常规', tysHome: 'M', tysAway: 'M', fid: 0.4, fseHome: 0.5, fseAway: 0.5,
}))
const generate = (matches, context = {}) => p.generateRecommendations(matches, 50, 120, config, context, { minCoverageEnabled: false })

describe('atomic payout model', () => {
  it('does not create a miss for exhaustive 1X2 coverage', () => {
    const profile = buildAtomicMatchProfile({ entries: ['win', 'draw', 'lose'].map((name) => ({ name, odds: 3 })), unionProbability: 0.5 })
    expect(profile.valid).toBe(true)
    expect(profile.hitProbability).toBe(1)
    expect(profile.missProbability).toBe(0)
    expect(profile.expectedReturn).toBeCloseTo(0)
  })
  it('retains an equivalent payout below one instead of manufacturing positive return', () => {
    expect(calcAtomicEquivalentOdds(['win', 'draw', 'lose'].map((name) => ({ name, odds: 2.4 })))).toBeCloseTo(0.8)
  })
  it.each([0, 1, -2, '', 'bad', null])('rejects malformed decimal odds %j', (odds) => {
    const profile = buildAtomicMatchProfile({ entries: [{ name: 'win', odds }] })
    expect(profile.valid).toBe(false)
    expect(profile.states).toEqual([])
  })
  it('marks overlapping score and result markets as unsupported for automatic use', () => {
    const profile = buildAtomicMatchProfile({ entries: [{ name: '2-0', odds: 6 }, { name: 'win', odds: 2 }] })
    expect(profile.modelStatus).toBe('approximate')
    expect(profile.warnings.length).toBeGreaterThan(0)
  })
})

describe('Portfolio Monte Carlo uses the saved return shape and actual money', () => {
  const profile = buildAtomicMatchProfile({ entries: [{ name: 'win', odds: 2 }, { name: 'lose', odds: 8 }], unionProbability: 0.8 })
  const item = { amount: 100, subset: [{ key: 'one', homeTeam: 'A', awayTeam: 'B', atomicProfile: profile }] }
  it('matches analytic profit probability and mean, not just equivalent odds', () => {
    const mc = p.runPortfolioMonteCarlo([item], 50000)
    expect(mc.valid).toBe(true)
    expect(mc.profitProb).toBeCloseTo(profile.profitWinProbability, 2)
    expect(Math.abs(mc.mean - profile.expectedReturn * 100)).toBeLessThan(2)
    expect(mc.maxPnl).toBe(300)
  })
  it('keeps zero stake zero even when theoretical weight is nonzero', () => {
    const zero = { ...item, amount: 0, allocatedWeight: 0.25 }
    expect(p.getEffectiveStakeForScoring(zero)).toBe(0)
    const mc = p.runPortfolioMonteCarlo([zero], 500)
    expect(mc.totalStake).toBe(0)
    expect(mc.mean).toBe(0)
    expect(mc.allLoseProb).toBe(0)
  })
  it('shares a single outcome across tickets using the same leg', () => {
    const mc = p.runPortfolioMonteCarlo([item, { ...item, amount: 50 }], 50000)
    expect(mc.maxPnl).toBe(450)
    expect(mc.profitProb).toBeCloseTo(profile.profitWinProbability, 2)
  })
  it('refuses conflicting profiles rather than silently sampling the first', () => {
    const other = buildAtomicMatchProfile({ entries: [{ name: 'win', odds: 2 }], unionProbability: 0.5 })
    const mc = p.runPortfolioMonteCarlo([item, { ...item, subset: [{ ...item.subset[0], atomicProfile: other }] }])
    expect(mc.valid).toBe(false)
    expect(mc.issues.length).toBeGreaterThan(0)
  })
})

describe('allocation and ranking invariants', () => {
  it('allows cash when every candidate has negative EV', () => {
    const result = generate(candidates.slice(0, 3).map((m) => ({ ...m, conf: 0.2, calibratedP: 0.2, confSurplus: { surplus: -0.3 } })))
    expect(result.totalInvest).toBe(0)
    expect(result.recommendations.every((row) => row.amount === 0)).toBe(true)
  })
  it('explains infeasible coverage before starting search', () => {
    expect(p.getPortfolioInputIssue(candidates, { minCoverageEnabled: true, minCoveragePercent: 55 })).toContain('最高覆盖率 50.0%')
  })
  it('never exceeds a risk cap smaller than the former 20-yuan minimum', () => {
    expect(p.calcRecommendedAmount(0.9, 2, config, 5)).toBeLessThanOrEqual(5)
    expect(p.allocateAmountsWithinRiskCap([0, 0], 120)).toEqual([0, 0])
  })
  it('preserves corrected scores through stratified selection and coverage boost', () => {
    const rows = [
      { id: 'corrected', subset: [candidates[0], candidates[1]], utility: 1, softUtility: 10, sharpe: 1 },
      { id: 'raw', subset: [candidates[1], candidates[2]], utility: 2, softUtility: 0, sharpe: 1 },
    ]
    expect(p.stratifiedSelect(rows, 1, 2)[0].id).toBe('corrected')
    expect(p.applyCoverageDynamicBoost(rows, candidates.slice(0, 3))[0].boostedUtility).toBeGreaterThanOrEqual(10)
  })
  it('keeps diagnostic pair correlation from changing only probability but not EV', () => {
    const plain = generate(candidates.slice(0, 3))
    const adjusted = generate(candidates.slice(0, 3), { entryCorrelation: { ready: true, getCorrelation: () => ({ rho: 0.5, reliability: 1 }) } })
    const two = (result) => result.candidateUniverse.find((row) => row.legs === 2)
    expect(two(plain).p).toBe(two(adjusted).p)
    expect(two(plain).ev).toBe(two(adjusted).ev)
    const atomic = combineAtomicMatchProfiles([buildAtomicMatchProfile({ entries: [{ name: 'win', odds: 2 }], unionProbability: 0.6 }), buildAtomicMatchProfile({ entries: [{ name: 'win', odds: 2 }], unionProbability: 0.6 })])
    expect(two(plain).p).toBeCloseTo(atomic.hitProbability)
    expect(two(plain).ev).toBeCloseTo(atomic.expectedReturn)
  })
})
