import { describe, expect, it } from 'vitest'
import {
  formatStructuredSettlementInput,
  parseSettlementLocally,
  resolveAiSettlementParse,
} from '../settlementQuickInput.js'

const pending = [{
  id: 'inv_1', date: '09-15', comboName: '北伦敦', totalInputs: 30,
  matches: [{ homeTeam: '皇马', awayTeam: '皇社', entry: 'win' }],
}, {
  id: 'inv_2', date: '09-14', comboName: '', totalInputs: 20,
  matches: [{ homeTeam: '巴萨', awayTeam: '皇马', entry: 'draw' }],
}]

describe('settlement Quick Input matching', () => {
  it('resolves IDs and match indices, then formats a review receipt', () => {
    const result = resolveAiSettlementParse({
      ok: true,
      settlements: [{
        pendingId: 'inv_1', reference: '北伦敦', revenues: 58,
        matches: [{ matchIndex: 0, homeTeam: '', awayTeam: '', results: '2-1', isCorrect: true, matchRating: null, matchRep: null, postNote: '' }],
      }],
      diagnostics: [],
    }, pending)
    expect(result.resolved).toHaveLength(1)
    expect(result.resolved[0]).toMatchObject({ comboId: 'inv_1', revenues: 58 })
    expect(formatStructuredSettlementInput(result, pending)).toContain('09-15 · 北伦敦')
    expect(formatStructuredSettlementInput(result, pending)).toContain('皇马 vs 皇社 · 2-1 · 命中')
  })

  it('falls back to a unique team matchup if the model omits the id', () => {
    const result = resolveAiSettlementParse({
      settlements: [{
        pendingId: '', reference: '', revenues: 0,
        matches: [{ matchIndex: null, homeTeam: '巴萨', awayTeam: '皇马', results: '3-3', isCorrect: true }],
      }],
    }, pending)
    expect(result.resolved[0].comboId).toBe('inv_2')
    expect(result.resolved[0].matchPatches[0].matchIndex).toBe(0)
  })

  it('locally parses numbered scores and revenue without AI', () => {
    const local = parseSettlementLocally('1. 皇马2-1皇社 收入58\n2. 巴萨3-3皇马 收入0', pending)
    expect(local.settlements).toHaveLength(2)
    expect(local.settlements[0]).toMatchObject({ pendingId: 'inv_1', revenues: 58 })
    expect(local.settlements[0].matches[0]).toMatchObject({ results: '2-1', isCorrect: true })
    expect(local.settlements[1].matches[0]).toMatchObject({ results: '3-3', isCorrect: true })
  })
})
