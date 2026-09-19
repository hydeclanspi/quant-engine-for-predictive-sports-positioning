import { describe, expect, it } from 'vitest'
import { buildSettledSelectionResolver, getMatchSourceIdentity } from '../investmentIdentity'
import { addSettlementTimestamps, buildForecastSnapshot, capRecommendedStake } from '../investmentForecast'
import { buildAtomicMatchProfile, combineAtomicMatchProfiles } from '../atomicParlay'

const match = { id: 'm1', home_team: 'A', away_team: 'B', entries: [{ name: 'win', odds: 2 }], is_correct: true }
const source = { id: 'i1', status: 'win', matches: [match] }
const date = '2026-09-19T00:00:00Z'

describe('settlement provenance', () => {
  it('resolves exact source and selection, not repeated team names', () => {
    const old = { id: 'old', status: 'lose', matches: [{ ...match, is_correct: false }] }
    const resolve = buildSettledSelectionResolver([source, old])
    expect(resolve(getMatchSourceIdentity(match, source.id)).isCorrect).toBe(true)
    expect(resolve({ homeTeam: 'A', awayTeam: 'B', entry: 'win' })).toBeNull()
    expect(resolve({ ...getMatchSourceIdentity(match, source.id), entries: [{ name: '-1 win', odds: 2 }] })).toBeNull()
  })
  it('does not guess when an event reference has conflicting duplicates', () => {
    const withEvent = { ...match, event_id: 'event' }
    const resolve = buildSettledSelectionResolver([
      { ...source, matches: [withEvent] }, { ...source, id: 'i2', matches: [{ ...withEvent, is_correct: false }] },
    ])
    expect(resolve({ event_id: 'event', entries: match.entries })).toBeNull()
  })
  it('ignores archived records', () => {
    const resolve = buildSettledSelectionResolver([{ ...source, is_archived: true }])
    expect(resolve(getMatchSourceIdentity(match, source.id))).toBeNull()
  })
  it('stamps availability only on a new confirmed settlement', () => {
    const settled = addSettlementTimestamps({ status: 'pending' }, source, date)
    expect(settled.settled_at).toBe(date)
    expect(settled.matches[0].outcome_available_at).toBe(date)
    expect(addSettlementTimestamps(source, source, date).settled_at).toBeUndefined()
    expect(addSettlementTimestamps(settled, settled, '2026-10-01').settled_at).toBe(date)
  })
})

describe('prediction snapshot contract', () => {
  it('records exhaustive coverage as probability one, not the pre-model subjective input', () => {
    const profile = { ...buildAtomicMatchProfile({ entries: ['win', 'draw', 'lose'].map((name) => ({ name, odds: 3 })), unionProbability: 0.6 }), unionProbability: 0.6 }
    const snapshot = buildForecastSnapshot({ combinedProfile: combineAtomicMatchProfiles([profile]), generatedAt: date, legs: [{ match, profile }] })
    expect(snapshot.legs[0].calibrated_probability).toBe(1)
    expect(snapshot.ticket_hit_probability).toBe(1)
  })
  it('preserves ticket probability and states independently of mean leg score', () => {
    const profile = buildAtomicMatchProfile({ entries: match.entries, unionProbability: 0.6 })
    const snapshot = buildForecastSnapshot({ combinedProfile: combineAtomicMatchProfiles([profile, profile]),
      generatedAt: date, legs: [{ match, profile, investmentId: source.id }] })
    expect(snapshot.ticket_hit_probability).toBeCloseTo(0.36)
    expect(snapshot.expected_return).toBeCloseTo(0.44)
    expect(snapshot.legs[0].source_match_id).toBe('m1')
    expect(snapshot.legs[0].calibrated_probability).toBeCloseTo(0.6)
  })
  it.each([[null], [{ probability: 2, gross: 1 }], [{ probability: '', gross: 1 }]])('rejects bad states safely: %j', (states) => {
    expect(buildForecastSnapshot({ combinedProfile: { states }, generatedAt: date })).toBeNull()
  })
  it('does not recommend negative stakes or round above a fractional budget', () => {
    expect(capRecommendedStake(100, -100, 0.12)).toBe(0)
    expect(capRecommendedStake(100, 48, 0.12)).toBe(5)
  })
})
