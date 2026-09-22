import { getMatchSourceIdentity } from './investmentIdentity'

export const validTime = (value) => value == null || value === '' ? NaN : new Date(value).getTime()

// Legacy tickets record no settlement time. Treating the outcome as known 72h
// after creation keeps validation runnable, but this is an assumption, never a
// recorded fact: every derived time keeps its basis so no consumer can present
// it as a settlement that was actually recorded.
export const LEGACY_OUTCOME_AVAILABILITY_HOURS = 72

export const OUTCOME_AVAILABILITY_BASIS = Object.freeze({
  recorded: 'recorded_settlement_time',
  derived: 'derived_created_at_plus_72h',
  unknown: 'unknown',
})

export const resolveOutcomeAvailability = (recordedAt, createdAt) => {
  const recorded = validTime(recordedAt)
  if (Number.isFinite(recorded)) return { at: recorded, basis: OUTCOME_AVAILABILITY_BASIS.recorded }
  const created = validTime(createdAt)
  if (Number.isFinite(created)) {
    return {
      at: created + LEGACY_OUTCOME_AVAILABILITY_HOURS * 60 * 60 * 1000,
      basis: OUTCOME_AVAILABILITY_BASIS.derived,
    }
  }
  return { at: Number.NaN, basis: OUTCOME_AVAILABILITY_BASIS.unknown }
}

// Never infer an event from team names. A source reference links copied legs;
// explicit event IDs also group different selections on the same event.
export const matchEventKey = (match, investmentId) => {
  const id = getMatchSourceIdentity(match, investmentId)
  return id.event_id ? `event:${id.event_id}` : id.source_match_id && id.source_investment_id
    ? `source:${JSON.stringify([id.source_investment_id, id.source_match_id])}` : ''
}

export const uniqueMatchRows = (investments) => {
  const selected = new Map()
  const unknown = new Map()
  const anonymous = []
  for (const investment of investments) {
    for (const match of investment.matches || []) {
      const identity = getMatchSourceIdentity(match, investment.id)
      const eventKey = matchEventKey(match, investment.id)
      const availability = resolveOutcomeAvailability(
        match.outcome_available_at || investment.outcome_available_at || investment.settled_at,
        investment.created_at,
      )
      const row = { investment, match, created_at: investment.created_at, eventKey,
        outcome_available_at: availability.at, outcome_availability_basis: availability.basis }
      if (!eventKey || !identity.selection_key) {
        // 身份不全：能认出事件的（eventKey）或同一拷贝的（match.id）重复项不算新证据；
        // 既无事件也无场次 id 的匿名行无法与其它行区分，保留原样、不做合并。
        const coarseKey = eventKey ? JSON.stringify(['event', eventKey, match.id || ''])
          : match.id ? JSON.stringify(['match', investment.id, match.id]) : ''
        if (!coarseKey) { anonymous.push(row); continue }
        const old = unknown.get(coarseKey)
        if (!old || validTime(row.created_at) < validTime(old.created_at)) unknown.set(coarseKey, row)
        continue
      }
      const key = JSON.stringify([eventKey, identity.selection_key])
      const old = selected.get(key)
      // Duplicating a recommendation is not new evidence. Prefer the earliest
      // observation; outcome corrections are reflected by its availability time.
      if (!old || validTime(row.created_at) < validTime(old.created_at)) selected.set(key, row)
    }
  }
  return [...selected.values(), ...unknown.values(), ...anonymous]
}

export const historyFromRows = (rows) => {
  const grouped = new Map()
  for (const row of rows) {
    if (!row.investment || !row.match) continue
    const key = row.investment.id || row.investment
    if (!grouped.has(key)) grouped.set(key, { ...row.investment, matches: [] })
    grouped.get(key).matches.push(row.match)
  }
  return [...grouped.values()]
}
