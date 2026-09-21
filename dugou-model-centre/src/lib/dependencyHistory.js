import { getSelectionIdentityKey } from './investmentIdentity'
import { matchEventKey } from './temporalValidation'

export const canonicalDependencyHistory = (history) => {
  const seen = new Set()
  return [...history].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
    || JSON.stringify(a).localeCompare(JSON.stringify(b))).filter((row) => {
    const keys = (row.matches || []).map((m) => m.identityKey)
    if (!keys.length || keys.some((key) => !key)) return true
    const key = JSON.stringify([...keys].sort())
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const toDependencyHistory = (investments) => canonicalDependencyHistory(investments
  .filter((inv) => !inv.is_archived && inv.status !== 'pending' && (inv.matches || []).length >= 2
    && (['win', 'lose', 'settled', 'settled_win', 'settled_loss'].includes(inv.status) || Number.isFinite(Number.parseFloat(inv.profit))))
  .map((inv) => ({ id: inv.id, createdAt: inv.created_at || inv.createdAt,
    succeeded: Number(inv.revenues) > 0 || inv.status === 'win' || inv.status === 'settled_win',
    matches: inv.matches.map((m) => ({ odds: Number(m.odds), result: typeof m.is_correct === 'boolean' ? m.is_correct : undefined,
      eventKey: matchEventKey(m, inv.id), identityKey: m.event_id
        ? `${m.event_id}:${getSelectionIdentityKey({ ...m, source_investment_id: '', source_match_id: '', id: '' })}`
        : getSelectionIdentityKey(m, inv.id) })),
  })))
