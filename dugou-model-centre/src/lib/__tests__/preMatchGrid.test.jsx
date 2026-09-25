import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PreMatchGridView from '../../components/PreMatchGridView'

describe('pre-match scoreline grid (投前研判)', () => {
  const html = renderToStaticMarkup(<PreMatchGridView />)

  it('renders the full 9×9 scoreline grid', () => {
    const cells = html.match(/data-testid="pre-grid-cell-/g) || []
    expect(cells).toHaveLength(81)
  })

  it('shows the market probabilities implied by the registered 2-1 point', () => {
    // pointForecastToLambda(2,1) = (1.835, 1.045) → 主胜 55.9% / 平 22.8% / 客胜 21.4%
    expect(html).toContain('55.9%')
    expect(html).toContain('22.8%')
    expect(html).toContain('21.4%')
  })

  it('marks the registered cell and stays explicitly display-only', () => {
    expect(html).toContain('ring-2 ring-stone-800')
    expect(html).toContain('不写入草稿、不影响生产概率')
    expect(html).toContain('θ 需要结算样本')
  })
})
