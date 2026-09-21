import { describe, expect, it } from 'vitest'
import { getReturnRiskRatios } from '../returnRisk'

describe('per-investment risk ratios', () => {
  it('identical losses still have nonzero downside deviation', () => {
    const ratios = getReturnRiskRatios([-0.1, -0.1, 0.3])
    expect(ratios.downsideDeviation).toBeCloseTo(Math.sqrt(0.02 / 3))
    expect(ratios.sortino).toBeCloseTo((0.1 / 3) / Math.sqrt(0.02 / 3))
  })
  it('duplicating the sample does not manufacture annualization', () => {
    const rows = [-0.1, 0.2, 0.1]
    const a = getReturnRiskRatios(rows), b = getReturnRiskRatios([...rows, ...rows])
    expect(a.sharpe).toBeCloseTo(b.sharpe)
    expect(a.sortino).toBeCloseTo(b.sortino)
  })
  it('zero denominator is unavailable, not a fabricated ratio', () => {
    expect(Number.isNaN(getReturnRiskRatios([]).sortino)).toBe(true)
    expect(Number.isNaN(getReturnRiskRatios([0.1, 0.2]).sortino)).toBe(true)
    expect(Number.isNaN(getReturnRiskRatios([0.1, 0.1]).sharpe)).toBe(true)
    expect(getReturnRiskRatios([-0.1, -0.1]).sortino).toBe(-1)
  })
})
