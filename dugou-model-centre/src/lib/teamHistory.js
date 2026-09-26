// 某支球队的「我做过的记录」：投前登记（Entries / 比分 / 备注）与投后复盘（赛果 / 中没中 / 复盘）。
// 只读账本、按时间倒序，用于投前 hero 卡里那两块空白区——输入队名就能看到我在这支队上的过往。

import { parseFinalScore } from './readQuality'
import { normalizeTeamToken } from './preMatchOpinion'

export const teamHistoryKey = (name) => normalizeTeamToken(name)

const text = (value) => String(value ?? '').trim()

const formatShortDate = (value) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const year = String(date.getFullYear()).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const readEntries = (match) => {
  const entries = Array.isArray(match?.entries) ? match.entries : []
  const normalized = entries
    .map((entry) => ({ name: text(entry?.name), odds: Number.parseFloat(entry?.odds) }))
    .filter((entry) => entry.name)
  if (normalized.length > 0) return normalized
  const fallback = text(match?.entry_text)
  if (!fallback) return []
  const odds = Number.parseFloat(match?.odds)
  return fallback
    .split(',')
    .map((name) => text(name))
    .filter(Boolean)
    .map((name, index) => ({ name, odds: index === 0 && Number.isFinite(odds) ? odds : Number.NaN }))
}

const scorePointFromEntry = (entry) => {
  const detail = entry?.parse_detail
  if (entry?.market_type !== 'score' || !detail) return null
  const home = Number(detail.home)
  const away = Number(detail.away)
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null
  return { home, away }
}

/** 账本 → Map(队名 key → 该队记录，按时间倒序，最新在前)。 */
export const buildTeamHistory = (investments, { perTeam = 12 } = {}) => {
  const map = new Map()
  const list = Array.isArray(investments) ? investments.filter((item) => !item?.is_archived) : []

  list.forEach((investment) => {
    const createdAt = investment?.created_at || investment?.createdAt || ''
    const createdAtTs = new Date(createdAt).getTime() || 0
    const settled = investment?.status === 'win' || investment?.status === 'lose'
    const matches = Array.isArray(investment?.matches) ? investment.matches : []

    matches.forEach((match, index) => {
      const homeKey = teamHistoryKey(match?.home_team)
      const awayKey = teamHistoryKey(match?.away_team)
      if (!homeKey || !awayKey) return

      const entries = readEntries(match)
      const scoreEntry = entries.find((entry) => scorePointFromEntry(entry))
      const predictedScore =
        (scoreEntry && scorePointFromEntry(scoreEntry))
        || (typeof match?.predicted_score === 'object' ? match.predicted_score : null)
        || entries.map((entry) => parseFinalScore(entry.name)).find(Boolean)
        || null
      const actualScore = typeof match?.actual_score === 'object' ? match.actual_score : parseFinalScore(match?.results)

      const base = {
        id: `${investment?.id || 'inv'}:${match?.id ?? index}`,
        createdAtTs,
        dateLabel: formatShortDate(createdAt),
        entryText: entries.map((entry) => entry.name).join(' / '),
        oddsLabel: (() => {
          const odds = entries.map((entry) => entry.odds).find((value) => Number.isFinite(value) && value > 1)
          return Number.isFinite(odds) ? odds.toFixed(2) : '--'
        })(),
        predictedScore: predictedScore || null,
        actualScore: actualScore || null,
        resultText: text(match?.results),
        isCorrect: typeof match?.is_correct === 'boolean' ? match.is_correct : null,
        settled,
        note: text(match?.note),
        postNote: text(match?.post_note),
        ajr: Number.isFinite(Number.parseFloat(match?.match_rating)) ? Number.parseFloat(match.match_rating) : null,
        rep: Number.isFinite(Number.parseFloat(match?.match_rep)) ? Number.parseFloat(match.match_rep) : null,
        mode: text(match?.mode),
      }

      const push = (key, row) => {
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(row)
      }
      push(homeKey, { ...base, venue: 'home', opponent: text(match?.away_team) })
      push(awayKey, { ...base, venue: 'away', opponent: text(match?.home_team) })
    })
  })

  map.forEach((rows, key) => {
    map.set(key, [...rows].sort((a, b) => b.createdAtTs - a.createdAtTs).slice(0, perTeam))
  })
  return map
}

/** 取一支队的记录：先精确 key，取不到再按队名包含关系兜底（简称 / 别名）。 */
export const findTeamHistory = (map, teamName) => {
  if (!map || !(map instanceof Map)) return []
  const key = teamHistoryKey(teamName)
  if (!key) return []
  if (map.has(key)) return map.get(key)
  const shorter = (a, b) => (a.length <= b.length ? [a, b] : [b, a])
  for (const [candidate, rows] of map.entries()) {
    const [small, big] = shorter(key, candidate)
    if (small.length >= 2 && big.includes(small)) return rows
  }
  return []
}
