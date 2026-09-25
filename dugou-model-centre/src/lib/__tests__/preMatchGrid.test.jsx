import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PreMatchGridView from '../../components/PreMatchGridView'

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
    // 3-0 登记 → 深框落在 3-0 格，主胜 84.8%
    expect(html).toContain('data-testid="pre-grid-cell-3-0"')
    expect(html).toContain('84.8%')
    const cells = html.match(/data-testid="pre-grid-cell-/g) || []
    expect(cells).toHaveLength(81)
  })

  it('shows the market probabilities implied by the registered 2-1 point', () => {
    // pointForecastToLambda(2,1) = (1.835, 1.045) → 主胜 55.9% / 平 22.8% / 客胜 21.4%
    const html = renderToStaticMarkup(<PreMatchGridView detectedPoint={{ home: 2, away: 1 }} />)
    expect(html).toContain('55.9%')
    expect(html).toContain('22.8%')
    expect(html).toContain('21.4%')
  })

  it('marks the registered cell and stays explicitly display-only', () => {
    const html = renderToStaticMarkup(<PreMatchGridView detectedPoint={{ home: 2, away: 1 }} />)
    expect(html).toContain('ring-2 ring-stone-800')
    expect(html).toContain('不写入草稿、不影响生产概率')
    expect(html).toContain('θ 需要结算样本')
  })

  it('exposes the institutional market-pricing channel with 1X2 and totals inputs', () => {
    const html = renderToStaticMarkup(<PreMatchGridView detectedPoint={{ home: 2, away: 1 }} />)
    expect(html).toContain('data-testid="pre-grid-market-channel"')
    ;['home', 'draw', 'away', 'over', 'under'].forEach((key) => {
      expect(html).toContain(`data-testid="pre-grid-odds-${key}"`)
    })
    expect(html).toContain('机构市场')
    expect(html).toContain('填入机构赔率')
  })
})
