import { describe, expect, it } from 'vitest'
import {
  sanitizeAiSettlementParse,
  sanitizePendingSettlementContext,
} from '../aiSettlementSchema.js'

describe('AI settlement allow-list', () => {
  it('normalizes settlement fields without inventing missing values', () => {
    const result = sanitizeAiSettlementParse({
      confidence: 0.91,
      settlements: [{
        pendingId: 'inv_1',
        reference: '第一单',
        revenues: 0,
        matches: [{
          matchIndex: 0,
          homeTeam: '皇马',
          awayTeam: '皇社',
          results: '2-1',
          isCorrect: '命中',
          matchRating: 0.68,
          matchRep: 1.2,
          postNote: '红牌改变走势',
          injected: 'drop',
        }],
      }],
      warnings: [],
    })
    expect(result).toMatchObject({ ok: true, confidence: 0.91 })
    expect(result.settlements[0]).toMatchObject({ pendingId: 'inv_1', revenues: 0 })
    expect(result.settlements[0].matches[0]).toEqual({
      matchIndex: 0,
      homeTeam: '皇马',
      awayTeam: '皇社',
      results: '2-1',
      isCorrect: true,
      matchRating: 0.68,
      matchRep: 1.2,
      postNote: '红牌改变走势',
    })
  })

  it('drops out-of-range optional metrics instead of clamping them', () => {
    const result = sanitizeAiSettlementParse({
      settlements: [{ pendingId: 'inv_1', revenues: null, matches: [{ matchIndex: 9, matchRating: 0.9, matchRep: 2 }] }],
    })
    expect(result.settlements[0].revenues).toBeNull()
    expect(result.settlements[0].matches[0]).toMatchObject({ matchIndex: null, matchRating: null, matchRep: null })
  })

  it('creates a compact, allow-listed pending context', () => {
    expect(sanitizePendingSettlementContext([{
      id: 'inv_1', date: '09-15', comboName: '测试', totalInputs: 30, secret: 'drop',
      matches: [{ homeTeam: 'A', awayTeam: 'B', entry: 'win', odds: 2 }],
    }])).toEqual([{
      pendingId: 'inv_1', ordinal: 1, date: '09-15', comboName: '测试', inputs: 30,
      matches: [{ matchIndex: 0, homeTeam: 'A', awayTeam: 'B', prediction: 'win' }],
    }])
  })
})
