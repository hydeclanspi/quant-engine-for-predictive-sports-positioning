import { normalizeEntries } from './entryParsing'

const text = (value) => String(value ?? '').trim()

// A selection is a market/outcome set, not just a pair of team names. Odds can
// change without changing the selection; switching market or handicap cannot.
export const buildSelectionKey = (match = {}) => {
  const entries = normalizeEntries(match.entries, match.entry_text || match.entry || '', match.odds)
  if (entries.length === 0) return ''
  return [...new Set(entries.map((entry) => `${entry.market_type}:${entry.semantic_key}`))].sort().join('|')
}

export const getMatchSourceIdentity = (match = {}, investmentId = '') => ({
  source_investment_id: text(match.source_investment_id || match.sourceInvestmentId || investmentId),
  source_match_id: text(match.source_match_id || match.sourceMatchId || match.id),
  event_id: text(match.event_id || match.eventId),
  selection_key: buildSelectionKey(match) || text(match.selection_key || match.selectionKey),
})

const referenceKey = (identity) => identity.source_investment_id && identity.source_match_id && identity.selection_key
  ? JSON.stringify([identity.source_investment_id, identity.source_match_id, identity.selection_key])
  : ''
const eventKey = (identity) => identity.event_id && identity.selection_key
  ? JSON.stringify([identity.event_id, identity.selection_key])
  : ''

export const getSelectionIdentityKey = (match, investmentId = '') => {
  const identity = getMatchSourceIdentity(match, investmentId)
  return referenceKey(identity) || eventKey(identity)
}

/** Read-only identity resolver. Never infer an event from names or dates. */
export const buildSettledSelectionResolver = (investments = []) => {
  const own = new Map()
  const source = new Map()
  const events = new Map()
  const append = (map, key, row) => {
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }
  investments.filter((investment) => !investment.is_archived && ['win', 'lose'].includes(investment.status)).forEach((investment) => {
    ;(investment.matches || []).forEach((match) => {
      const identity = getMatchSourceIdentity(match, investment.id)
      const row = { investment, match, identity, isCorrect: match.is_correct }
      append(own, referenceKey({ ...identity, source_investment_id: text(investment.id), source_match_id: text(match.id) }), row)
      append(source, referenceKey(identity), row)
      append(events, eventKey(identity), row)
    })
  })
  const unique = (rows) => rows?.length === 1 ? rows[0] : null
  return (match, investmentId = '') => {
    const identity = getMatchSourceIdentity(match, investmentId)
    const ref = referenceKey(identity)
    // An explicit reference that exists but is ambiguous must not fall back to
    // a weaker event match. Historical rows with no identity stay unknown.
    if (ref && own.has(ref)) return unique(own.get(ref))
    if (ref && source.has(ref)) return unique(source.get(ref))
    return unique(events.get(eventKey(identity)))
  }
}
