import { beforeEach, describe, expect, it, vi } from 'vitest'
const data = vi.hoisted(() => ({ investments: [] }))
vi.mock('../localData', () => ({ getInvestments: () => data.investments, getTeamProfiles: () => [],
  getSystemConfig: () => ({}), findTeamProfile: () => null, saveSystemConfig: vi.fn() }))
import { getDependencyHistory, getPerMatchEjrSnapshot, getWeightedObservedFailure, calculateDependencyPremium } from '../analytics'
import { splitInvestmentToMatches } from '../matchAttribution'
import { normalizeEntryRecord } from '../entryParsing'
const match = (id, extra = {}) => ({ id, event_id: id, conf: 0.6, match_rating: 0.4, is_correct: false, odds: 2,
  entries: [{ name: 'win', odds: 2 }], ...extra })
const investment = (id, extra = {}) => ({ id, created_at: '2026-01-01', inputs: 100, profit: 50, status: 'win',
  matches: [match('e1'), match('e2', { odds: 4 })], ...extra })
beforeEach(() => { data.investments = [] })
describe('follow-up accounting and sampling contracts', () => {
  it('keeps allocated totals consistent for missing revenue, zero payout and missing odds', () => {
    const rows = splitInvestmentToMatches(investment('i'))
    expect(rows.reduce((sum, r) => sum + r.allocated_profit, 0)).toBeCloseTo(50)
    expect(rows[0].attribution_basis).toContain('synthetic')
    const loss = splitInvestmentToMatches(investment('i', { revenues: 0, profit: -100 }))
    expect(loss.reduce((sum, r) => sum + r.allocated_profit, 0)).toBe(-100)
    expect(splitInvestmentToMatches(investment('i', { status: 'pending' })).every((r) => Number.isNaN(r.allocated_profit))).toBe(true)
    const noOdds = splitInvestmentToMatches(investment('i', { matches: [match('e1', { odds: null }), match('e2', { odds: null })] }))
    expect(noOdds.reduce((sum, r) => sum + r.allocated_profit, 0)).toBeCloseTo(50)
  })
  it('compares judgment values on a common scale and identifies the non-probability metric', () => {
    data.investments = [investment('i')]
    const snapshot = getPerMatchEjrSnapshot()
    expect(snapshot.matches[0].delta).toBeCloseTo(-0.1)
    expect(snapshot.metricBasis).toContain('not_probability_error')
  })
  it('does not replace explicit malformed prices with a parent quote', () => {
    for (const odds of ['', null, 'bad', NaN]) expect(Number.isNaN(normalizeEntryRecord({ name: 'win', odds }, 2.5).odds)).toBe(true)
    expect(normalizeEntryRecord({ name: 'win' }, 2.5).odds).toBe(2.5)
  })
  it('shares one archived/pending selector and deduplicates copied event selections', () => {
    data.investments = [investment('i'), investment('copy'), investment('pending', { status: 'pending' }), investment('archive', { is_archived: true })]
    expect(getDependencyHistory()).toHaveLength(1)
    expect(getWeightedObservedFailure(getDependencyHistory(), 2, 4).rawPairCount).toBe(1)
  })
  it('keeps diagnostics invariant to input order, without a spurious significance claim', () => {
    const history = Array.from({ length: 35 }, (_, i) => ({ createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      matches: [{ odds: 2, result: i % 3 === 0 }, { odds: 4, result: i % 4 === 0 }] }))
    const forward = calculateDependencyPremium({ odds: 2 }, { odds: 4 }, history)
    const reverse = calculateDependencyPremium({ odds: 2 }, { odds: 4 }, [...history].reverse())
    expect(forward).toEqual(reverse)
    expect(forward.isSignificant).toBe(false)
    expect(forward.inferenceStatus).toBe('exploratory_only')
  })
})
