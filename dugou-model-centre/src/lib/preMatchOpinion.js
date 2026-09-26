// 投前观点：把「我认为它会进几球（区间 + 浓度）」变成一份可计算的比分分布。
//
// 与「机构市场」是两条独立通道：这里只处理我自己的观点，不吸收任何市场赔率。
// 机构场次的队名匹配（含主客对调容错）也放在这里，供界面自动对位。

import { lookupTeam } from './teamDatabase'

export const SCORE_GOAL_MAX = 6
export const SCORE_GOAL_VALUES = Object.freeze(
  Array.from({ length: SCORE_GOAL_MAX + 1 }, (_, goals) => goals),
)

// 每个进球数上的手动浓度：默认跟随区间正态分布，点一下加深，再点压低，第三下回到默认。
export const CELL_MODES = Object.freeze(['auto', 'boost', 'zero'])
export const CELL_MODE_FACTORS = Object.freeze({ auto: 1, boost: 2.6, zero: 0.03 })
export const CELL_MODE_LABELS = Object.freeze({ auto: '默认', boost: '加权', zero: '压低' })

const clampGoal = (value) => {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(SCORE_GOAL_MAX, parsed))
}

/** 登记一个比分时，这个进球数的默认区间 = 自己 ±1 球。 */
export const defaultWindowForGoals = (goals, spread = 1) => {
  const center = clampGoal(goals)
  return [clampGoal(center - spread), clampGoal(center + spread)]
}

/** 区间越宽，正态越平；单点区间也留一点最小宽度，避免退化成硬点。 */
export const defaultSigmaForWindow = (lo, hi) => Math.max(0.35, (Math.abs(hi - lo) + 1) / 3)

const gaussianKernel = (goals, center, sigma) =>
  Math.exp(-0.5 * ((goals - center) / sigma) ** 2)

export const cycleCellMode = (mode) => {
  const index = CELL_MODES.indexOf(mode)
  return CELL_MODES[(index + 1) % CELL_MODES.length]
}

/**
 * 区间 + 浓度 → 每侧进球分布（长度 SCORE_GOAL_MAX+1，和为 1）。
 * - 区间内的格子：默认按正态分布取浓度；
 * - 区间外的格子：默认 0，但手动点过的格子仍然可以拿到权重（手动覆盖区间）；
 * - 全是 0 时退回区间上的均匀分布，绝不产生空分布。
 */
export const weightsFromSlider = ({ lo, hi, center = null, sigma = null, modes = {} } = {}) => {
  const low = clampGoal(lo)
  const high = clampGoal(hi)
  const from = Math.min(low, high)
  const to = Math.max(low, high)
  const mid = Number.isFinite(center) ? center : (from + to) / 2
  const spread = Number.isFinite(sigma) && sigma > 0 ? sigma : defaultSigmaForWindow(from, to)

  const raw = SCORE_GOAL_VALUES.map((goals) => {
    const base = gaussianKernel(goals, mid, spread)
    const mode = CELL_MODES.includes(modes[goals]) ? modes[goals] : 'auto'
    if (mode !== 'auto') return base * CELL_MODE_FACTORS[mode]
    return goals >= from && goals <= to ? base : 0
  })

  const total = raw.reduce((sum, value) => sum + value, 0)
  if (total > 0) return raw.map((value) => value / total)

  const fallback = SCORE_GOAL_VALUES.map((goals) => (goals >= from && goals <= to ? 1 : 0))
  const fallbackTotal = fallback.reduce((sum, value) => sum + value, 0)
  if (fallbackTotal > 0) return fallback.map((value) => value / fallbackTotal)
  return SCORE_GOAL_VALUES.map((goals) => (goals === mid ? 1 : 0))
}

/**
 * 把整条分布按 delta 球平移（θ 修正用）：整数部分整格搬，小数部分线性分摊。
 * delta > 0 表示「我习惯低估 → 往高球数方向挪」。挪出 0-6 网格的尾部会被截断，
 * 只要还剩下质量就重新归一；全被截断时原样返回。
 */
export const shiftWeights = (weights, delta) => {
  const list = Array.isArray(weights) ? weights : []
  if (list.length === 0) return []
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return [...list]

  const shifted = list.map((_, goals) => {
    const source = goals - delta
    const lower = Math.floor(source)
    const upper = lower + 1
    const t = source - lower
    const a = lower >= 0 && lower < list.length ? list[lower] : 0
    const b = upper >= 0 && upper < list.length ? list[upper] : 0
    return a * (1 - t) + b * t
  })
  const total = shifted.reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) return [...list]
  return shifted.map((value) => value / total)
}

export const expectedGoals = (weights) =>
  (Array.isArray(weights) ? weights : []).reduce((sum, weight, goals) => sum + weight * goals, 0)

/** 两侧独立的进球分布 → 联合比分分布（和 = 1）。 */
export const jointScoreCells = (homeWeights, awayWeights) => {
  const home = Array.isArray(homeWeights) ? homeWeights : []
  const away = Array.isArray(awayWeights) ? awayWeights : []
  const cells = []
  home.forEach((homeWeight, homeGoals) => {
    away.forEach((awayWeight, awayGoals) => {
      const p = homeWeight * awayWeight
      if (p > 0) cells.push({ home: homeGoals, away: awayGoals, p })
    })
  })
  return cells
}

export const topScoreRows = (cells, count = 3) =>
  [...(Array.isArray(cells) ? cells : [])]
    .sort((a, b) => b.p - a.p)
    .slice(0, count)
    .map((cell) => ({ score: `${cell.home}-${cell.away}`, p: cell.p }))

// ── 机构场次的队名匹配 ────────────────────────────────────────────────

export const normalizeTeamToken = (value) =>
  String(value ?? '')
    .replace(/[\s　·．.\-—_/\\()（）]/g, '')
    .toLowerCase()

const canonicalTeamName = (value) => {
  try {
    return lookupTeam(String(value ?? ''))?.name || null
  } catch {
    return null
  }
}

/** 队名是否指同一支球队：全等 → 互含 → 队名库里的同一支（简称/别名）。 */
export const teamNamesMatch = (a, b) => {
  const left = normalizeTeamToken(a)
  const right = normalizeTeamToken(b)
  if (!left || !right) return false
  if (left === right) return true
  const shorter = left.length <= right.length ? left : right
  const longer = left.length <= right.length ? right : left
  if (shorter.length >= 2 && longer.includes(shorter)) return true
  const leftCanonical = canonicalTeamName(a)
  const rightCanonical = canonicalTeamName(b)
  return Boolean(leftCanonical && rightCanonical && leftCanonical === rightCanonical)
}

/**
 * 在我输入的队名里找官方竞彩的对应场次。主客对调也算命中（记 swapped），
 * 同一对球队有多场（不同日期）时优先在售场次，其余作为备选返回。
 */
export const matchOfficialFixture = (matches, homeTeam, awayTeam) => {
  const list = Array.isArray(matches) ? matches : []
  if (!normalizeTeamToken(homeTeam) || !normalizeTeamToken(awayTeam)) return null

  const candidates = []
  list.forEach((match) => {
    const straight = teamNamesMatch(match?.home, homeTeam) && teamNamesMatch(match?.away, awayTeam)
    const swapped = teamNamesMatch(match?.home, awayTeam) && teamNamesMatch(match?.away, homeTeam)
    if (!straight && !swapped) return
    candidates.push({ match, swapped: !straight, selling: Boolean(match?.selling) })
  })
  if (candidates.length === 0) return null

  const ranked = [...candidates].sort((a, b) => Number(b.selling) - Number(a.selling))
  const [best, ...rest] = ranked
  return {
    match: best.match,
    swapped: best.swapped,
    alternatives: rest.map((entry) => entry.match),
    candidateCount: ranked.length,
  }
}
