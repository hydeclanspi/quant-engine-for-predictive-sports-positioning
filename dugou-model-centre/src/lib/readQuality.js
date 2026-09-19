/**
 * ============================================================================
 *  readQuality.js — DuGou 2.0 原型：读球质量（Read Quality）与预测校准
 * ============================================================================
 *
 * 定位：把"主观 AJR 事后评分"升级成"赛前登记 + 赛后客观打分"的学习回路。
 *
 * ── 分辨率阶梯（按当场能给出的信息自动选最高档）────────────────────────
 *   R3  比分登记      赛前登记预测比分（或比分票本身）→ 训练双方进球分布
 *   R2A 盘口线自带    大小球/让球线天生是赛前登记 → 训练总进球/净胜球分布
 *   R2B 方向+强度     （预留）"主胜·轻松"这类粗粒度登记
 *   R1  仅结果        只有 conf + 命中 0/1 → 只喂二元校准管道（现状）
 *
 * ── 纪律 ────────────────────────────────────────────────────────────
 *   1. 距离分是损失函数，不是特征：赛后才知道的信息永不进入预测输入。
 *   2. 概率层的标签只有 is_correct；本模块产出的 θ/w 是"被损失训练出来的
 *      参数"，只有这些参数才允许进入未来预测。
 *   3. 一切收缩估计都向中性值（bias=1）收缩，并按样本量爬坡收敛。
 *
 * @module readQuality
 */

import { normalizeEntries } from './entryParsing.js'
import { estimateEntryUnionProbability } from './atomicParlay.js'

export const READ_TIERS = Object.freeze({
  R3: 'R3_scoreline',
  R2A: 'R2A_lined',
  R2B: 'R2B_intensity',
  R1: 'R1_binary',
})

export const READ_TIER_LABELS = Object.freeze({
  [READ_TIERS.R3]: 'R3 · 比分登记',
  [READ_TIERS.R2A]: 'R2A · 盘口线自带',
  [READ_TIERS.R2B]: 'R2B · 方向+强度（预留）',
  [READ_TIERS.R1]: 'R1 · 仅结果',
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const toNumber = (value, fallback = Number.NaN) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

// ── 基础解析 ──────────────────────────────────────────────────────────

/**
 * 解析实际比分。语义与 settlementQuickInput.parseResultScore 保持一致：
 * 只接受裸比分（"2-1" / "2:1" / "2：1"），拒绝 "-2 win"、"draw" 这类盘口结果。
 */
export const parseFinalScore = (text) => {
  const match = String(text ?? '').match(/(?:^|[^\d.])(\d{1,2})\s*[-:：]\s*(\d{1,2})(?![\d.])/)
  if (!match) return null
  const home = Number.parseInt(match[1], 10)
  const away = Number.parseInt(match[2], 10)
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null
  return { home, away }
}

const normalizePoint = (value) => {
  if (!value || typeof value !== 'object') return null
  const home = toNumber(value.home ?? value.homeGoals ?? value.home_goals, Number.NaN)
  const away = toNumber(value.away ?? value.awayGoals ?? value.away_goals, Number.NaN)
  if (!Number.isFinite(home) || !Number.isFinite(away) || home < 0 || away < 0) return null
  return { home, away }
}

const extractScorePoints = (entries) =>
  (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry.market_type === 'score' && entry.parse_detail)
    .map((entry) => normalizePoint(entry.parse_detail))
    .filter(Boolean)

const extractLineMarkets = (entries) =>
  (Array.isArray(entries) ? entries : [])
    .filter((entry) => (entry.market_type === 'handicap' || entry.market_type === 'total') && entry.parse_detail)
    .map((entry) => ({
      marketType: entry.market_type,
      line: toNumber(entry.parse_detail.line, Number.NaN),
      direction: entry.parse_detail.direction || null,
      outcome: entry.parse_detail.outcome || null,
    }))
    .filter((market) => Number.isFinite(market.line))

// ── 距离分（损失函数的原料）───────────────────────────────────────────

export const pointDistance = (predicted, actual) => {
  const dh = predicted.home - actual.home
  const da = predicted.away - actual.away
  const predictedTotal = predicted.home + predicted.away
  const actualTotal = actual.home + actual.away
  return {
    dh,
    da,
    l1: Math.abs(dh) + Math.abs(da),
    exact: dh === 0 && da === 0,
    predictedTotal,
    actualTotal,
    totalDiff: predictedTotal - actualTotal,
    marginDiff: (predicted.home - predicted.away) - (actual.home - actual.away),
  }
}

/** R2A：盘口线 vs 实际赛果的残差（wonBy > 0 表示按该盘口赢了多少球）。 */
export const lineResidual = (market, actual) => {
  const actualTotal = actual.home + actual.away
  if (market.marketType === 'total') {
    const raw = actualTotal - market.line
    return { raw, wonBy: market.direction === 'over' ? raw : -raw }
  }
  const adjustedMargin = actual.home - actual.away + market.line
  return { raw: adjustedMargin, wonBy: market.outcome === 'lose' ? -adjustedMargin : adjustedMargin }
}

// ── 读球记录（每条已结算腿 → 一条学习样本）────────────────────────────

export const buildReadRecord = (investment, match, index = 0) => {
  if (!investment || !match || typeof match !== 'object') return null
  const entries = normalizeEntries(match.entries, match.entry_text || match.entry || '', match.odds)
  if (entries.length === 0) return null

  const actual = normalizePoint(match.actual_score) || parseFinalScore(match.results)
  const registered = normalizePoint(match.predicted_score)
  const scorePoints = extractScorePoints(entries)
  const points = registered ? [registered, ...scorePoints] : scorePoints
  const primaryPoint = points[0] || null
  const lineMarkets = extractLineMarkets(entries)

  let tier = READ_TIERS.R1
  if (actual && points.length > 0) tier = READ_TIERS.R3
  else if (actual && lineMarkets.length > 0) tier = READ_TIERS.R2A

  const distances = actual ? points.map((point) => pointDistance(point, actual)) : []
  const residuals = actual ? lineMarkets.map((market) => ({ ...market, ...lineResidual(market, actual) })) : []

  return {
    key: `${investment.id}:${match.id ?? index}`,
    investmentId: String(investment.id || ''),
    date: investment.created_at || investment.createdAt || null,
    index,
    homeTeam: match.home_team || '',
    awayTeam: match.away_team || '',
    tier,
    markets: [...new Set(entries.map((entry) => entry.market_type))],
    entryNames: entries.map((entry) => entry.name),
    conf: toNumber(match.conf, Number.NaN),
    odds: toNumber(match.odds, Number.NaN),
    isCorrect: typeof match.is_correct === 'boolean' ? match.is_correct : null,
    ajr: toNumber(match.match_rating, Number.NaN),
    rep: toNumber(match.match_rep, Number.NaN),
    mode: match.mode || investment.mode || null,
    parlaySize: Number(investment.parlay_size || (investment.matches || []).length || 1),
    actual,
    points,
    primaryPoint,
    registered: Boolean(registered),
    distance: distances[0] || null,
    minDistance: distances.length > 0 ? Math.min(...distances.map((d) => d.l1)) : null,
    lineResiduals: residuals,
    marketProbability: (() => {
      try {
        const probability = estimateEntryUnionProbability(entries, match.odds)
        return Number.isFinite(probability) ? probability : null
      } catch {
        return null
      }
    })(),
  }
}

/** 已结算（win/lose）的票 → 逐腿读球记录。未结算记录没有标签，不参与学习。 */
export const buildReadRecords = (investments) => {
  const list = Array.isArray(investments) ? investments : []
  const records = []
  list.forEach((investment) => {
    if (investment?.status !== 'win' && investment?.status !== 'lose') return
    ;(investment.matches || []).forEach((match, index) => {
      const record = buildReadRecord(investment, match, index)
      if (record) records.push(record)
    })
  })
  return records
}

// ── 通道 1：个人预测偏差学习（收缩估计）──────────────────────────────

/**
 * 学一个乘性偏差 θ：Σ实际 / Σ预测，按 n/(n+k) 的可靠度向中性 1 收缩。
 * 返回的 bias 是"修正系数"：校准后的 λ = 登记值 × bias。
 */
export const learnScaleBias = (pairsInput, { k = 8 } = {}) => {
  const pairs = (Array.isArray(pairsInput) ? pairsInput : []).filter(
    (pair) => Number.isFinite(pair?.predicted) && pair.predicted > 0 && Number.isFinite(pair?.actual) && pair.actual >= 0,
  )
  if (pairs.length === 0) {
    return { bias: 1, reliability: 0, n: 0, sumPredicted: 0, sumActual: 0, rawRatio: 1 }
  }
  const sumPredicted = pairs.reduce((sum, pair) => sum + pair.predicted, 0)
  const sumActual = pairs.reduce((sum, pair) => sum + pair.actual, 0)
  const rawRatio = sumPredicted > 0 ? sumActual / sumPredicted : 1
  const reliability = pairs.length / (pairs.length + Math.max(0, k))
  const bias = Math.exp(reliability * Math.log(clamp(rawRatio, 0.35, 2.8)))
  return {
    bias: Number(bias.toFixed(4)),
    reliability: Number(reliability.toFixed(3)),
    n: pairs.length,
    sumPredicted: Number(sumPredicted.toFixed(2)),
    sumActual: Number(sumActual.toFixed(2)),
    rawRatio: Number(rawRatio.toFixed(4)),
  }
}

/** 从 R3 记录学主客队/test 总进球的偏差（主判定 = 用户第一个比分）。 */
export const learnForecastBias = (recordsInput, { k = 8 } = {}) => {
  const records = (Array.isArray(recordsInput) ? recordsInput : []).filter(
    (record) => record?.tier === READ_TIERS.R3 && record.actual && record.primaryPoint,
  )
  const homePairs = records.map((record) => ({ predicted: record.primaryPoint.home, actual: record.actual.home }))
  const awayPairs = records.map((record) => ({ predicted: record.primaryPoint.away, actual: record.actual.away }))
  const totalPairs = records.map((record) => ({
    predicted: record.primaryPoint.home + record.primaryPoint.away,
    actual: record.actual.home + record.actual.away,
  }))
  return {
    home: learnScaleBias(homePairs, { k }),
    away: learnScaleBias(awayPairs, { k }),
    total: learnScaleBias(totalPairs, { k }),
    sampleCount: records.length,
    k,
  }
}

// ── 通道 2：从登记分布推导市场概率 ────────────────────────────────────

const lnFactorial = (n) => {
  let sum = 0
  for (let i = 2; i <= n; i += 1) sum += Math.log(i)
  return sum
}

export const poissonPmf = (k, lambda) => {
  const goalCount = Math.max(0, Math.round(Number(k)))
  const mean = Number(lambda)
  if (!Number.isFinite(mean) || mean < 0) return 0
  if (mean === 0) return goalCount === 0 ? 1 : 0
  return Math.exp(-mean + goalCount * Math.log(mean) - lnFactorial(goalCount))
}

export const deriveScoreDistribution = (homeLambda, awayLambda, maxGoals = 8) => {
  const homeP = []
  const awayP = []
  for (let goals = 0; goals <= maxGoals; goals += 1) {
    homeP.push(poissonPmf(goals, homeLambda))
    awayP.push(poissonPmf(goals, awayLambda))
  }
  const cells = []
  for (let home = 0; home <= maxGoals; home += 1) {
    for (let away = 0; away <= maxGoals; away += 1) {
      cells.push({ home, away, p: homeP[home] * awayP[away] })
    }
  }
  return cells
}

/**
 * 用一份（主/客）进球分布推导任意盘口概率。这就是"通道 2"的输出形态：
 * 登记一次读法 → 所有盘口共享同一个分布。
 */
export const deriveMarketProbabilities = (
  homeLambda,
  awayLambda,
  { maxGoals = 8, totalLines = [1.5, 2.5, 3.5], handicapLines = [-1, 0, 1] } = {},
) => {
  const cells = deriveScoreDistribution(homeLambda, awayLambda, maxGoals)
  const sum = (predicate) => cells.reduce((acc, cell) => acc + (predicate(cell) ? cell.p : 0), 0)
  const oneXTwo = {
    home: sum((c) => c.home > c.away),
    draw: sum((c) => c.home === c.away),
    away: sum((c) => c.home < c.away),
  }
  const totals = totalLines.map((line) => ({
    line,
    over: sum((c) => c.home + c.away > line),
    push: sum((c) => c.home + c.away === line),
    under: sum((c) => c.home + c.away < line),
  }))
  const handicaps = handicapLines.map((line) => ({
    line,
    win: sum((c) => c.home + line > c.away),
    push: sum((c) => c.home + line === c.away),
    lose: sum((c) => c.home + line < c.away),
  }))
  const topScores = [...cells]
    .sort((a, b) => b.p - a.p)
    .slice(0, 6)
    .map((cell) => ({ score: `${cell.home}-${cell.away}`, p: cell.p }))
  return { oneXTwo, totals, handicaps, topScores }
}

export const DEFAULT_LAMBDA_PRIOR = Object.freeze({ home: 1.45, away: 1.15 })

/**
 * 把"登记的一个比分"变成一份进球分布的均值的 MVP 映射：
 * 点预测与联赛先验先做权重混合（默认 0.7/0.3），再加下限保护。
 * 系统性偏差由通道 1 的 θ 修正——θ 正是在校准这层映射。
 */
export const pointForecastToLambda = (point, { prior = DEFAULT_LAMBDA_PRIOR, weight = 0.7, min = 0.15 } = {}) => ({
  home: Math.max(min, weight * point.home + (1 - weight) * prior.home),
  away: Math.max(min, weight * point.away + (1 - weight) * prior.away),
})

export const applyGoalBias = (lambda, biasModel) => ({
  home: lambda.home * (Number.isFinite(biasModel?.home?.bias) ? biasModel.home.bias : 1),
  away: lambda.away * (Number.isFinite(biasModel?.away?.bias) ? biasModel.away.bias : 1),
})

/**
 * θ 学自"登记点 vs 实际进球"这对关系，因此先修正登记值本身，
 * 再走 point → λ 映射（避免在同一处叠加两次修正）。
 */
export const calibratedLambdaFromPoint = (point, biasModel, options) => {
  const corrected = applyGoalBias(point, biasModel)
  return pointForecastToLambda(corrected, options)
}

// ── 通道 3：融合权重（唯一用二元标签的训练）───────────────────────────

export const logit = (p) => {
  const clamped = clamp(toNumber(p, 0.5), 1e-6, 1 - 1e-6)
  return Math.log(clamped / (1 - clamped))
}

export const sigmoid = (x) => 1 / (1 + Math.exp(-x))

const logLossRow = (p, y) => {
  const clamped = clamp(p, 1e-9, 1 - 1e-9)
  return -(y * Math.log(clamped) + (1 - y) * Math.log(1 - clamped))
}

const buildFusionRows = (rowsInput) =>
  (Array.isArray(rowsInput) ? rowsInput : [])
    .map((row, index) => ({
      pConf: toNumber(row?.pConf ?? row?.conf, Number.NaN),
      pMarket: toNumber(row?.pMarket ?? row?.market, Number.NaN),
      y: row?.y ?? row?.isCorrect,
      index: Number.isFinite(row?.index) ? row.index : index,
    }))
    .filter(
      (row) =>
        Number.isFinite(row.pConf) && row.pConf > 0 && row.pConf < 1 &&
        Number.isFinite(row.pMarket) && row.pMarket > 0 && row.pMarket < 1 &&
        (row.y === 0 || row.y === 1),
    )
    .sort((a, b) => a.index - b.index)

const evaluateFusion = (rows, w, c) => {
  let logLoss = 0
  let brier = 0
  rows.forEach((row) => {
    const p = sigmoid(w * logit(row.pConf) + (1 - w) * logit(row.pMarket) + c)
    logLoss += logLossRow(p, row.y)
    brier += (p - row.y) ** 2
  })
  return { logLoss: logLoss / rows.length, brier: brier / rows.length }
}

/**
 * 在时间切分的前一段上拟合融合权重 w，在后一段上对比三个策略：
 * conf-only / market-only / fusion。w 就是"你的判断相对市场值多少权重"。
 */
export const fitFusionWeight = (rowsInput, { trainRatio = 0.7 } = {}) => {
  const rows = buildFusionRows(rowsInput)
  if (rows.length < 20) return { ready: false, n: rows.length }

  const splitIndex = Math.max(8, Math.min(rows.length - 8, Math.floor(rows.length * trainRatio)))
  const train = rows.slice(0, splitIndex)
  const test = rows.slice(splitIndex)
  if (train.length < 8 || test.length < 8) return { ready: false, n: rows.length }

  const search = (data, wLow, wHigh, cLow, cHigh, wStep, cStep) => {
    let best = { w: 0.5, c: 0, logLoss: Number.POSITIVE_INFINITY }
    for (let w = wLow; w <= wHigh + 1e-9; w += wStep) {
      for (let c = cLow; c <= cHigh + 1e-9; c += cStep) {
        const { logLoss } = evaluateFusion(data, w, c)
        if (logLoss < best.logLoss) best = { w, c, logLoss }
      }
    }
    return best
  }

  const coarse = search(train, 0, 1, -0.4, 0.4, 0.05, 0.05)
  const fine = search(
    train,
    Math.max(0, coarse.w - 0.06),
    Math.min(1, coarse.w + 0.06),
    coarse.c - 0.06,
    coarse.c + 0.06,
    0.01,
    0.01,
  )

  return {
    ready: true,
    n: rows.length,
    trainN: train.length,
    testN: test.length,
    w: Number(fine.w.toFixed(4)),
    intercept: Number(fine.c.toFixed(4)),
    train: evaluateFusion(train, fine.w, fine.c),
    test: {
      fusion: evaluateFusion(test, fine.w, fine.c),
      confOnly: evaluateFusion(test, 1, 0),
      marketOnly: evaluateFusion(test, 0, 0),
    },
  }
}

/** 按 |conf − 市场| 分桶看命中率：分歧大时谁更对。 */
export const disagreementBuckets = (rowsInput, edges = [0.05, 0.15]) => {
  const rows = buildFusionRows(rowsInput)
  const buckets = [
    { label: `< ${edges[0]}`, min: 0, max: edges[0], n: 0, hits: 0, confSum: 0, marketSum: 0 },
    { label: `${edges[0]} ~ ${edges[1]}`, min: edges[0], max: edges[1], n: 0, hits: 0, confSum: 0, marketSum: 0 },
    { label: `≥ ${edges[1]}`, min: edges[1], max: Number.POSITIVE_INFINITY, n: 0, hits: 0, confSum: 0, marketSum: 0 },
  ]
  rows.forEach((row) => {
    const disagreement = Math.abs(row.pConf - row.pMarket)
    const bucket = buckets.find((item) => disagreement >= item.min && disagreement < item.max) || buckets[buckets.length - 1]
    bucket.n += 1
    if (row.y === 1) bucket.hits += 1
    bucket.confSum += row.pConf
    bucket.marketSum += row.pMarket
  })
  return buckets.map((bucket) => ({
    label: bucket.label,
    n: bucket.n,
    hitRate: bucket.n > 0 ? bucket.hits / bucket.n : null,
    avgConf: bucket.n > 0 ? bucket.confSum / bucket.n : null,
    avgMarket: bucket.n > 0 ? bucket.marketSum / bucket.n : null,
  }))
}

// ── Legacy 情报：1.0 数据里的 AJR 有没有信号 ─────────────────────────

export const pearsonCorrelation = (xs, ys) => {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 3) return null
  const n = xs.length
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n
  let numerator = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    numerator += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  const denominator = Math.sqrt(varX * varY)
  if (!Number.isFinite(denominator) || denominator === 0) return null
  return numerator / denominator
}

export const legacyAjrBuckets = (recordsInput) => {
  const records = (Array.isArray(recordsInput) ? recordsInput : []).filter((record) => Number.isFinite(record?.ajr))
  const buckets = [
    { label: '< 0.2', min: -1, max: 0.2 },
    { label: '0.2 ~ 0.4', min: 0.2, max: 0.4 },
    { label: '0.4 ~ 0.6', min: 0.4, max: 0.6 },
    { label: '≥ 0.6', min: 0.6, max: Number.POSITIVE_INFINITY },
  ].map((bucket) => ({ ...bucket, n: 0, hits: 0, labeled: 0, confSum: 0, confCount: 0, distanceSum: 0, distanceCount: 0 }))

  records.forEach((record) => {
    const bucket = buckets.find((item) => record.ajr >= item.min && record.ajr < item.max) || buckets[buckets.length - 1]
    bucket.n += 1
    if (record.isCorrect === true) bucket.hits += 1
    if (typeof record.isCorrect === 'boolean') bucket.labeled += 1
    if (Number.isFinite(record.conf)) {
      bucket.confSum += record.conf
      bucket.confCount += 1
    }
    if (Number.isFinite(record.minDistance)) {
      bucket.distanceSum += record.minDistance
      bucket.distanceCount += 1
    }
  })

  return buckets.map((bucket) => ({
    label: bucket.label,
    n: bucket.n,
    hitRate: bucket.labeled > 0 ? bucket.hits / bucket.labeled : null,
    avgConf: bucket.confCount > 0 ? bucket.confSum / bucket.confCount : null,
    avgMinDistance: bucket.distanceCount > 0 ? bucket.distanceSum / bucket.distanceCount : null,
  }))
}

/** AJR 与客观距离在同一批 R3 记录上的相关（主观 vs 客观是否一致）。 */
export const ajrObjectiveContrast = (recordsInput) => {
  const records = (Array.isArray(recordsInput) ? recordsInput : []).filter(
    (record) => Number.isFinite(record?.ajr) && Number.isFinite(record?.minDistance),
  )
  return {
    n: records.length,
    correlation: pearsonCorrelation(records.map((record) => record.ajr), records.map((record) => record.minDistance)),
  }
}

// ── 通道 4 探针：近期读球状态是否有惯性 ──────────────────────────────

export const readStateAutocorrelation = (recordsInput, { windowSize = 12, minWindows = 6 } = {}) => {
  const rows = (Array.isArray(recordsInput) ? recordsInput : [])
    .filter((record) => typeof record?.isCorrect === 'boolean' && Number.isFinite(record?.conf) && record?.date)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const windowLosses = []
  for (let start = 0; start + windowSize <= rows.length; start += windowSize) {
    const chunk = rows.slice(start, start + windowSize)
    windowLosses.push(chunk.reduce((sum, record) => sum + (record.conf - (record.isCorrect ? 1 : 0)) ** 2, 0) / chunk.length)
  }
  if (windowLosses.length < minWindows) {
    return { ready: false, windows: windowLosses.length, minWindows, verdict: 'insufficient' }
  }
  const correlation = pearsonCorrelation(windowLosses.slice(0, -1), windowLosses.slice(1))
  const verdict = correlation === null || Math.abs(correlation) < 0.35 ? 'no_clear_signal' : correlation > 0 ? 'persistent' : 'mean_reverting'
  return {
    ready: true,
    windows: windowLosses.length,
    windowLosses: windowLosses.map((value) => Number(value.toFixed(4))),
    correlation: correlation === null ? null : Number(correlation.toFixed(4)),
    verdict,
  }
}

// ── 合成模拟：校准回路的端到端机制证明 ───────────────────────────────

const createSeededRng = (seedInput = 1) => {
  let seed = (Number(seedInput) >>> 0) || 1
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const samplePoisson = (lambda, rng) => {
  const limit = Math.exp(-lambda)
  let goals = 0
  let product = 1
  do {
    goals += 1
    product *= rng()
  } while (product > limit)
  return goals - 1
}

/**
 * 合成一个"有系统性偏差的读球者"，跑 N 场"登记比分 → 结算 → 更新 θ →
 * 下次用校准后分布"的完整回路，验证：θ 能不能学到、损失会不会降。
 * 纯机制演示（合成数据），不代表任何真实数据结论。
 */
export const simulateCalibrationLoop = ({
  matches = 150,
  seed = 20260219,
  trueAwayBias = 0.72,
  k = 8,
  windowSize = 25,
} = {}) => {
  const rng = createSeededRng(seed)
  const sums = { pointHome: 0, pointAway: 0, actualHome: 0, actualAway: 0 }
  const lambdaSums = { rawHome: 0, rawAway: 0, calibratedHome: 0, calibratedAway: 0 }
  const losses = []
  const biasTrail = []

  for (let i = 0; i < matches; i += 1) {
    // 合成联赛的场均进球恰等于模块先验（主 1.45 / 客 1.15），
    // 这样"校准没有改善"就不可能来自先验本身失配。
    const lambdaHome = 1.45 * (0.55 + rng() * 0.9)
    const lambdaAway = 1.15 * (0.5 + rng() * 1.0)
    const actual = { home: samplePoisson(lambdaHome, rng), away: samplePoisson(lambdaAway, rng) }
    const point = {
      home: Math.max(0, Math.round(lambdaHome * (0.95 + rng() * 0.1))),
      away: Math.max(0, Math.round(lambdaAway * trueAwayBias * (0.9 + rng() * 0.2))),
    }

    const homeBias = sums.pointHome > 0 ? clamp(sums.actualHome / sums.pointHome, 0.35, 2.8) : 1
    const awayBias = sums.pointAway > 0 ? clamp(sums.actualAway / sums.pointAway, 0.35, 2.8) : 1
    const reliability = i / (i + k)
    const shrunkHome = Math.exp(reliability * Math.log(homeBias))
    const shrunkAway = Math.exp(reliability * Math.log(awayBias))

    const rawLambda = pointForecastToLambda(point)
    const calibrated = calibratedLambdaFromPoint(point, { home: { bias: shrunkHome }, away: { bias: shrunkAway } })
    lambdaSums.rawHome += rawLambda.home
    lambdaSums.rawAway += rawLambda.away
    lambdaSums.calibratedHome += calibrated.home
    lambdaSums.calibratedAway += calibrated.away
    const rawP = poissonPmf(actual.home, rawLambda.home) * poissonPmf(actual.away, rawLambda.away)
    const calibratedP = poissonPmf(actual.home, calibrated.home) * poissonPmf(actual.away, calibrated.away)

    losses.push({
      raw: -Math.log(Math.max(rawP, 1e-12)),
      calibrated: -Math.log(Math.max(calibratedP, 1e-12)),
    })

    sums.pointHome += point.home
    sums.pointAway += point.away
    sums.actualHome += actual.home
    sums.actualAway += actual.away
    if (i % 10 === 0) biasTrail.push({ i: i + 1, home: Number(shrunkHome.toFixed(3)), away: Number(shrunkAway.toFixed(3)) })
  }

  const meanOf = (list) => (list.length > 0 ? list.reduce((sum, value) => sum + value, 0) / list.length : 0)
  const firstWindow = losses.slice(0, windowSize)
  const lastWindow = losses.slice(-windowSize)

  return {
    matches,
    trueAwayBias,
    expectedAwayCorrection: Number((1 / trueAwayBias).toFixed(3)),
    finalBias: {
      home: sums.pointHome > 0 ? Number((sums.actualHome / sums.pointHome).toFixed(3)) : 1,
      away: sums.pointAway > 0 ? Number((sums.actualAway / sums.pointAway).toFixed(3)) : 1,
    },
    // λ 校准表：未校准均值 / 校准后均值 / 实际进球均值 —— "自动赋能"的直接证据
    lambdaCalibration: {
      home: {
        raw: Number((lambdaSums.rawHome / matches).toFixed(3)),
        calibrated: Number((lambdaSums.calibratedHome / matches).toFixed(3)),
        actual: Number((sums.actualHome / matches).toFixed(3)),
      },
      away: {
        raw: Number((lambdaSums.rawAway / matches).toFixed(3)),
        calibrated: Number((lambdaSums.calibratedAway / matches).toFixed(3)),
        actual: Number((sums.actualAway / matches).toFixed(3)),
      },
    },
    // 全程平均对数损失（单场量级 ~2.9 纳特，系统性修正只占其中很小一块，
    // 窗口级差异基本被泊松噪声淹没——证据以 λ 校准表为准）
    overallLoss: {
      raw: meanOf(losses.map((entry) => entry.raw)),
      calibrated: meanOf(losses.map((entry) => entry.calibrated)),
    },
    firstWindow: { raw: meanOf(firstWindow.map((entry) => entry.raw)), calibrated: meanOf(firstWindow.map((entry) => entry.calibrated)) },
    lastWindow: { raw: meanOf(lastWindow.map((entry) => entry.raw)), calibrated: meanOf(lastWindow.map((entry) => entry.calibrated)) },
    biasTrail,
  }
}

export const __testables = {
  buildFusionRows,
  evaluateFusion,
  createSeededRng,
  samplePoisson,
}
