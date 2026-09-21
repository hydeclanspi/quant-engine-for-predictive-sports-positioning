import { describe, expect, it } from 'vitest'
import { probabilityLoss, validatesProbabilityUpdate } from '../adaptiveValidation'
describe('proper-loss promotion gate', () => {
  it('prefers calibrated probabilities and is invariant to currency units', () => {
    const rows = [{ actual: 0, profit: -10 }, { actual: 1, profit: 20 }]
    expect(probabilityLoss(rows, () => 0.5).brier).toBe(0.25)
    expect(probabilityLoss(rows, () => 0.9).brier).toBeCloseTo(0.41)
    expect(probabilityLoss(rows.map((r) => ({ ...r, profit: r.profit * 1000 })), () => 0.5)).toEqual(probabilityLoss(rows, () => 0.5))
  })
  it('rejects missing, unchanged and log-loss-worsening proposals', () => {
    const baseline = { brier: 0.25, logLoss: 0.7 }
    expect(validatesProbabilityUpdate(baseline, baseline)).toBe(false)
    expect(validatesProbabilityUpdate(baseline, { brier: 0.2, logLoss: 0.8 })).toBe(false)
    expect(validatesProbabilityUpdate(baseline, { brier: NaN, logLoss: 0.6 })).toBe(false)
    expect(validatesProbabilityUpdate(baseline, { brier: 0.2, logLoss: 0.6 })).toBe(true)
  })
})
