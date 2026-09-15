import { describe, expect, it } from 'vitest'
import { parseNaturalInput } from '../naturalInputParser.js'

describe('local natural investment parsing defaults', () => {
  it('keeps missing FSE as a team-history default marker', () => {
    const result = parseNaturalInput('利兹联 win 拜仁 odds 2.4')
    expect(result.matches[0]).toMatchObject({ fse_home: 'default', fse_away: 'default' })
  })

  it('treats an unlabelled value above one as odds, not a model parameter', () => {
    const result = parseNaturalInput('利兹联 win 拜仁 2.4 30块')
    expect(result.matches[0].entries[0].odds).toBe('2.4')
    expect(result.actualInput).toBe(30)
  })
})
