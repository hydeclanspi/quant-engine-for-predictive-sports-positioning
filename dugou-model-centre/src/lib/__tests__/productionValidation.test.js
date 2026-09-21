import { beforeEach, describe, expect, it, vi } from 'vitest'
const data = vi.hoisted(() => ({ investments: [], config: {} }))
vi.mock('../localData', () => ({ getInvestments: () => data.investments, getTeamProfiles: () => [],
  getSystemConfig: () => data.config, findTeamProfile: () => null, saveSystemConfig: vi.fn() }))
import { getPredictionCalibrationContext, learnContextFactors, __testables as t } from '../analytics'
import { predictMatchProbability } from '../matchPrediction'
import { historyFromRows, uniqueMatchRows } from '../temporalValidation'
const config = { initialCapital: 1000, riskCapRatio: 0.1, defaultOdds: 2, kellyDivisor: 4 }
const fixtures = () => Array.from({ length: 35 }, (_, i) => ({
  id: `i${i}`, created_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
  outcome_available_at: new Date(Date.UTC(2026, 0, i + 1, 1)).toISOString(),
  status: i % 3 ? 'win' : 'lose', inputs: 10, profit: i % 3 ? 10 : -10,
  matches: [{ id: `m${i}`, event_id: `e${i}`, home_team: `H${i}`, away_team: `A${i}`,
    conf: 0.3 + (i % 6) / 10, odds: 2, mode: '常规', tys_home: 'M', tys_away: 'L',
    fid: 0.4, fse_home: 0.3, fse_away: 0.7, match_rating: i % 3 ? 0.8 : 0.4,
    is_correct: i % 3 !== 0, entries: [{ name: 'win', odds: 2 }] }],
}))
beforeEach(() => { data.investments = fixtures(); data.config = {} })
describe('production pipeline and prequential isolation', () => {
  it('never consults live rows or config when fitting an injected historical dataset', () => {
    const history = fixtures()
    const before = getPredictionCalibrationContext({ investments: history, config })
    data.config = { weightOdds: 10, kellyDivisor: 12 }
    data.investments = fixtures().map((inv) => ({ ...inv, matches: inv.matches.map((m) => ({ ...m, is_correct: !m.is_correct })) }))
    const after = getPredictionCalibrationContext({ investments: history, config })
    const input = { ...history[0].matches[0], conf: 0.8 }
    expect(predictMatchProbability(input, config, after)).toBe(predictMatchProbability(input, config, before))
    expect(after.walkForwardFeedback).toEqual(before.walkForwardFeedback)
  })
  it('keeps AJR labels for the AJR regression, never substitutes binary outcomes', () => {
    const rows = t.getBinaryOutcomeRows()
    expect(rows[0].actual).toBe(0)
    expect(t.toCalibrationMatchRows(rows)[0].match.match_rating).toBe(0.4)
  })
  it('scores the same probability as the production predictor, without future data', () => {
    const rows = t.getBinaryOutcomeRows()
    const result = t.summarizeModelValidationPrequential(rows, config)
    const window = t.buildPrequentialWalkForwardWindows(rows, { minRows: 24, minTrain: 12, minTest: 7, step: 7 })[0]
    const fitted = getPredictionCalibrationContext({ investments: historyFromRows(window.trainRows), config })
    expect(result.walkForward[0].predictions[0].probability).toBe(predictMatchProbability(window.testRows[0].match, config, fitted))
    data.investments.slice(14).forEach((inv) => { inv.matches[0].is_correct = !inv.matches[0].is_correct; inv.matches[0].match_rating = 0 })
    const changed = t.summarizeModelValidationPrequential(t.getBinaryOutcomeRows(), config)
    expect(changed.walkForward[0].predictions.map((p) => p.probability)).toEqual(result.walkForward[0].predictions.map((p) => p.probability))
  })
  it('purges delayed outcomes, simultaneous predictions and overlapping events', () => {
    const rows = t.getBinaryOutcomeRows()
    rows[0].outcome_available_at = '2099-01-01'
    rows[1].eventKey = rows[14].eventKey
    rows[2].created_at = rows[14].created_at
    const windows = t.buildPrequentialWalkForwardWindows(rows, { minTrain: 5, initialTrain: 14 })
    expect(windows.length).toBeGreaterThan(0)
    windows.forEach((w) => w.trainRows.forEach((r) => {
      expect(new Date(r.outcome_available_at).getTime()).toBeLessThan(new Date(w.cutoff).getTime())
      expect(Date.parse(r.created_at)).toBeLessThan(Date.parse(w.cutoff))
      expect(w.testRows.some((test) => test.eventKey === r.eventKey)).toBe(false)
    }))
    // A missing settlement time is assumed (72 hours after creation) and must be
    // labelled as an assumption rather than silently trusted. The assumption is
    // applied when the rows are built, so the fixture has to be re-read.
    data.investments.forEach((inv) => { delete inv.outcome_available_at })
    const assumed = t.buildPrequentialWalkForwardWindows(t.getBinaryOutcomeRows())
    expect(assumed.length).toBeGreaterThan(0)
    expect(assumed.every((w) => w.timeBasis === 'contains_derived_availability')).toBe(true)
    // With no time information at all the row still cannot enter a temporal split.
    data.investments.forEach((inv) => { delete inv.created_at })
    expect(t.buildPrequentialWalkForwardWindows(t.getBinaryOutcomeRows())).toEqual([])
  })
  it('does not learn unknown outcomes as misses or repeated copies as new evidence', () => {
    const baseline = learnContextFactors(data.investments)
    const copy = { ...data.investments[0], id: 'copy', matches: data.investments[0].matches.map((m) => ({ ...m, source_investment_id: 'i0', source_match_id: 'm0' })) }
    const unknown = { ...data.investments[1], id: 'unknown', matches: [{ ...data.investments[1].matches[0], event_id: 'unknown', is_correct: null }] }
    expect(uniqueMatchRows([...data.investments, copy])).toHaveLength(35)
    expect(learnContextFactors([...data.investments, copy, unknown]).mode).toEqual(baseline.mode)
    expect(learnContextFactors([...data.investments, copy, unknown]).totalSamples).toBe(baseline.totalSamples)
  })
})
