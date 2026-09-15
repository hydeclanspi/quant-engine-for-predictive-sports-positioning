import { describe, expect, it } from 'vitest'
import {
  CONCEPTS,
  DESIGN_PAGES,
  SAMPLE_ROWS,
  EQUITY,
  DEMO_METRICS,
} from '../../design/inpirationConcepts'

describe('isolated design proposal fixtures', () => {
  it('provides three distinct concepts across all ten product surfaces', () => {
    expect(new Set(CONCEPTS.map((c) => c.id)).size).toBe(3)
    expect(new Set(DESIGN_PAGES.map((p) => p.id)).size).toBe(10)
    CONCEPTS.forEach((c) => expect(c.palette).toHaveLength(5))
  })
  it('keeps the 24-row ledger, curve and summary numerically consistent', () => {
    expect(SAMPLE_ROWS).toHaveLength(24)
    expect(SAMPLE_ROWS.reduce((sum, row) => sum + row.stake, 0)).toBe(2400)
    expect(SAMPLE_ROWS.reduce((sum, row) => sum + row.revenue, 0)).toBe(2844)
    SAMPLE_ROWS.forEach((row, i) => {
      expect(row.revenue).toBeGreaterThanOrEqual(0)
      expect(row.revenue - row.stake).toBe(row.profit)
      expect(EQUITY[i + 1] - EQUITY[i]).toBe(row.profit)
    })
    expect(EQUITY.at(-1)).toBe(1444)
    expect(DEMO_METRICS).toHaveLength(12)
    expect(DEMO_METRICS.find((m) => m[0] === '平均 ROI')[1]).toBe('+18.5%')
  })
})
