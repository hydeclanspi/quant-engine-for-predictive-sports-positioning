import { describe, expect, it } from 'vitest'
import { formatStructuredQuickInput } from '../quickInputPresentation.js'

describe('Quick Input structured receipt', () => {
  it('formats the exact normalized values that were applied to the form', () => {
    expect(formatStructuredQuickInput({
      actualInput: 30,
      comboName: '周末组合',
      matches: [{
        homeTeam: '皇马',
        awayTeam: '皇社',
        entries: [{ name: '-1 win', odds: '1.52' }],
        conf: 55,
        mode: '常规',
        tys_home: 'M',
        tys_away: 'L',
        fid: '0.4',
        fse_home: 50,
        fse_away: 64,
      }],
    })).toBe([
      '解析完成 · 单场',
      '标题｜周末组合',
      '投入｜¥30',
      '',
      '1｜皇马 vs 皇社',
      '投注｜-1 win @ 1.52',
      'Conf 0.55 · Mode 常规',
      'TYS M/L · FID 0.4 · FSE 0.50/0.64',
    ].join('\n'))
  })

  it('marks missing fields instead of inventing data', () => {
    const output = formatStructuredQuickInput({ matches: [{ entries: [{}] }] })
    expect(output).toContain('待补充 vs 待补充')
    expect(output).toContain('投注｜待补充')
  })
})
