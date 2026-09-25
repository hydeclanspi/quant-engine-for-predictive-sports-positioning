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
  it('keeps rounded allocations inside the budget, including invalid and tiny limits', () => {
    for (const cap of [-10, 0, 0.5, 5.99, 19.9, 23.3, 123.4, 1200]) {
      const amounts = p.allocateAmountsWithinRiskCap([0.01, 0.7, 0.29], cap, 10, 3)
      expect(amounts.every((amount) => Number.isInteger(amount) && amount >= 0)).toBe(true)
      expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBeLessThanOrEqual(Math.max(0, cap))
    }
    expect(p.allocateAmountsWithinRiskCap([0.5, 0.5], Infinity)).toEqual([0, 0])
    expect(p.allocateAmountsWithinRiskCap([Infinity, 0, NaN], 100)).toEqual([0, 0, 0])
  })
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
  it('models same-line half-ball totals as exact and exhaustive (no ordinary miss)', () => {
    const profile = buildAtomicMatchProfile({ entries: [{ name: '大2.5', odds: 1.9 }, { name: '小2.5', odds: 2 }], unionProbability: 0.5 })
    expect(profile.modelStatus).toBe('exact')
    expect(profile.hitProbability).toBe(1)
    expect(profile.missProbability).toBe(0)
  })
  it('models same-line integer totals as exact but not complete (push space remains)', () => {
    const profile = buildAtomicMatchProfile({ entries: [{ name: '大2', odds: 1.9 }, { name: '小2', odds: 2 }], unionProbability: 0.5 })
    expect(profile.modelStatus).toBe('exact')
    expect(profile.missProbability).toBeGreaterThan(0)
  })
  it('flags synonymous handicap notations (-1 win ≡ 1 lose) instead of double-counting them', () => {
    const profile = buildAtomicMatchProfile({ entries: [{ name: '-1 win', odds: 2 }, { name: '1 lose', odds: 2 }], unionProbability: 0.5 })
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
  it('holds the loss tail and the all-lose probability against the enumerated states', () => {
    const mc = p.runPortfolioMonteCarlo([item], 50000)
    // 枚举口径：states 按 net 升序累加概率，累计概率首次覆盖 5% 的档位即 VaR；
    // 全灭概率即所有 gross === 0 状态的概率之和。持仓 100 元，故按元缩放。
    const states = [...profile.states].sort((a, b) => a.net - b.net)
    let cumulative = 0
    let enumeratedVar95 = states[states.length - 1].net
    for (const state of states) {
      cumulative += state.probability
      if (cumulative >= 0.05) {
        enumeratedVar95 = state.net
        break
      }
    }
    const enumeratedAllLose = profile.states
      .filter((state) => !(state.gross > 0))
      .reduce((sum, state) => sum + state.probability, 0)
    // 已注资的方案必须真的带左尾，否则本用例无法与零注资用例的 === 0 形成对照。
    expect(enumeratedVar95).toBeLessThan(0)
    expect(enumeratedAllLose).toBeGreaterThan(0)
    expect(mc.var95).toBeCloseTo(enumeratedVar95 * item.amount, 2)
    expect(mc.minPnl).toBeCloseTo(states[0].net * item.amount, 2)
    expect(mc.allLoseProb).toBeCloseTo(enumeratedAllLose, 2)
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
  it('shares one draw across records that reference the same physical event', () => {
    const recA = { amount: 100, subset: [{ key: 'recA-0', homeTeam: 'A', awayTeam: 'B', atomicProfile: profile, event_id: 'e1' }] }
    const recB = { amount: 50, subset: [{ key: 'recB-0', homeTeam: 'A', awayTeam: 'B', atomicProfile: profile, event_id: 'e1' }] }
    const mc = p.runPortfolioMonteCarlo([recA, recB], 50000)
    // 共享一次抽取：全灭概率仍是单场 miss（0.2），而不是独立两场的 0.04。
    expect(mc.allLoseProb).toBeCloseTo(0.2, 2)
    expect(mc.maxPnl).toBe(450)
    expect(mc.minPnl).toBe(-150)
  })
  it('keeps different physical events independent', () => {
    const recA = { amount: 100, subset: [{ key: 'recA-0', homeTeam: 'A', awayTeam: 'B', atomicProfile: profile, event_id: 'e1' }] }
    const recB = { amount: 50, subset: [{ key: 'recB-0', homeTeam: 'C', awayTeam: 'D', atomicProfile: profile, event_id: 'e2' }] }
    const mc = p.runPortfolioMonteCarlo([recA, recB], 50000)
    // 独立：全灭概率 ≈ 0.2²。
    expect(mc.allLoseProb).toBeCloseTo(0.04, 2)
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
  it('lets the coverage weight flip which candidate the ranking selects', () => {
    // m0 已被两条头部组合覆盖（boost 衰减到 0.6^2 = 0.36），
    // 而 m1 / m2 无人覆盖（各保留 0.6），故覆盖面更宽的 raw 效用略低者能靠覆盖分反超。
    const rows = [
      { id: 'highUtility', subset: [candidates[0]], utility: 1, sharpe: 1 },
      { id: 'm0Rival', subset: [candidates[0]], utility: 0.4, sharpe: 1 },
      { id: 'broadCoverage', subset: [candidates[1], candidates[2]], utility: 0.9, sharpe: 1 },
    ]
    const selected = candidates.slice(0, 3)
    // 排序口径与调用点一致：boostedUtility 降序，同分再看 utility。原始效用差 0.1。
    const ranking = (scored) =>
      [...scored]
        .sort((a, b) => b.boostedUtility - a.boostedUtility || b.utility - a.utility)
        .map((row) => row.id)
    expect(ranking(p.applyCoverageDynamicBoost(rows, selected))).toEqual(['highUtility', 'broadCoverage', 'm0Rival'])
    expect(ranking(p.applyCoverageDynamicBoost(rows, selected, 0.6, { coverageDecayBoost: 0.04 }))).toEqual(['highUtility', 'broadCoverage', 'm0Rival'])
    expect(ranking(p.applyCoverageDynamicBoost(rows, selected, 0.6, { coverageDecayBoost: 0.16 }))).toEqual(['broadCoverage', 'highUtility', 'm0Rival'])
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
