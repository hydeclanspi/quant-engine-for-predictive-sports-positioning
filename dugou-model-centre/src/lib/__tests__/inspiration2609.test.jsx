import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import Inspiration2609Shell from '../../components/Inspiration2609Shell'
import PortfolioComposition from '../../components/PortfolioComposition'
import {
  INSPIRATION_2609_NAME,
  INSPIRATION_2609_MATERIALS,
  getInspiration2609Surface,
} from '../../design/inspiration2609'

const renderShell = (pathname, layoutMode = 'inpiration') =>
  renderToStaticMarkup(
    <Inspiration2609Shell
      pathname={pathname}
      layoutMode={layoutMode}
      header={<header className="mn-bar">Original navigation</header>}
      contentClassName="page-enter app-main-content"
      footer={<footer>Original footer</footer>}
      modal={<aside>Original detail dialog</aside>}
    >
      <section>Original business page</section>
    </Inspiration2609Shell>,
  )

describe('inspiration 2609 selected page composition', () => {
  it('assigns every existing page to the exact requested material', () => {
    expect(INSPIRATION_2609_NAME).toBe('inspiration 2609')
    expect(INSPIRATION_2609_MATERIALS).toEqual({
      '/': 'folio',
      '/new': 'folio',
      '/combo': 'folio',
      '/settle': 'glacier',
      '/dashboard': 'prism',
      '/dashboard/analysis': 'prism',
      '/dashboard/metrics': 'prism',
      '/dashboard/report': 'prism',
      '/history': 'prism',
      '/history/teams': 'peach',
      '/params': 'modern',
    })
    for (const [route, material] of Object.entries(
      INSPIRATION_2609_MATERIALS,
    )) {
      expect(getInspiration2609Surface(route).material).toBe(material)
      expect(getInspiration2609Surface(`${route}/`).material).toBe(material)
    }
  })

  it('keeps the original header outside the laboratory CSS ancestor', () => {
    for (const route of [
      '/new',
      '/combo',
      '/settle',
      '/dashboard',
      '/history',
    ]) {
      const { material } = getInspiration2609Surface(route)
      const markup = renderShell(route)
      expect(markup).toContain(
        `data-inspiration-material="${material}"><header class="mn-bar">Original navigation</header><div`,
      )
      expect(markup).toContain(`data-lab-edition="${material}"`)
      expect(markup).not.toContain('lab-edition-bar')
      expect(markup).toContain('Original business page')
      expect(markup).toContain('Original detail dialog')
    }
  })

  it('never mounts laboratory styles or optical layers around Console', () => {
    for (const route of [
      '/params',
      '/params/',
    ]) {
      expect(getInspiration2609Surface(route).laboratory).toBe(false)
      const markup = renderShell(route)
      expect(markup).not.toContain('lab-editions')
      expect(markup).not.toContain('data-lab-edition=')
      expect(markup).not.toContain('lab-optical-field')
      expect(markup).toContain('Original business page')
    }
    expect(getInspiration2609Surface('/unknown').laboratory).toBe(false)
  })

  it('gives Seasons a Prism canvas and Teams only a peach canvas, not Lab cards', () => {
    expect(renderShell('/dashboard/report')).toContain('data-lab-edition="prism"')
    const teams = renderShell('/history/teams')
    expect(teams).toContain('inspiration-peach-canvas')
    expect(teams).toContain('lab-optical-field')
    expect(teams).not.toContain('lab-editions')
    expect(teams).toContain('Original business page')
  })

  it('can compare against Modern without changing the route or business components', () => {
    for (const route of Object.keys(INSPIRATION_2609_MATERIALS)) {
      expect(getInspiration2609Surface(route, 'modern')).toEqual({
        material: 'modern',
        laboratory: false,
      })
      expect(renderShell(route, 'modern')).not.toContain('lab-editions')
      expect(renderShell(route, 'modern')).not.toContain('theme-inspiration-2609')
    }
  })

  it('only tints the existing header and scopes reduced corners to Prism', () => {
    const css = readFileSync(
      new URL('../../design/inspiration2609.css', import.meta.url),
      'utf8',
    )
    const sheet = postcss.parse(css)
    sheet.walkRules((rule) => {
      expect(rule.selector).toMatch(
        /^\.theme-inspiration-2609|^\.inspiration-2609-body/,
      )
      if (rule.selector.endsWith('> .mn-bar')) {
        for (const declaration of rule.nodes)
          expect(['background', 'border-bottom-color']).toContain(
            declaration.prop,
          )
      }
      if (rule.nodes.some((node) => node.prop === '--lab-radius')) {
        expect(rule.selector).toContain("[data-lab-edition='prism']")
        expect(
          rule.nodes.find((node) => node.prop === '--lab-radius').value,
        ).toBe('10px')
      }
    })
  })
})

describe('Portfolio presentation-only composition', () => {
  const cards = {
    main: <div className="combo-main-grid combo-left-collapsed"><article>candidates</article><article>package</article></div>,
    secondary: <div className="combo-secondary-grid"><article>ranking</article><article>layers</article></div>,
    algorithm: <article>algorithm</article>,
    details: <section>details</section>,
  }

  it('keeps Modern markup and ordering unchanged', () => {
    expect(renderToStaticMarkup(<PortfolioComposition {...cards} />)).toBe(
      renderToStaticMarkup(<>{cards.main}{cards.details}{cards.secondary}{cards.algorithm}</>),
    )
  })

  it('moves existing cards into 3 + 2 rows without duplicating controls', () => {
    const [primary, research] = PortfolioComposition({ ...cards, inspiration: true }).props.children
    for (const row of [primary, research]) {
      const keys = row.props.children.map((card) => card.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
    const markup = renderToStaticMarkup(<PortfolioComposition {...cards} inspiration />)
    expect(markup).toContain('data-left-collapsed="true"')
    expect(markup).toContain('combo-main-grid combo-left-collapsed')
    expect(markup).toContain('<article>candidates</article><article>package</article><article>layers</article></div>')
    expect(markup).toContain('class="portfolio-research-grid"><article>ranking</article><article>algorithm</article></div>')
    for (const label of ['candidates', 'package', 'ranking', 'layers', 'algorithm', 'details']) {
      expect(markup.match(new RegExp(`>${label}<`, 'g'))).toHaveLength(1)
    }
  })
})
