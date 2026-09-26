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

const text = (value) => String(value ?? '').trim()

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

// ── 比分距离（2.0）：把"足球含义"写进惩罚形状 ─────────────────────────
//
// 口径（已确认，锁定 2026-09）：transform=exponential，scale=1.8，
// totalWeight=0.31。取代早期的 L1 版 pointDistance（后者仅保留作对照）。
//
// 需求（来自真实使用反馈的迭代）：
//   ① 同方向、大分差之间（3-0 → 5-0）几乎没有本质区别 → 高区要"几乎封顶"；
//   ② 跨过平局线（1-0 → 0-1）是质变 → 变换保号、过零，符号翻转处罚大；
//   ③ 险胜区间差 2 球（4-1 → 3-2）比大胜区间差 2 球更扎眼 → 低区要陡；
//   ④ 平局变大胜（2-2 → 4-0）要重于一球方向反转 → 0→4 的跨度要足够长。
// ①②③④ 合起来 = "低区最陡、高区几乎平" = 指数饱和（起步快、封顶早）。
//
// 三个候选（同一族递增凹函数，区别在"封不封顶、封得多快"）：
//   sqrt        — 无界压缩：一直涨、越来越慢（早期候选）
//   saturating  — 有界压缩（softsign）：中段近似线性，趋近 ±1
//   exponential — 指数饱和：低区最陡、高区最平（当前默认）
//
// 关于 scale（=1.8）：指数饱和的"球数尺度"——净胜球差达到 scale 时，函数
// 走到封顶值的 1−e^(−1) ≈ 63%。它由需求 ④ 反推而来：要求 2-2→4-0 高于标尺
// 100 ⟺ f(4)/f(1) > 2 ⟺ scale > 1.68；取 1.8 让该案例落在 104 上下。
//
// 关于 totalWeight（=0.31）：总进球维度值多少。0.31 让 1-1→5-5 有可见差别
// （≈11.8），又不至于把 0-0→3-0（≈124.6）、1-0→4-0（≈71.5）抬得过多。
//
// 接线备忘（尚未接线）：① 训练信号——读球信任度/区域模型的损失原料
// （接法：θ 的更新梯度 = 实际距离 − 期望距离）；② 展示——复盘面板的
// "读球质量分"（用 normalizedDistance）。它赛后才有 → 永不作为预测特征；
// 它不是概率 → 不进 Kelly。
export const SCORELINE_EXPONENTIAL_SCALE = 1.8
export const SCORELINE_TRANSFORMS = Object.freeze({
  sqrt: (value) => Math.sign(value) * Math.sqrt(Math.abs(value)),
  saturating: (value) => value / (1 + Math.abs(value)),
  exponential: (value) =>
    Math.sign(value) * (1 - Math.exp(-Math.abs(value) / SCORELINE_EXPONENTIAL_SCALE)),
})

// 锁定口径：展示与训练都以这三个数为准，改动前先想清楚
export const SCORELINE_DISTANCE_DEFAULTS = Object.freeze({
  transform: 'exponential',
  totalWeight: 0.31,
  exponentialScale: SCORELINE_EXPONENTIAL_SCALE,
})

const resolveScorelineTransform = (transform, exponentialScale) => {
  if (typeof transform === 'function') return transform
  if (transform === 'exponential') {
    return (value) => Math.sign(value) * (1 - Math.exp(-Math.abs(value) / exponentialScale))
  }
  return SCORELINE_TRANSFORMS[transform] || SCORELINE_TRANSFORMS.exponential
}

/**
 * 比分距离：d = |f(净胜球差)| + totalWeight · |f(总进球差)|，f 取凹变换。
 * 输入约定：两个 { home, away }，均为 ≥0 的有限数字（调用方先用
 * normalizePoint / buildReadRecord 校验；无效输入会得到 NaN）。
 *
 * 返回：
 *   marginDistance     净胜球维度贡献
 *   totalDistance      总进球维度贡献
 *   distance           合计 d
 *   normalizedDistance 归一距离：以「预测 1-0、实际 0-1」（一球方向反转）
 *                      为 100 的标尺；0 = 完全命中，可超过 100（方向错且
 *                      幅度也错时）。它是"破坏程度"刻度，不是上限 100
 *                      的分数，也不是概率。
 */
export const scorelineDistance = (predicted, actual, options = {}) => {
  const { transform, totalWeight, exponentialScale } = { ...SCORELINE_DISTANCE_DEFAULTS, ...options }
  const fn = resolveScorelineTransform(transform, exponentialScale)
  const predictedMargin = predicted.home - predicted.away
  const actualMargin = actual.home - actual.away
  const predictedTotal = predicted.home + predicted.away
  const actualTotal = actual.home + actual.away
  const marginDistance = Math.abs(fn(predictedMargin) - fn(actualMargin))
  const totalDistance = Math.abs(fn(predictedTotal) - fn(actualTotal))
  const distance = marginDistance + totalWeight * totalDistance
  const unit = 2 * fn(1) // 标尺：一球方向反转 = 2·f(1)
  return {
    marginDistance,
    totalDistance,
    distance,
    normalizedDistance: unit > 0 ? (distance / unit) * 100 : 0,
  }
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

// ── 通道 5：团队级、分主客场的在线偏差学习（2026-09-25 决策）────────────────
//
// 与通道 1（learnForecastBias）的区别：那套是全局每侧一个比值（把"主队"和"客队"
// 各看成一锅），这套是**按球队 + 按主客场**学"我对这支队在这块场地的进球估计
// 偏了多少"。设计要点（全部按拍板口径）：
//   · 每结算一场就学一次，不攒、不取全局均值；
//   · 时间近因用固定桶（近 3 / 3-6 / 6-10 / 10-14 / 14-20 / 20+ 场）；
//   · 一场同时给主队和客队各贡献一个带方向的误差（实际进球 − 我登记的进球）；
//   · 下一场主队的偏差 = 0.7×该队主场偏差 + 0.3×该队客场偏差（vice versa）。
//     主场历史与客场历史是同一支球队的两份相关样本，不装独立，固定 70/30 混合。
//   · 样本不足时向 0 收缩（可靠度 = n/(n+k)），完全没有 → 退到全局每侧偏差。
// 误差是加性的（实际 − 登记），不是比值：登记 0 也能学，不存在 0×θ=0 的盲区。

export const TEAM_BIAS_RECENCY_WEIGHTS = [1.6, 1.35, 1.15, 1.0, 0.9, 0.8]
export const TEAM_BIAS_RECENCY_CUTS = [3, 6, 10, 14, 20]
export const TEAM_BIAS_VENUE_BLEND = 0.7

const recencyWeightForAge = (ageInMatches) => {
  for (let i = 0; i < TEAM_BIAS_RECENCY_CUTS.length; i++) {
    if (ageInMatches < TEAM_BIAS_RECENCY_CUTS[i]) return TEAM_BIAS_RECENCY_WEIGHTS[i]
  }
  return TEAM_BIAS_RECENCY_WEIGHTS[TEAM_BIAS_RECENCY_WEIGHTS.length - 1]
}

const newBiasStream = () => ({ weightedSum: 0, weightTotal: 0, n: 0 })

const closeBiasStream = (stream, k) => {
  const reliability = stream.n / (stream.n + k)
  const rawBias = stream.weightTotal > 0 ? stream.weightedSum / stream.weightTotal : 0
  return { bias: rawBias, reliability: Number(reliability.toFixed(3)), n: stream.n }
}

export const learnTeamBias = (recordsInput, { k = 8 } = {}) => {
  const records = (Array.isArray(recordsInput) ? recordsInput : [])
    .filter((record) => record?.actual && record?.primaryPoint)
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const teams = new Map()
  const globalStreams = { home: newBiasStream(), away: newBiasStream() }

  const push = (stream, age, error) => {
    const w = recencyWeightForAge(age)
    stream.weightedSum += error * w
    stream.weightTotal += w
    stream.n += 1
  }

  records.forEach((record, age) => {
    const homeTeam = text(record.homeTeam)
    const awayTeam = text(record.awayTeam)
    if (!homeTeam || !awayTeam) return
    if (!teams.has(homeTeam)) teams.set(homeTeam, { home: newBiasStream(), away: newBiasStream() })
    if (!teams.has(awayTeam)) teams.set(awayTeam, { home: newBiasStream(), away: newBiasStream() })

    const homeError = record.actual.home - record.primaryPoint.home
    const awayError = record.actual.away - record.primaryPoint.away
    push(teams.get(homeTeam).home, age, homeError)
    push(teams.get(awayTeam).away, age, awayError)
    push(globalStreams.home, age, homeError)
    push(globalStreams.away, age, awayError)
  })

  const closed = new Map()
  teams.forEach((streams, team) => {
    closed.set(team, { home: closeBiasStream(streams.home, k), away: closeBiasStream(streams.away, k) })
  })
  const global = { home: closeBiasStream(globalStreams.home, k), away: closeBiasStream(globalStreams.away, k) }

  return {
    teams: closed,
    global,
    sampleCount: records.length,
    k,
  }
}

/**
 * 取"下一场"的修正量：按主客场 70/30 合成，再按可靠度收缩。
 * venue 指球队下一场踢的场地（'home' 主场 / 'away' 客场）。
 */
export const getTeamBias = (biasModel, teamName, venue) => {
  const side = venue === 'away' ? 'away' : 'home'
  const other = side === 'away' ? 'home' : 'away'
  const entry = biasModel?.teams?.get(text(teamName))
  const w = TEAM_BIAS_VENUE_BLEND

  if (!entry || (entry[side].n === 0 && entry[other].n === 0)) {
    const fallback = biasModel?.global?.[side]
    if (!fallback || fallback.n === 0) return { bias: 0, reliability: 0, n: 0, basis: 'none' }
    return { bias: fallback.bias * fallback.reliability, reliability: fallback.reliability, n: fallback.n, basis: 'global' }
  }
  const bias = w * entry[side].bias + (1 - w) * entry[other].bias
  const reliability = w * entry[side].reliability + (1 - w) * entry[other].reliability
  const n = entry[side].n + entry[other].n
  return { bias: bias * reliability, reliability: Number(reliability.toFixed(3)), n, basis: 'team' }
}

/** 把登记比分按团队偏差修正成 expected actual（加性，主客分开算）。 */
export const applyTeamBias = (point, { homeTeam, awayTeam, biasModel } = {}) => {
  const homeBias = getTeamBias(biasModel, homeTeam, 'home')
  const awayBias = getTeamBias(biasModel, awayTeam, 'away')
  return {
    home: Math.max(0, point.home + homeBias.bias),
    away: Math.max(0, point.away + awayBias.bias),
    homeBias,
    awayBias,
  }
}

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
  return marketProbabilitiesFromCells(cells, { totalLines, handicapLines })
}

/**
 * 同一套盘口推导，直接吃一份比分分布（不要求它来自泊松）。
 * 投前的「进球区间 + 浓度」权重就是走这条：权重先合成比分分布，再推出各盘口概率。
 */
export const marketProbabilitiesFromCells = (
  cellsInput,
  { totalLines = [1.5, 2.5, 3.5], handicapLines = [-1, 0, 1] } = {},
) => {
  const cells = Array.isArray(cellsInput) ? cellsInput : []
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

// ── 通道 4：机构市场定价（去水 + 倒算进球分布）─────────────────────────
//
// 与通道 2 相反：通道 2 是「我的观点 → 各盘口」，这里是「机构赔率 → 一场比赛
// 的进球分布」。市场侧的赔率是唯一的元数据来源；本模块自己不产生任何赔率。

/** 比例去水：把一组赔率还原成和为 1 的公平概率，同时返回抽水率。 */
export const deVigProportional = (oddsList) => {
  const implied = (Array.isArray(oddsList) ? oddsList : []).map((odds) => {
    const value = Number(odds)
    return Number.isFinite(value) && value > 1 ? 1 / value : Number.NaN
  })
  if (implied.some((value) => !Number.isFinite(value))) return { ok: false, overround: Number.NaN, fair: [] }
  const sum = implied.reduce((acc, value) => acc + value, 0)
  if (!(sum > 0)) return { ok: false, overround: Number.NaN, fair: [] }
  return {
    ok: true,
    overround: Number((sum - 1).toFixed(4)),
    fair: implied.map((value) => value / sum),
  }
}

const marketTargetsFromInput = (input = {}) => {
  const targets = []
  const notes = []

  const oneXTwoOdds = input.oneXTwo
  if (oneXTwoOdds) {
    const devig = deVigProportional([oneXTwoOdds.home, oneXTwoOdds.draw, oneXTwoOdds.away])
    if (devig.ok) {
      targets.push({ key: 'home', label: '主胜', value: devig.fair[0] })
      targets.push({ key: 'draw', label: '平', value: devig.fair[1] })
      targets.push({ key: 'away', label: '客胜', value: devig.fair[2] })
    } else {
      notes.push('1X2 赔率不完整或非十进制，未参与倒算')
    }
  }

  ;(Array.isArray(input.totals) ? input.totals : []).forEach((row) => {
    const devig = deVigProportional([row?.over, row?.under])
    if (devig.ok && Number.isFinite(Number(row?.line))) {
      targets.push({ key: `over:${Number(row.line)}`, label: `大 ${Number(row.line)}`, value: devig.fair[0] })
      targets.push({ key: `under:${Number(row.line)}`, label: `小 ${Number(row.line)}`, value: devig.fair[1] })
    } else {
      notes.push(`大小球 ${row?.line ?? '?'} 赔率需两边都给，未参与倒算`)
    }
  })

  ;(Array.isArray(input.handicaps) ? input.handicaps : []).forEach((row) => {
    const devig = deVigProportional([row?.win, row?.draw, row?.lose])
    const line = Number(row?.line)
    if (devig.ok && Number.isFinite(line)) {
      targets.push({ key: `handicap:${line}:win`, label: `让 ${line} 主`, value: devig.fair[0] })
      targets.push({ key: `handicap:${line}:push`, label: `让 ${line} 走`, value: devig.fair[1] })
      targets.push({ key: `handicap:${line}:lose`, label: `让 ${line} 客`, value: devig.fair[2] })
    } else {
      notes.push(`让球 ${Number.isFinite(line) ? line : '?'} 赔率需三项都给，未参与倒算`)
    }
  })

  return { targets, notes }
}

/**
 * 从一份进球分布里取某个 Entry 的概率。返回 NaN 表示该盘口无法从分布推出
 * （half_full、other 等），调用方必须显式处理，不得当作 0。
 */
export const probabilityForEntry = (entry, { markets, cells } = {}) => {
  if (!markets || !entry) return Number.NaN
  const marketType = entry.market_type
  const detail = entry.parse_detail || {}
  if (marketType === 'result') {
    if (detail.outcome === 'win') return markets.oneXTwo.home
    if (detail.outcome === 'draw') return markets.oneXTwo.draw
    if (detail.outcome === 'lose') return markets.oneXTwo.away
    return Number.NaN
  }
  if (marketType === 'score') {
    const cell = (Array.isArray(cells) ? cells : []).find((row) => row.home === detail.home && row.away === detail.away)
    return cell ? cell.p : Number.NaN
  }
  if (marketType === 'total') {
    const row = (markets.totals || []).find((item) => item.line === detail.line)
    if (!row) return Number.NaN
    if (detail.direction === 'over') return row.over
    if (detail.direction === 'under') return row.under
    return Number.NaN
  }
  if (marketType === 'handicap') {
    const row = (markets.handicaps || []).find((item) => item.line === detail.line)
    if (!row) return Number.NaN
    if (detail.outcome === 'win') return row.win
    if (detail.outcome === 'draw') return row.push
    if (detail.outcome === 'lose') return row.lose
    return Number.NaN
  }
  return Number.NaN
}

/** 让 deriveMarketProbabilities 覆盖 Entry 实际用到的大小球线/让球线，其余不动。 */
export const deriveMarketProbabilitiesForEntries = (homeLambda, awayLambda, entries = [], options = {}) => {
  const totalLines = [...new Set(
    entries
      .filter((entry) => entry?.market_type === 'total' && Number.isFinite(Number(entry?.parse_detail?.line)))
      .map((entry) => Number(entry.parse_detail.line)),
  )]
  const handicapLines = [...new Set(
    entries
      .filter((entry) => entry?.market_type === 'handicap' && Number.isFinite(Number(entry?.parse_detail?.line)))
      .map((entry) => Number(entry.parse_detail.line)),
  )]
  return deriveMarketProbabilities(homeLambda, awayLambda, {
    ...options,
    ...(totalLines.length ? { totalLines } : {}),
    ...(handicapLines.length ? { handicapLines } : {}),
  })
}

/**
 * 从机构赔率倒算市场隐含的进球分布：在 (λ主, λ客) 上做粗网格 + 局部细化搜索，
 * 最小化「泊松模型给出的盘口概率」与「去水后的市场公平概率」的平方误差。
 * 只使用调用方提供的盘口；缺哪条就少一条约束，不做任何外推。
 */
export const fitMarketLambdas = (
  input = {},
  { maxGoals = 8, coarseStep = 0.1, fineStep = 0.02, min = 0.2, max = 3.6 } = {},
) => {
  const { targets, notes } = marketTargetsFromInput(input)
  if (targets.length < 3) {
    return { ready: false, reason: 'insufficient_market_input', targets: [], notes, samples: targets.length }
  }

  // 只用市场给了的盘口线作为约束，不额外外推别的线
  const lineOf = (prefix) => [...new Set(
    targets.filter((target) => target.key.startsWith(`${prefix}:`))
      .map((target) => Number(target.key.split(':')[1]))
      .filter(Number.isFinite),
  )]
  const totalLines = lineOf('over')
  const handicapLines = lineOf('handicap')
  const marketOptions = {
    maxGoals,
    ...(totalLines.length ? { totalLines } : {}),
    ...(handicapLines.length ? { handicapLines } : {}),
  }

  const marketValueMap = (markets) => {
    const valueByKey = {
      home: markets.oneXTwo.home,
      draw: markets.oneXTwo.draw,
      away: markets.oneXTwo.away,
    }
    markets.totals.forEach((row) => {
      valueByKey[`over:${row.line}`] = row.over
      valueByKey[`under:${row.line}`] = row.under
    })
    markets.handicaps.forEach((row) => {
      valueByKey[`handicap:${row.line}:win`] = row.win
      valueByKey[`handicap:${row.line}:push`] = row.push
      valueByKey[`handicap:${row.line}:lose`] = row.lose
    })
    return valueByKey
  }

  const evaluate = (home, away) => {
    const markets = deriveMarketProbabilities(home, away, marketOptions)
    const valueByKey = marketValueMap(markets)
    let sse = 0
    targets.forEach((target) => {
      const model = valueByKey[target.key]
      if (Number.isFinite(model)) sse += (model - target.value) ** 2
    })
    return { sse, markets }
  }

  let best = { home: DEFAULT_LAMBDA_PRIOR.home, away: DEFAULT_LAMBDA_PRIOR.away, sse: Number.POSITIVE_INFINITY }
  for (let home = min; home <= max + 1e-9; home += coarseStep) {
    for (let away = min; away <= max + 1e-9; away += coarseStep) {
      const { sse } = evaluate(home, away)
      if (sse < best.sse) best = { home, away, sse }
    }
  }
  const coarseBest = { ...best }
  for (let home = Math.max(min, coarseBest.home - coarseStep * 1.5); home <= Math.min(max, coarseBest.home + coarseStep * 1.5) + 1e-9; home += fineStep) {
    for (let away = Math.max(min, coarseBest.away - coarseStep * 1.5); away <= Math.min(max, coarseBest.away + coarseStep * 1.5) + 1e-9; away += fineStep) {
      const { sse } = evaluate(home, away)
      if (sse < best.sse) best = { home, away, sse }
    }
  }

  const { markets } = evaluate(best.home, best.away)
  const valueByKey = marketValueMap(markets)

  return {
    ready: true,
    homeLambda: Number(best.home.toFixed(3)),
    awayLambda: Number(best.away.toFixed(3)),
    sse: Number(best.sse.toFixed(6)),
    samples: targets.length,
    notes,
    targets: targets.map((target) => ({
      ...target,
      model: Number((valueByKey[target.key] ?? Number.NaN).toFixed(4)),
      delta: Number(((valueByKey[target.key] ?? Number.NaN) - target.value).toFixed(4)),
    })),
  }
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
