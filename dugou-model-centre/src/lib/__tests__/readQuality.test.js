import { describe, expect, it } from 'vitest'
import {
  READ_TIERS,
  ajrObjectiveContrast,
  buildReadRecord,
  buildReadRecords,
  calibratedLambdaFromPoint,
  deVigProportional,
  deriveMarketProbabilities,
  disagreementBuckets,
  fitFusionWeight,
  fitMarketLambdas,
  learnForecastBias,
  learnScaleBias,
  legacyAjrBuckets,
  logit,
  parseFinalScore,
  pointDistance,
  pointForecastToLambda,
  poissonPmf,
  readStateAutocorrelation,
  scorelineDistance,
  sigmoid,
  simulateCalibrationLoop,
} from '../readQuality'

const makeInvestment = (overrides = {}) => ({
  id: 'inv-1',
  created_at: '2026-01-01T00:00:00.000Z',
  status: 'lose',
  parlay_size: 1,
  matches: [],
  ...overrides,
})

const makeMatch = (overrides = {}) => ({
  id: 'm1',
  home_team: 'Home',
  away_team: 'Away',
  entries: [{ name: 'win', odds: 2 }],
  odds: 2,
  conf: 0.5,
  results: '2-1',
  is_correct: true,
  match_rating: 0.4,
  ...overrides,
})

const makeRng = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

describe('parseFinalScore', () => {
  it('accepts plain scorelines in common formats', () => {
    expect(parseFinalScore('2-0')).toEqual({ home: 2, away: 0 })
    expect(parseFinalScore(' 3 : 1 ')).toEqual({ home: 3, away: 1 })
    expect(parseFinalScore('2：2')).toEqual({ home: 2, away: 2 })
    expect(parseFinalScore('1-1（加时）')).toEqual({ home: 1, away: 1 })
  })

  it('rejects market outcomes without an explicit scoreline', () => {
    expect(parseFinalScore('draw')).toBeNull()
    expect(parseFinalScore('-2 win')).toBeNull()
    expect(parseFinalScore('')).toBeNull()
    expect(parseFinalScore(null)).toBeNull()
  })
})

describe('pointDistance', () => {
  it('separates closeness from correctness', () => {
    const near = pointDistance({ home: 3, away: 3 }, { home: 4, away: 3 })
    expect(near.l1).toBe(1)
    expect(near.totalDiff).toBe(-1)
    const far = pointDistance({ home: 2, away: 2 }, { home: 4, away: 0 })
    expect(far.l1).toBe(4)
    expect(far.marginDiff).toBe(-4)
  })
})

describe('read record tiers', () => {
  it('classifies a score bet with an actual score as R3 and keeps the distance', () => {
    const investment = makeInvestment({ matches: [] })
    const record = buildReadRecord(investment, makeMatch({ entries: [{ name: '3-3', odds: 9 }], results: '4-3' }), 0)
    expect(record.tier).toBe(READ_TIERS.R3)
    expect(record.primaryPoint).toEqual({ home: 3, away: 3 })
    expect(record.distance.l1).toBe(1)
  })

  it('honours an explicit predicted_score registration over entry text', () => {
    const record = buildReadRecord(
      makeInvestment(),
      makeMatch({ entries: [{ name: 'win', odds: 2 }], results: '2-0', predicted_score: { home: 2, away: 2 } }),
      0,
    )
    expect(record.tier).toBe(READ_TIERS.R3)
    expect(record.primaryPoint).toEqual({ home: 2, away: 2 })
    expect(record.registered).toBe(true)
    expect(record.minDistance).toBe(2)
  })

  it('classifies lined markets with an actual score as R2A and computes the line residual', () => {
    const record = buildReadRecord(makeInvestment(), makeMatch({ entries: [{ name: 'over2.5', odds: 2 }], results: '3-1' }), 0)
    expect(record.tier).toBe(READ_TIERS.R2A)
    expect(record.distance).toBeNull()
    expect(record.lineResiduals).toHaveLength(1)
    expect(record.lineResiduals[0].wonBy).toBeCloseTo(1.5, 6)
  })

  it('falls back to R1 when only the outcome is available', () => {
    const record = buildReadRecord(makeInvestment(), makeMatch({ entries: [{ name: 'lose', odds: 2 }], results: '2-0' }), 0)
    expect(record.tier).toBe(READ_TIERS.R1)
    expect(record.distance).toBeNull()
    expect(record.lineResiduals).toEqual([])
  })

  it('skips unsettled tickets entirely', () => {
    const pending = makeInvestment({ id: 'pending', status: 'pending', matches: [makeMatch()] })
    const settled = makeInvestment({ matches: [makeMatch()] })
    const records = buildReadRecords([pending, settled])
    expect(records).toHaveLength(1)
    expect(records[0].investmentId).toBe('inv-1')
  })
})

describe('forecast bias learning', () => {
  it('shrinks the raw ratio toward neutral by sample size', () => {
    expect(learnScaleBias([])).toMatchObject({ bias: 1, reliability: 0, n: 0 })
    const pairs = Array.from({ length: 20 }, () => ({ predicted: 1, actual: 1.5 }))
    const learned = learnScaleBias(pairs, { k: 8 })
    expect(learned.rawRatio).toBeCloseTo(1.5, 4)
    expect(learned.reliability).toBeCloseTo(20 / 28, 3)
    expect(learned.bias).toBeGreaterThan(1.2)
    expect(learned.bias).toBeLessThan(1.5)
  })

  it('recovers per-side direction from R3 records', () => {
    const investments = Array.from({ length: 12 }, (_, index) =>
      makeInvestment({
        id: `inv-${index}`,
        matches: [makeMatch({ id: `m-${index}`, entries: [{ name: '1-1', odds: 6 }], results: '3-1' })],
      }),
    )
    const bias = learnForecastBias(buildReadRecords(investments))
    expect(bias.sampleCount).toBe(12)
    expect(bias.home.bias).toBeGreaterThan(1.5)
    expect(bias.away.bias).toBeCloseTo(1, 6)
  })
})

describe('distribution derivation', () => {
  it('matches the Poisson pmf at the mean-zero case', () => {
    expect(poissonPmf(0, 1)).toBeCloseTo(Math.exp(-1), 10)
    expect(poissonPmf(2, 1) + poissonPmf(3, 1)).toBeGreaterThan(0)
  })

  it('produces coherent market probabilities from one distribution', () => {
    const { oneXTwo, totals, handicaps } = deriveMarketProbabilities(1.5, 1.2)
    // maxGoals=8 截断会损失 ~1e-5 的概率质量，容差取 3 位小数。
    expect(oneXTwo.home + oneXTwo.draw + oneXTwo.away).toBeCloseTo(1, 3)
    const line = totals.find((row) => row.line === 2.5)
    expect(line.over + line.under).toBeCloseTo(1, 3)
    expect(line.push).toBe(0)
    handicaps.forEach((row) => {
      expect(row.win + row.push + row.lose).toBeCloseTo(1, 3)
    })
    expect(oneXTwo.home).toBeGreaterThan(oneXTwo.away)
  })

  it('applies the bias to the registered point before the lambda mapping', () => {
    const lambda = pointForecastToLambda({ home: 2, away: 1 })
    expect(lambda.home).toBeCloseTo(0.7 * 2 + 0.3 * 1.45, 6)
    const calibrated = calibratedLambdaFromPoint({ home: 2, away: 1 }, { away: { bias: 1.5 } })
    expect(calibrated.away).toBeCloseTo(0.7 * 1.5 + 0.3 * 1.15, 6)
    expect(calibrated.home).toBeCloseTo(lambda.home, 6)
  })
})

describe('fusion weight', () => {
  const buildRows = ({ informative, n = 600, seed = 11 }) => {
    const rng = makeRng(seed)
    const rows = []
    for (let index = 0; index < n; index += 1) {
      const pConf = 0.15 + rng() * 0.7
      const pMarket = 0.2 + rng() * 0.6
      const signal = informative === 'conf' ? pConf : pMarket
      const pTrue = sigmoid(1.8 * logit(signal))
      rows.push({ pConf, pMarket, y: rng() < pTrue ? 1 : 0, index })
    }
    return rows
  }

  it('leans on conf when conf is the informative side', () => {
    const fit = fitFusionWeight(buildRows({ informative: 'conf' }))
    expect(fit.ready).toBe(true)
    expect(fit.w).toBeGreaterThan(0.6)
  })

  it('leans on the market when the market is the informative side', () => {
    const fit = fitFusionWeight(buildRows({ informative: 'market', seed: 23 }))
    expect(fit.ready).toBe(true)
    expect(fit.w).toBeLessThan(0.4)
  })

  it('reports unavailability instead of guessing on tiny samples', () => {
    expect(fitFusionWeight([{ pConf: 0.5, pMarket: 0.5, y: 1 }])).toMatchObject({ ready: false, n: 1 })
  })

  it('buckets disagreements without crashing on empty input', () => {
    const buckets = disagreementBuckets([])
    expect(buckets).toHaveLength(3)
    expect(buckets.every((bucket) => bucket.hitRate === null)).toBe(true)
  })
})

describe('legacy AJR intelligence', () => {
  it('aggregates hit rate and objective distance per AJR bucket', () => {
    const records = [
      { ajr: 0.8, isCorrect: true, conf: 0.6, minDistance: 0 },
      { ajr: 0.2, isCorrect: false, conf: 0.6, minDistance: 3 },
      { ajr: 0.2, isCorrect: false, conf: 0.4, minDistance: 2 },
    ]
    const buckets = legacyAjrBuckets(records)
    expect(buckets.length).toBe(4)
    const high = buckets.find((bucket) => bucket.label === '≥ 0.6')
    expect(high.hitRate).toBe(1)
    const low = buckets.find((bucket) => bucket.label === '0.2 ~ 0.4')
    expect(low.n).toBe(2)
    expect(low.hitRate).toBe(0)
    expect(low.avgMinDistance).toBeCloseTo(2.5, 6)
    const contrast = ajrObjectiveContrast(records)
    expect(contrast.n).toBe(3)
  })
})

describe('read-state probe', () => {
  it('declines to conclude on insufficient windows', () => {
    const records = Array.from({ length: 10 }, (_, index) => ({
      isCorrect: index % 2 === 0,
      conf: 0.5,
      date: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    }))
    expect(readStateAutocorrelation(records)).toMatchObject({ ready: false, verdict: 'insufficient' })
  })
})

describe('simulated calibration loop', () => {
  it('learns the synthetic bias and de-biases the lambda', () => {
    const sim = simulateCalibrationLoop({ matches: 220, seed: 7 })
    // 有偏的一侧：修正后必须显著更接近实际进球均值
    const away = sim.lambdaCalibration.away
    expect(Math.abs(away.raw - away.actual)).toBeGreaterThan(0.15)
    expect(Math.abs(away.calibrated - away.actual)).toBeLessThan(0.08)
    expect(Math.abs(away.calibrated - away.actual)).toBeLessThan(Math.abs(away.raw - away.actual))
    // 无偏的一侧：不允许学出大偏差（噪声容限内保持接近）
    const home = sim.lambdaCalibration.home
    expect(Math.abs(home.calibrated - home.actual)).toBeLessThan(0.12)
    expect(Math.abs(sim.finalBias.home - 1)).toBeLessThan(0.12)
    // θ 方向正确
    expect(sim.finalBias.away).toBeGreaterThan(1.2)
    // 全程平均损失有限（不构成证据，只保证管线健康）
    expect(Number.isFinite(sim.overallLoss.raw)).toBe(true)
    expect(Number.isFinite(sim.overallLoss.calibrated)).toBe(true)
  })
})

describe('scoreline distance shape', () => {
  const dist = (transform) => (a, b) =>
    scorelineDistance({ home: a[0], away: a[1] }, { home: b[0], away: b[1] }, { transform }).distance

  it.each(['sqrt', 'saturating', 'exponential'])('%s transform ranks the three reference cases correctly', (transform) => {
    const d = dist(transform)
    expect(d([4, 1], [3, 2])).toBeGreaterThan(d([3, 0], [5, 0]))
    expect(d([1, 0], [0, 1])).toBeGreaterThan(d([4, 1], [3, 2]))
  })

  it('is zero on an exact hit and symmetric when swapping the roles', () => {
    const d = dist('saturating')
    expect(d([2, 1], [2, 1])).toBe(0)
    expect(d([1, 0], [0, 1])).toBeCloseTo(d([0, 1], [1, 0]), 10)
  })

  it('keeps same-direction blowout drift cheaper than crossing the draw line', () => {
    const d = dist('saturating')
    expect(d([3, 0], [5, 0])).toBeLessThan(d([1, 0], [0, 0]))
    expect(d([2, 0], [3, 0])).toBeLessThan(d([1, 0], [0, 1]))
  })

  it('adds the total-goals term only through its weight knob', () => {
    const withTotal = scorelineDistance({ home: 1, away: 1 }, { home: 2, away: 2 }, { totalWeight: 0.5 }).distance
    const noTotal = scorelineDistance({ home: 1, away: 1 }, { home: 2, away: 2 }, { totalWeight: 0 }).distance
    expect(noTotal).toBe(0)
    expect(withTotal).toBeGreaterThan(0)
  })

  it('locks the chosen defaults (exponential · scale 1.8 · totalWeight 0.31)', () => {
    const d = (a, b) => scorelineDistance({ home: a[0], away: a[1] }, { home: b[0], away: b[1] }).distance
    const normalized = (a, b) =>
      scorelineDistance({ home: a[0], away: a[1] }, { home: b[0], away: b[1] }).normalizedDistance
    // 预测 0-1 的三档破坏程度：净胜球对/差1/差2
    expect(d([0, 1], [1, 2])).toBeCloseTo(0.1193, 3)
    expect(d([0, 1], [1, 3])).toBeCloseTo(0.3888, 3)
    expect(d([0, 1], [0, 3])).toBeCloseTo(0.5042, 3)
    // 标尺：反向一球 = 2×f(1) → 归一恒为 100
    expect(d([0, 1], [1, 0])).toBeCloseTo(0.8525, 3)
    expect(normalized([0, 1], [1, 0])).toBeCloseTo(100, 6)
    // 归一距离 = 展示口径（0 = 完美；可超过 100）
    expect(normalized([0, 1], [1, 2])).toBeCloseTo(14.0, 1)
    expect(normalized([0, 1], [1, 3])).toBeCloseTo(45.6, 1)
    expect(normalized([0, 1], [0, 3])).toBeCloseTo(59.1, 1)
    expect(normalized([2, 1], [2, 1])).toBe(0)
  })
})

describe('机构市场定价通道（去水 + 倒算）', () => {
  const makeQuotedOdds = (truth, vig = 1.05) => {
    const m = deriveMarketProbabilities(truth.home, truth.away)
    const ou = m.totals.find((row) => row.line === 2.5)
    return {
      oneXTwo: { home: 1 / (m.oneXTwo.home * vig), draw: 1 / (m.oneXTwo.draw * vig), away: 1 / (m.oneXTwo.away * vig) },
      totals: [{ line: 2.5, over: 1 / (ou.over * vig), under: 1 / (ou.under * vig) }],
    }
  }

  it('比例去水：公平概率和为 1，并回报抽水率', () => {
    const devig = deVigProportional([1.73, 4.12, 4.34])
    expect(devig.ok).toBe(true)
    expect(devig.fair.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10)
    // 1/1.73 + 1/4.12 + 1/4.34 = 0.5780 + 0.2427 + 0.2304 = 1.0512
    expect(devig.overround).toBeCloseTo(0.0512, 3)
    expect(deVigProportional([1.5, 'bad', 3]).ok).toBe(false)
    expect(deVigProportional([1.5, 0.9, 3]).ok).toBe(false)
  })

  it('从机构赔率倒算出的进球分布能还原真值 λ', () => {
    // 以真值 λ=(1.8, 1.05) 生成带 5% 抽水的赔率，再要求倒算把它找回
    const fit = fitMarketLambdas(makeQuotedOdds({ home: 1.8, away: 1.05 }))
    expect(fit.ready).toBe(true)
    expect(fit.samples).toBe(5)
    expect(fit.homeLambda).toBeCloseTo(1.8, 1)
    expect(fit.awayLambda).toBeCloseTo(1.05, 1)
    expect(fit.sse).toBeLessThan(0.001)
  })

  it('只给 1X2 也能倒算，不给的盘口不参与拟合', () => {
    const fit = fitMarketLambdas({ oneXTwo: makeQuotedOdds({ home: 2.2, away: 0.8 }).oneXTwo })
    expect(fit.ready).toBe(true)
    expect(fit.samples).toBe(3)
    expect(fit.homeLambda).toBeCloseTo(2.2, 1)
    expect(fit.awayLambda).toBeCloseTo(0.8, 1)
  })

  it('输入不足或赔率非法时明确不可用，不猜测', () => {
    expect(fitMarketLambdas({}).ready).toBe(false)
    expect(fitMarketLambdas({ oneXTwo: { home: 1.9, draw: 3.4, away: '' } }).ready).toBe(false)
    const partial = fitMarketLambdas({ oneXTwo: { home: 1.9, draw: 3.4, away: 4.2 }, totals: [{ line: 2.5, over: '', under: 2.1 }] })
    expect(partial.ready).toBe(true)
    expect(partial.targets.some((target) => target.label.includes('2.5'))).toBe(false)
    expect(partial.notes.join()).toContain('未参与倒算')
  })
})
