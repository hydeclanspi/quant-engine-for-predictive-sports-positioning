/**
 * ============================================================================
 *  warReport.js — 战报（Campaign Report）派生层
 * ============================================================================
 *
 * 「周期」不是本模块新发明的概念 —— 它完全沿用蓄水池（getReservoirState）
 * 已经定义好的那条时间分界线：每一次 settlePool() 在 poolSettlements 上画一刀，
 * 相邻两刀之间就是一个周期。本模块把那条隐式的分界线显式化成一份可枚举、
 * 可命名、可逐项复盘的周期档案。
 *
 *   周期 k 的时间区间 = (前一次结算, 本次结算]      —— 左开右闭
 *   最后一个周期 = (最后一次结算, +∞)              —— 进行中
 *   创世周期     = (-∞, 第一次结算]                 —— 尚无结算时即「全部」
 *
 * 本金口径与 getReservoirState 严格对齐：
 *   创世周期本金 = initialCapital − 全部注资 + 本周期内注资
 *   后续周期本金 = 本周期内注资（含结算时的「周期划拨」，落在 +1ms 处）
 *
 * ────────────────────────────────────────────────────────────────────────
 *  输出（getWarReport）
 * ────────────────────────────────────────────────────────────────────────
 *   kpi           盈亏 / 双口径 ROI / 命中率 / 峰值回撤 / 连胜连败 / 战绩评级
 *   curve         周期内净值曲线（含注资台阶）
 *   leagues       分联赛盈亏（联赛由 teamDatabase 反查；跨联赛串按腿数均摊）
 *   weeks         分自然周（ISO 周一起算）盈亏
 *   stakeBuckets  分注额档 ROI（0–50 / 50–100 / … / 300+）
 *   modes         分策略模式盈亏
 *   entries       周期内每一笔下注的完整流水（供翻页）
 *
 * 全部为纯函数：读 localData → 算 → 返回结构化结果，无副作用（缓存除外）。
 * 缓存以模块内 revision 为前缀，'dugou:data-changed' 触发自增 —— 与 analytics
 * 的三段式缓存同构，所以结算界面一旦落笔，战报下一次读取自然拿到最新 results。
 *
 * @module warReport
 */

import { getCycleTitles, getInvestments, getSystemConfig } from './localData'
import { lookupTeam } from './teamDatabase'

/* ── 原语 ─────────────────────────────────────────────────────────────── */

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const ts = (value) => {
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

const isActive = (item) => !item?.is_archived

// 已结算判定。比 analytics.getSettledInvestments 严一档：那边只要 profit 是个
// 有限数就算已结算，于是一笔 status='pending' 但 profit 占位为 0 的单会被算进
// 已结算样本 —— 待结算页说「3 笔待结」，战报却说它们已经结了。
// 这里让显式的 pending 一票否决，其余沿用同一套宽松回退（老记录可能没有 status）。
const isSettled = (item) => {
  if (item?.status === 'pending') return false
  return item?.status === 'win' || item?.status === 'lose' || Number.isFinite(Number.parseFloat(item?.profit))
}

const calcRoi = (profit, inputs) => (inputs > 0 ? (profit / inputs) * 100 : 0)

const round2 = (value) => Number((Number(value) || 0).toFixed(2))

/* ── 缓存（revision 前缀，与 analytics 同构） ──────────────────────────── */

const CACHE_EVENT = 'dugou:data-changed'
const CACHE_HANDLER_KEY = '__dugouWarReportCacheInvalidator__'

const memo = { revision: 0, periods: new Map(), reports: new Map() }

const clearMemo = () => {
  memo.periods.clear()
  memo.reports.clear()
}

const bumpRevision = () => {
  memo.revision += 1
  clearMemo()
}

if (typeof window !== 'undefined') {
  const previous = window[CACHE_HANDLER_KEY]
  if (typeof previous === 'function') window.removeEventListener(CACHE_EVENT, previous)
  const invalidator = () => bumpRevision()
  window.addEventListener(CACHE_EVENT, invalidator)
  window[CACHE_HANDLER_KEY] = invalidator
}

/* ── 日期 / 自然周 ─────────────────────────────────────────────────────── */

const pad2 = (value) => String(value).padStart(2, '0')

export const formatDay = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`
}

export const formatFullDay = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`
}

/** 自然周起点（周一 00:00 本地时区）。 */
const getWeekStart = (input) => {
  const date = new Date(input)
  const offset = (date.getDay() + 6) % 7 // 周一 = 0
  date.setDate(date.getDate() - offset)
  date.setHours(0, 0, 0, 0)
  return date
}

/** ISO 8601 周序号 —— 用作分组键，保证跨年不撞车。 */
const getIsoWeek = (input) => {
  const date = new Date(input)
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { year: utc.getUTCFullYear(), weekNo, key: `${utc.getUTCFullYear()}-W${pad2(weekNo)}` }
}

/* ── 注额档位 ─────────────────────────────────────────────────────────── */

export const STAKE_BUCKETS = [
  { key: '0-50', label: '0 – 50', min: 0, max: 50 },
  { key: '50-100', label: '50 – 100', min: 50, max: 100 },
  { key: '100-150', label: '100 – 150', min: 100, max: 150 },
  { key: '150-200', label: '150 – 200', min: 150, max: 200 },
  { key: '200-300', label: '200 – 300', min: 200, max: 300 },
  { key: '300+', label: '300 以上', min: 300, max: Number.POSITIVE_INFINITY },
]

const getStakeBucketKey = (inputs) => {
  const amount = Math.max(0, toNumber(inputs))
  const hit = STAKE_BUCKETS.find((bucket) => amount >= bucket.min && amount < bucket.max)
  return (hit || STAKE_BUCKETS[STAKE_BUCKETS.length - 1]).key
}

/* ── 战绩评级 ─────────────────────────────────────────────────────────── */

const GRADE_LADDER = [
  { grade: 'S', title: '大捷', min: 30 },
  { grade: 'A', title: '胜势', min: 15 },
  { grade: 'B', title: '小胜', min: 5 },
  { grade: 'C', title: '胶着', min: -5 },
  { grade: 'D', title: '失利', min: Number.NEGATIVE_INFINITY },
]

export const gradeForRoi = (roi, settledCount = 1) => {
  if (!Number.isFinite(roi) || settledCount <= 0) {
    return { grade: '—', title: '未开战', min: 0 }
  }
  return GRADE_LADDER.find((row) => roi >= row.min) || GRADE_LADDER[GRADE_LADDER.length - 1]
}

/* ── 联赛归属 ─────────────────────────────────────────────────────────── */

const UNKNOWN_LEAGUE = '未归类'

/** 一笔投注涉及的全部联赛（去重）。跨联赛串关按腿数均摊，而非归给某一条腿。 */
const resolveLeaguesOfInvestment = (investment) => {
  const matches = Array.isArray(investment?.matches) ? investment.matches : []
  const leagues = new Set()
  matches.forEach((match) => {
    const home = lookupTeam(match?.home_team)
    const away = lookupTeam(match?.away_team)
    const league = home?.league || away?.league
    leagues.add(league || UNKNOWN_LEAGUE)
  })
  if (leagues.size === 0) leagues.add(UNKNOWN_LEAGUE)
  return [...leagues]
}

/* ── 周期划分 ─────────────────────────────────────────────────────────── */

export const GENESIS_CYCLE_ID = 'cycle_genesis'

/** 由某次结算开启的周期，其稳定 id（结算被撤销时一并消失）。 */
export const cycleIdForSettlement = (settlementId) => `cycle_${settlementId}`

/**
 * 枚举全部周期，最新的排在最前。
 * 时间区间、本金口径与 getReservoirState 严格一致 —— 战报与蓄水池看到的是同一条分界线。
 */
export const getCyclePeriods = () => {
  const cacheKey = `${memo.revision}|periods`
  const cached = memo.periods.get(cacheKey)
  if (cached) return cached

  const config = getSystemConfig()
  const settlements = [...(Array.isArray(config.poolSettlements) ? config.poolSettlements : [])].sort(
    (a, b) => ts(a.created_at) - ts(b.created_at),
  )
  const injections = Array.isArray(config.capitalInjections) ? config.capitalInjections : []
  // `title` is the user-authored part only. `name` remains a read fallback for
  // bundles written by older builds, where the title field was called name.
  const titleMap = new Map(
    getCycleTitles().map((row) => [row.id, String(row.title ?? row.name ?? '').trim()]),
  )

  const initialCapital = toNumber(config.initialCapital)
  const totalInjected = injections.reduce((sum, item) => sum + toNumber(item.amount), 0)
  const originalCapital = initialCapital - totalInjected

  const investments = getInvestments().filter(isActive)
  const settledInvestments = investments.filter(isSettled)

  // 区间数 = 结算数 + 1（末尾那个是进行中的周期）
  const periods = []
  for (let index = 0; index <= settlements.length; index += 1) {
    const openedBy = index === 0 ? null : settlements[index - 1]
    const closedBy = index < settlements.length ? settlements[index] : null
    const startTs = openedBy ? ts(openedBy.created_at) : Number.NEGATIVE_INFINITY
    const endTs = closedBy ? ts(closedBy.created_at) : Number.POSITIVE_INFINITY

    const inRange = (value) => {
      const time = ts(value)
      return time > startTs && time <= endTs
    }

    const periodInjections = injections.filter((item) => inRange(item.created_at))
    const injected = periodInjections.reduce((sum, item) => sum + toNumber(item.amount), 0)
    const baseCapital = (openedBy ? 0 : originalCapital) + injected

    const periodSettled = settledInvestments.filter((item) => inRange(item.created_at))
    const periodAll = investments.filter((item) => inRange(item.created_at))
    const profit = periodSettled.reduce((sum, item) => sum + toNumber(item.profit), 0)

    const id = openedBy ? cycleIdForSettlement(openedBy.id) : GENESIS_CYCLE_ID
    const ordinal = index + 1
    const title = titleMap.get(id) || ''

    periods.push({
      id,
      ordinal,
      title,
      // The sequence belongs to the product, not the editable title. Users
      // type only "Hello World"; every surface consistently renders
      // "S1 Hello World" and an untitled open period simply renders "S3".
      name: `S${ordinal}${title ? ` ${title}` : ''}`,
      isCustomName: Boolean(title),
      isOpen: !closedBy,
      isGenesis: !openedBy,
      startTs,
      endTs,
      // 展示用的实际跨度：创世周期取首笔投注，进行中周期取此刻
      startAt: openedBy ? openedBy.created_at : periodAll.length > 0
        ? [...periodAll].sort((a, b) => ts(a.created_at) - ts(b.created_at))[0].created_at
        : null,
      endAt: closedBy ? closedBy.created_at : null,
      openedBy,
      closedBy,
      baseCapital: round2(baseCapital),
      injected: round2(injected),
      // 开局划拨：由开启本周期的那次结算拨入的启动资金
      allocation: round2(toNumber(openedBy?.newCapital)),
      injections: periodInjections,
      profit: round2(profit),
      endBalance: round2(baseCapital + profit),
      settledCount: periodSettled.length,
      pendingCount: periodAll.length - periodSettled.length,
      totalCount: periodAll.length,
    })
  }

  const ordered = periods.reverse() // 最新在前
  const result = {
    periods: ordered,
    currentId: ordered.length > 0 ? ordered[0].id : GENESIS_CYCLE_ID,
    totalPeriods: ordered.length,
  }
  memo.periods.set(cacheKey, result)
  return result
}

export const findCyclePeriod = (periodId) => {
  const { periods, currentId } = getCyclePeriods()
  return periods.find((item) => item.id === periodId) || periods.find((item) => item.id === currentId) || null
}

/* ── 战报主体 ─────────────────────────────────────────────────────────── */

const buildEntryRow = (investment) => {
  const matches = Array.isArray(investment.matches) ? investment.matches : []
  const inputs = round2(toNumber(investment.inputs))
  const settled = isSettled(investment)
  const profit = settled ? round2(toNumber(investment.profit)) : 0
  const status = investment.status === 'win' ? 'win' : investment.status === 'lose' ? 'lose' : 'pending'

  return {
    id: investment.id,
    createdAt: investment.created_at,
    createdTs: ts(investment.created_at),
    dateLabel: formatDay(investment.created_at),
    fullDateLabel: formatFullDay(investment.created_at),
    legs: matches.length || toNumber(investment.parlay_size, 1),
    // 每条腿：结算界面填回的 results / is_correct 即时反映在战报里
    matches: matches.map((match) => ({
      id: match.id,
      homeTeam: match.home_team || '',
      awayTeam: match.away_team || '',
      entryText: match.entry_text || '',
      odds: round2(toNumber(match.odds)),
      mode: match.mode || '常规',
      conf: Number.isFinite(Number.parseFloat(match.conf)) ? round2(toNumber(match.conf)) : null,
      results: match.results || '',
      isCorrect: typeof match.is_correct === 'boolean' ? match.is_correct : null,
      matchRating: Number.isFinite(Number.parseFloat(match.match_rating))
        ? round2(toNumber(match.match_rating))
        : null,
    })),
    leagues: resolveLeaguesOfInvestment(investment),
    modes: [...new Set(matches.map((match) => match.mode || '常规'))],
    combinedOdds: round2(toNumber(investment.combined_odds)),
    inputs,
    revenues: round2(toNumber(investment.revenues)),
    profit,
    roi: settled ? round2(calcRoi(profit, inputs)) : null,
    expectedRating: Number.isFinite(Number.parseFloat(investment.expected_rating))
      ? round2(toNumber(investment.expected_rating))
      : null,
    actualRating: Number.isFinite(Number.parseFloat(investment.actual_rating))
      ? round2(toNumber(investment.actual_rating))
      : null,
    remarks: investment.remarks || '',
    settled,
    status,
  }
}

const summarizeBuckets = (map) =>
  [...map.values()].map((row) => ({
    ...row,
    inputs: round2(row.inputs),
    profit: round2(row.profit),
    roi: round2(calcRoi(row.profit, row.inputs)),
    hitRate: row.settled > 0 ? round2((row.wins / row.settled) * 100) : 0,
  }))

const touchBucket = (map, key, seed) => {
  if (!map.has(key)) map.set(key, { key, inputs: 0, profit: 0, count: 0, settled: 0, wins: 0, ...seed })
  return map.get(key)
}

/**
 * 某个周期的完整战报。periodId 缺省时取进行中的周期。
 */
export const getWarReport = (periodId = null) => {
  const period = findCyclePeriod(periodId)
  if (!period) return null

  const cacheKey = `${memo.revision}|report|${period.id}`
  const cached = memo.reports.get(cacheKey)
  if (cached) return cached

  const investments = getInvestments()
    .filter(isActive)
    .filter((item) => {
      const time = ts(item.created_at)
      return time > period.startTs && time <= period.endTs
    })
    .sort((a, b) => ts(b.created_at) - ts(a.created_at))

  const entries = investments.map(buildEntryRow)
  const settledEntries = entries.filter((row) => row.settled)

  /* — KPI — */
  const totalInputs = settledEntries.reduce((sum, row) => sum + row.inputs, 0)
  const totalProfit = settledEntries.reduce((sum, row) => sum + row.profit, 0)
  const wins = settledEntries.filter((row) => row.profit > 0).length
  const losses = settledEntries.filter((row) => row.profit < 0).length
  const pendingInputs = entries.filter((row) => !row.settled).reduce((sum, row) => sum + row.inputs, 0)

  const bestEntry = settledEntries.reduce(
    (best, row) => (best === null || row.profit > best.profit ? row : best),
    null,
  )
  const worstEntry = settledEntries.reduce(
    (worst, row) => (worst === null || row.profit < worst.profit ? row : worst),
    null,
  )

  /* — 净值曲线（含注资台阶）：按时间正序重放 — */
  const timeline = [
    ...period.injections.map((item) => ({
      ts: ts(item.created_at),
      kind: 'injection',
      amount: toNumber(item.amount),
      label: item.note || '注资',
    })),
    ...settledEntries.map((row) => ({
      ts: row.createdTs,
      kind: 'bet',
      amount: row.profit,
      label: row.matches.map((m) => `${m.homeTeam}·${m.entryText}`).join(' + ') || '投注',
      entry: row,
    })),
  ].sort((a, b) => a.ts - b.ts)

  // 创世周期的原始本金在第一笔之前就已存在；后续周期由划拨/注资逐步垫起
  let running = period.isGenesis ? period.baseCapital - period.injected : 0
  let peak = running
  let maxDrawdown = 0
  const curve = [{ ts: period.startTs, balance: round2(running), kind: 'start', label: '开局' }]
  timeline.forEach((point) => {
    running += point.amount
    peak = Math.max(peak, running)
    maxDrawdown = Math.max(maxDrawdown, peak - running)
    curve.push({
      ts: point.ts,
      balance: round2(running),
      kind: point.kind,
      label: point.label,
      delta: round2(point.amount),
      dateLabel: formatDay(point.ts),
    })
  })

  /* — 连胜 / 连败 — */
  let currentStreak = 0
  let streakKind = null
  let bestWinStreak = 0
  let worstLoseStreak = 0
  ;[...settledEntries]
    .sort((a, b) => a.createdTs - b.createdTs)
    .forEach((row) => {
      const kind = row.profit > 0 ? 'win' : row.profit < 0 ? 'lose' : 'flat'
      if (kind === 'flat') return
      if (kind === streakKind) currentStreak += 1
      else {
        streakKind = kind
        currentStreak = 1
      }
      if (kind === 'win') bestWinStreak = Math.max(bestWinStreak, currentStreak)
      else worstLoseStreak = Math.max(worstLoseStreak, currentStreak)
    })

  /* — 分联赛（跨联赛串按腿数均摊） — */
  const leagueMap = new Map()
  settledEntries.forEach((row) => {
    const share = 1 / Math.max(1, row.leagues.length)
    row.leagues.forEach((league) => {
      const bucket = touchBucket(leagueMap, league, { label: league })
      bucket.inputs += row.inputs * share
      bucket.profit += row.profit * share
      bucket.count += share
      bucket.settled += 1
      if (row.profit > 0) bucket.wins += 1
    })
  })
  const leagues = summarizeBuckets(leagueMap)
    .map((row) => ({ ...row, count: round2(row.count) }))
    .sort((a, b) => b.profit - a.profit)

  /* — 分自然周 — */
  const weekMap = new Map()
  settledEntries.forEach((row) => {
    const { key } = getIsoWeek(row.createdAt)
    const start = getWeekStart(row.createdAt)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const bucket = touchBucket(weekMap, key, {
      label: `${formatDay(start)} – ${formatDay(end)}`,
      startTs: start.getTime(),
    })
    bucket.inputs += row.inputs
    bucket.profit += row.profit
    bucket.count += 1
    bucket.settled += 1
    if (row.profit > 0) bucket.wins += 1
  })
  const weeks = summarizeBuckets(weekMap).sort((a, b) => a.startTs - b.startTs)

  /* — 分注额档 — */
  const stakeMap = new Map()
  STAKE_BUCKETS.forEach((bucket) => {
    stakeMap.set(bucket.key, {
      key: bucket.key,
      label: bucket.label,
      min: bucket.min,
      max: bucket.max,
      inputs: 0,
      profit: 0,
      count: 0,
      settled: 0,
      wins: 0,
    })
  })
  settledEntries.forEach((row) => {
    const bucket = stakeMap.get(getStakeBucketKey(row.inputs))
    if (!bucket) return
    bucket.inputs += row.inputs
    bucket.profit += row.profit
    bucket.count += 1
    bucket.settled += 1
    if (row.profit > 0) bucket.wins += 1
  })
  const stakeBuckets = summarizeBuckets(stakeMap)

  /* — 分策略模式（同样按腿数均摊） — */
  const modeMap = new Map()
  settledEntries.forEach((row) => {
    const share = 1 / Math.max(1, row.modes.length)
    row.modes.forEach((mode) => {
      const bucket = touchBucket(modeMap, mode, { label: mode })
      bucket.inputs += row.inputs * share
      bucket.profit += row.profit * share
      bucket.count += share
      bucket.settled += 1
      if (row.profit > 0) bucket.wins += 1
    })
  })
  const modes = summarizeBuckets(modeMap)
    .map((row) => ({ ...row, count: round2(row.count) }))
    .sort((a, b) => b.profit - a.profit)

  const roi = round2(calcRoi(totalProfit, totalInputs))
  const returnOnBase = period.baseCapital > 0 ? round2((totalProfit / period.baseCapital) * 100) : 0
  const grade = gradeForRoi(roi, settledEntries.length)

  const report = {
    period,
    kpi: {
      profit: round2(totalProfit),
      totalInputs: round2(totalInputs),
      pendingInputs: round2(pendingInputs),
      roi,
      returnOnBase,
      settledCount: settledEntries.length,
      pendingCount: entries.length - settledEntries.length,
      totalCount: entries.length,
      wins,
      losses,
      hitRate: settledEntries.length > 0 ? round2((wins / settledEntries.length) * 100) : 0,
      avgStake: settledEntries.length > 0 ? round2(totalInputs / settledEntries.length) : 0,
      maxDrawdown: round2(maxDrawdown),
      bestWinStreak,
      worstLoseStreak,
      bestEntry,
      worstEntry,
      grade: grade.grade,
      gradeTitle: grade.title,
    },
    curve,
    leagues,
    weeks,
    stakeBuckets,
    modes,
    entries,
  }

  memo.reports.set(cacheKey, report)
  return report
}

export const __testables = {
  getIsoWeek,
  getWeekStart,
  getStakeBucketKey,
  resolveLeaguesOfInvestment,
  bumpRevision,
}
