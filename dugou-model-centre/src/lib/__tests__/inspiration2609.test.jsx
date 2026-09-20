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
    expect(INSPIRATION_2609_NAME).toBe('Inspiration')
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

  it('only tints the existing header and scopes material corner overrides to Prism and Glacier', () => {
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
        const radius = rule.nodes.find((node) => node.prop === '--lab-radius').value
        if (rule.selector.includes("[data-lab-edition='prism']")) {
          expect(radius).toBe('10px')
        } else {
          expect(rule.selector).toContain("[data-lab-edition='glacier']")
          expect(radius).toBe('26px')
        }
      }
    })
  })

  it('restores Seasons to the same Modern page widths and gutters as Settle and Records', () => {
    const sheet = postcss.parse(readFileSync(
      new URL('../../design/inspiration2609.css', import.meta.url), 'utf8',
    ))
    const geometry = []
    sheet.walkRules((rule) => {
      if (!rule.selector.includes("[data-lab-page='dashboard_report']") || !rule.selector.endsWith('.page-shell')) return
      expect(rule.selector).toContain("[data-lab-page='settle']")
      expect(rule.selector).toContain("[data-lab-page='history']")
      geometry.push({
        breakpoint: rule.parent.type === 'atrule' ? rule.parent.params : 'base',
        width: rule.nodes.find((node) => node.prop === 'width')?.value,
        padding: rule.nodes.find((node) => node.prop === 'padding')?.value,
      })
    })
    expect(geometry).toEqual([
      { breakpoint: 'base', width: 'min(100%, 1320px)', padding: 'clamp(24px, 3vw, 48px) clamp(20px, 4vw, 56px)' },
      { breakpoint: '(min-width: 1440px)', width: undefined, padding: '48px 64px' },
      { breakpoint: '(min-width: 1680px)', width: 'min(100%, 1440px)', padding: '56px 80px' },
    ])
  })
})

describe('Portfolio presentation-only composition', () => {
  it('gives desktop cards breathing room without fixed heights or Modern overrides', () => {
    const sheet = postcss.parse(readFileSync(
      new URL('../../design/inspiration2609.css', import.meta.url), 'utf8',
    ))
    const heights = []
    sheet.walkRules((rule) => {
      if (!rule.selector.includes('.portfolio-')) return
      expect(rule.selector).toContain('.theme-inspiration-2609')
      for (const node of rule.nodes) {
        expect(node.prop).not.toBe('height')
        if (node.prop === 'min-height') {
          expect(rule.parent.type).toBe('atrule')
          heights.push(node.value)
        }
      }
      if (rule.selector.includes(':has(.portfolio-package-empty)')) {
        expect(rule.selector).toContain("[data-left-collapsed='true']")
        expect(rule.nodes.some(node => node.prop === 'align-items' && node.value === 'stretch')).toBe(true)
      }
    })
    expect(heights).toContain('clamp(360px, 24vw, 420px)')
    expect(heights).toContain('clamp(320px, 25vw, 420px)')
  })

  const cards = {
    main: <div className="combo-main-grid combo-left-collapsed"><article>candidates</article><article>package</article></div>,
    secondary: <div className="combo-secondary-grid"><article>ranking</article><article>layers</article></div>,
    algorithm: <article>algorithm</article>,
    details: <section>details</section>,
    fragility: <section>fragility</section>,
  }

  it('keeps Modern markup and ordering unchanged', () => {
    expect(renderToStaticMarkup(<PortfolioComposition {...cards} />)).toBe(
      renderToStaticMarkup(<>{cards.main}{cards.details}{cards.fragility}{cards.secondary}{cards.algorithm}</>),
    )
  })

  it('moves existing cards into 3 + 2 rows plus the fragility band without duplicating controls', () => {
    const [primary, fragility, research] = PortfolioComposition({ ...cards, inspiration: true }).props.children
    expect(fragility).toBe(cards.fragility)
    for (const row of [primary, research]) {
      const keys = row.props.children.map((card) => card.key)
      expect(new Set(keys).size).toBe(keys.length)
    }
    const markup = renderToStaticMarkup(<PortfolioComposition {...cards} inspiration />)
    expect(markup).toContain('data-left-collapsed="true"')
    expect(markup).toContain('combo-main-grid combo-left-collapsed')
    expect(markup).toContain('<article>candidates</article><article>package</article><article>layers</article></div>')
    expect(markup).toContain('<section>fragility</section><div class="portfolio-research-grid"><article>ranking</article><article>algorithm</article></div>')
    for (const label of ['candidates', 'package', 'ranking', 'layers', 'algorithm', 'details', 'fragility']) {
      expect(markup.match(new RegExp(`>${label}<`, 'g'))).toHaveLength(1)
    }
  })
})
