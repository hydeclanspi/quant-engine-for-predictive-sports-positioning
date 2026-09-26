import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PreMatchGridView from '../../components/PreMatchGridView'
import { learnTeamBias } from '../../lib/readQuality'

// 阿森纳主场登记 2、实际 1（高估 1）×5；埃弗顿客场登记 1、实际 2（低估 1）×5。
const makeBiasModel = () =>
  learnTeamBias(
    Array.from({ length: 5 }, (_, i) => ({
      date: new Date(2026, 8, 20 - i).toISOString(),
      homeTeam: '阿森纳',
      awayTeam: '埃弗顿',
      primaryPoint: { home: 2, away: 1 },
      actual: { home: 1, away: 2 },
    })),
  )

describe('pre-match scoreline grid (投前研判)', () => {
  it('is collapsed by default and only shows the header line', () => {
    const html = renderToStaticMarkup(<PreMatchGridView />)
    expect(html).toContain('data-testid="pre-match-grid"')
    expect(html).toContain('投前研判 · 比分网格')
    // 折叠时：不渲染主体、不渲染市场通道，但给出登记摘要
    expect(html).not.toContain('data-testid="pre-match-grid-body"')
    expect(html).not.toContain('data-testid="pre-grid-market-channel"')
    expect(html).toContain('登记 2-1')
  })

  it('expands and follows the scoreline detected from the entry field', () => {
    const html = renderToStaticMarkup(<PreMatchGridView detectedPoint={{ home: 3, away: 0 }} />)
    expect(html).toContain('data-testid="pre-match-grid-body"')
    expect(html).toContain('跟随右侧比分')
    // 3-0 登记 → 渲染成云图（不再有表格格），右侧给出等价盘口
    expect(html).toContain('data-testid="pre-match-cloud"')
    expect(html).toContain('84.8%')
  })

  it('shows the market probabilities implied by the registered 2-1 point', () => {
    // pointForecastToLambda(2,1) = (1.835, 1.045) → 主胜 55.9% / 平 22.8% / 客胜 21.4%
    const html = renderToStaticMarkup(<PreMatchGridView detectedPoint={{ home: 2, away: 1 }} />)
    expect(html).toContain('55.9%')
    expect(html).toContain('22.8%')
    expect(html).toContain('21.4%')
  })

  it('marks the registered point on the cloud and explains the insist override', () => {
    const html = renderToStaticMarkup(<PreMatchGridView detectedPoint={{ home: 2, away: 1 }} />)
    expect(html).toContain('圆点是你登记的比分')
    expect(html).toContain('「我坚持」时按你的原始输入计算这场的仓位')
  })

  it('shows the per-team bias correction and the insist toggle', () => {
    const html = renderToStaticMarkup(
      <PreMatchGridView
        detectedPoint={{ home: 2, away: 1 }}
        biasModel={makeBiasModel()}
        homeTeam="阿森纳"
        awayTeam="埃弗顿"
        matchEntries={[{ market_type: 'result', parse_detail: { outcome: 'win' } }]}
      />,
    )
    expect(html).toContain('data-testid="pre-grid-correction"')
    expect(html).toContain('data-testid="pre-grid-insist-toggle"')
    expect(html).toContain('修正后')
    expect(html).toContain('用修正后（默认）')
    // 偏差行：阿森纳高估、埃弗顿低估，都显示出来
    expect(html).toContain('阿森纳')
    expect(html).toContain('高估')
    expect(html).toContain('低估')
  })

  it('exposes the institutional market-pricing channel with 1X2 and totals inputs', () => {
    const html = renderToStaticMarkup(<PreMatchGridView detectedPoint={{ home: 2, away: 1 }} />)
    expect(html).toContain('data-testid="pre-grid-market-channel"')
    ;['home', 'draw', 'away', 'over', 'under'].forEach((key) => {
      expect(html).toContain(`data-testid="pre-grid-odds-${key}"`)
    })
    expect(html).toContain('机构市场')
    expect(html).toContain('手工填入')
  })

  it('offers the one-click official odds fetch (scoreline pool included)', () => {
    const html = renderToStaticMarkup(<PreMatchGridView detectedPoint={{ home: 2, away: 1 }} />)
    expect(html).toContain('data-testid="pre-grid-official-fetch"')
    expect(html).toContain('官方赔率')
    // 未拉取前不出现场次选择器
    expect(html).not.toContain('data-testid="pre-grid-official-select"')
  })
})
