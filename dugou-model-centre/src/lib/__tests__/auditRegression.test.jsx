import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const data = vi.hoisted(() => ({ investments: [] }))
vi.mock('../localData', () => ({
  getInvestments: () => data.investments,
  getSystemConfig: () => ({}), getTeamProfiles: () => [], findTeamProfile: () => null,
  saveSystemConfig: vi.fn(),
}))
vi.mock('../labels', () => ({ usePreviewTextMask: () => (text) => text }))

import { __testables as t, calculateDependencyPremium, getTeamsSnapshot, buildComboRetrospective } from '../analytics'
import { getMatchSourceIdentity } from '../investmentIdentity'
import { FragilityHeatmapCard } from '../../components/FragilityHeatmapCard'

const config = { initialCapital: 1000, riskCapRatio: 0.12, defaultOdds: 2.5 }
const leg = { home_team: 'A', away_team: 'B', conf: 0.6, odds: 2, entries: [{ name: 'win', odds: 2 }] }
const ticket = (extra = {}) => ({
  id: 'ticket', created_at: '2026-01-01T00:00:00Z', status: 'win',
  inputs: 100, profit: 100, expected_rating: 0.6, matches: [{ ...leg }], ...extra,
})
const forecast = (states) => ({ schema_version: 1, model_status: 'exact', states })

beforeEach(() => { data.investments = [] })

describe('forecast-aware Kelly replay', () => {
  it('never treats an ambiguous legacy mean as a multi-leg ticket probability', () => {
    const ambiguous = ticket({ matches: [leg, leg], combined_odds: 4 })
    expect(t.toKellySimulationRowsFromInvestments([ambiguous], config)).toEqual([])
    expect(t.toKellySimulationRowsFromInvestments([ticket()], config)[0].expected).toBe(0.6)
  })

  it('uses saved ticket states instead of the display score or current conf', () => {
    const investment = ticket({ matches: [leg, leg], forecast_snapshot: forecast([
      { probability: 0.36, gross: 4, net: 3 }, { probability: 0.64, gross: 0, net: -1 },
    ]) })
    const [row] = t.toKellySimulationRowsFromInvestments([investment], config)
    expect(row.expected).toBe(0.36)
    expect(t.calcKellyRowStake(row, 4, config)).toBeCloseTo(36.67, 0)
    investment.expected_rating = 0.95
    expect(t.toKellySimulationRowsFromInvestments([investment], config)[0]).toEqual(row)
  })

  it('retains multi-state tail returns instead of clipping to conditional odds', () => {
    const investment = ticket({ profit: 300, forecast_snapshot: forecast([
      { probability: 0.64, gross: 1, net: 0 }, { probability: 0.16, gross: 4, net: 3 },
      { probability: 0.2, gross: 0, net: -1 },
    ]) })
    const rows = t.toKellySimulationRowsFromInvestments([investment], config)
    const result = t.simulateKellyDivisorDeterministic(rows, 4, config)
    expect(result.samples).toBe(1)
    expect(result.roi).toBe(300)
    expect(result.totalProfit).toBe(result.totalInvest * 3)
  })

  it.each([
    forecast([null]),
    forecast([{ probability: 0.9, gross: 2, net: 1 }]),
    forecast([{ probability: 1, gross: 2, net: -1 }]),
    forecast([{ probability: NaN, gross: 2, net: 1 }]),
    { ...forecast([{ probability: 1, gross: 2, net: 1 }]), model_status: 'approximate' },
  ])('excludes malformed or unsupported snapshots, without legacy fallback', (snapshot) => {
    expect(t.toKellySimulationRowsFromInvestments([ticket({ forecast_snapshot: snapshot })])).toEqual([])
  })

  it('does not invent odds or profit for incomplete records', () => {
    expect(t.toKellySimulationRowsFromInvestments([ticket({ profit: null })])).toEqual([])
    expect(t.toKellySimulationRowsFromInvestments([ticket({ matches: [{ ...leg, odds: null }] })])).toEqual([])
  })
})

describe('temporal validation availability', () => {
  it('rejects unknown dates instead of treating them as epoch zero', () => {
    for (const createdAt of [undefined, null, '', '   ', 'bad-date']) {
      expect(Number.isNaN(t.getRowTemporalTs({ createdAt }))).toBe(true)
    }
    expect(t.getRowTemporalTs({ createdAt: 0 })).toBe(0)
    expect(t.buildPrequentialWalkForwardWindows(Array.from({ length: 30 }, () => ({})))).toEqual([])
  })

  it('removes undated rows from every chronological window', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString() }))
    const windows = t.buildPrequentialWalkForwardWindows([...rows, {}, { createdAt: 'bad' }])
    expect(windows.length).toBeGreaterThan(0)
    for (const window of windows) {
      expect([...window.trainRows, ...window.testRows].every((row) => Number.isFinite(t.getRowTemporalTs(row)))).toBe(true)
    }
  })
})

describe('risk diagnostics invariants', () => {
  const pair = { odds: 2 }
  const history = Array.from({ length: 10 }, (_, i) => ({
    createdAt: '2026-01-01T00:00:00Z',
    matches: [{ odds: 2, result: i >= 5 }, { odds: 2, result: i >= 5 }],
  }))

  it('does not manufacture significance when all kernel weights are rescaled', () => {
    const a = calculateDependencyPremium(pair, pair, history, 0, 1, Array(8).fill(1))
    const b = calculateDependencyPremium(pair, pair, history, 0, 1, Array(8).fill(2))
    expect(a.effectiveSampleSize).toBeCloseTo(b.effectiveSampleSize, 10)
    expect(a.pFailBothObserved).toBeCloseTo(b.pFailBothObserved, 10)
    expect(a.pValue).toBeCloseTo(b.pValue, 10)
    expect(a.pValueMethod).toBe('ess_normal_approximation')
  })

  it('does not let pending pair results enter recent-outcome calibration', () => {
    const pending = Array.from({ length: 10 }, () => ({
      createdAt: history[0].createdAt, matches: [{ odds: 2, result: undefined }, { odds: 2, result: true }],
    }))
    const a = calculateDependencyPremium(pair, pair, history, 0, 1, Array(8).fill(1))
    const b = calculateDependencyPremium(pair, pair, [...pending, ...history], 0, 1, Array(8).fill(1))
    expect(a.premium).toBeCloseTo(b.premium, 10)
    expect(a.sampleSize).toBe(b.sampleSize)
  })

  it('renders an unavailable card without NaN, percentages or a low-risk claim', () => {
    const html = renderToStaticMarkup(<FragilityHeatmapCard matches={[pair, pair]} expandedPair={{ i: 0, j: 1 }} />)
    expect(html).toContain('样本不足')
    expect(html).toContain('暂无可用的已结算匹配样本')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('0-100%')
    expect(html).not.toContain('No bias detected')
  })
})

it('team realized ROI excludes pending stakes rather than calling them losses', () => {
  data.investments = [ticket(), ticket({ id: 'pending', status: 'pending', inputs: 1000, profit: null })]
  const rows = getTeamsSnapshot()
  expect(rows).toHaveLength(2)
  expect(rows.every((row) => row.roi === 100 && row.totalSamples === 1)).toBe(true)
})

it('repeated plans cannot multiply the same resolved outcome evidence', () => {
  const a = { ...leg, id: 'a', is_correct: true }
  const b = { ...leg, id: 'b', is_correct: false }
  data.investments = [ticket({ id: 'source', matches: [a, b] })]
  const epoch = { recommendations: [{ layer: '主推', subset: [getMatchSourceIdentity(a, 'source'), getMatchSourceIdentity(b, 'source')] }] }
  const once = buildComboRetrospective([epoch])
  expect(once.legsHitMap['2'].total).toBe(1)
  expect(buildComboRetrospective([epoch, epoch, epoch])).toEqual(once)
})
