import { describe, expect, it } from 'vitest'
import {
  AI_PARSE_MAX_COMBOS,
  AI_PARSE_MAX_ENTRIES,
  AI_PARSE_MAX_MATCHES,
  parseJsonObjectText,
  sanitizeAiInvestmentParse,
} from '../aiInvestmentSchema.js'

const validMatch = (index = 0) => ({
  homeTeam: `主队 ${index}`,
  awayTeam: `客队 ${index}`,
  entries: [{ name: '-1 win', odds: '1.52' }],
  conf: 0.55,
  mode: '保险产品',
  tys_home: 'l',
  tys_away: 'H',
  fid: 0.55,
  fse_home: 0.63,
  fse_away: 72,
  note: 'demo',
})

describe('AI investment payload allow-list', () => {
  it('normalizes a valid model response into form-safe values', () => {
    const result = sanitizeAiInvestmentParse({
      confidence: 0.86,
      combos: [{
        actualInput: '134.55',
        comboName: '周末组合',
        matches: [validMatch()],
      }],
      warnings: ['赔率需要复核'],
      injected: '<script>alert(1)</script>',
    })

    expect(result).toEqual({
      ok: true,
      confidence: 0.86,
      combos: [{
        actualInput: 134.55,
        comboName: '周末组合',
        matches: [{
          homeTeam: '主队 0',
          awayTeam: '客队 0',
          entries: [{ name: '-1 win', odds: '1.52' }],
          conf: 55,
          mode: '保险产品',
          tys_home: 'L',
          tys_away: 'H',
          fid: '0.6',
          fse_home: 63,
          fse_away: 72,
          note: 'demo',
        }],
      }],
      warnings: ['赔率需要复核'],
      diagnostics: [{ level: 'warning', message: '赔率需要复核' }],
    })
    expect(result.injected).toBeUndefined()
  })

  it('bounds collections and unsafe numeric values', () => {
    const oversized = Array.from({ length: 9 }, (_, index) => ({
      ...validMatch(index),
      entries: Array.from({ length: 9 }, (__, entryIndex) => ({
        name: `entry ${entryIndex}`,
        odds: entryIndex === 0 ? 9999 : 2,
      })),
      conf: 999,
      mode: 'invented mode',
      tys_home: 'X',
    }))
    const result = sanitizeAiInvestmentParse({
      confidence: 99,
      combos: Array.from({ length: 9 }, () => ({ actualInput: 99_000_000, matches: oversized })),
    })

    expect(result.ok).toBe(true)
    expect(result.combos).toHaveLength(AI_PARSE_MAX_COMBOS)
    expect(result.combos[0].matches).toHaveLength(AI_PARSE_MAX_MATCHES)
    expect(result.combos[0].matches[0].entries).toHaveLength(AI_PARSE_MAX_ENTRIES)
    expect(result.combos[0].matches[0].entries[0].odds).toBe('')
    expect(result.combos[0].matches[0].conf).toBe(100)
    expect(result.combos[0].matches[0].mode).toBe('常规')
    expect(result.combos[0].matches[0].tys_home).toBe('M')
    expect(result.combos[0].actualInput).toBeNull()
    expect(result.confidence).toBe(1)
  })

  it('wraps the former single-ticket response into combos during rollout', () => {
    const result = sanitizeAiInvestmentParse({
      confidence: 0.7,
      actualInput: 30,
      comboName: '旧格式',
      matches: [validMatch()],
    })
    expect(result.ok).toBe(true)
    expect(result.combos).toHaveLength(1)
    expect(result.combos[0]).toMatchObject({ actualInput: 30, comboName: '旧格式' })
  })

  it('accepts raw or fenced JSON and rejects non-objects', () => {
    expect(parseJsonObjectText('{"matches":[]}')).toEqual({ matches: [] })
    expect(parseJsonObjectText('```json\n{"matches":[]}\n```')).toEqual({ matches: [] })
    expect(parseJsonObjectText('[1, 2]')).toBeNull()
    expect(parseJsonObjectText('not json')).toBeNull()
    expect(sanitizeAiInvestmentParse({ matches: [] })).toEqual({ ok: false, reason: 'no_matches' })
  })
})
