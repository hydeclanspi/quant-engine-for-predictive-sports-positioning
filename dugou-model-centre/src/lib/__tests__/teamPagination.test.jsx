import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { paginateItems, paginationSteps, TEAM_PAGE_SIZE } from '../pagination'
import TeamPagination from '../../components/TeamPagination'
import InspirationIcon from '../../components/InspirationIcon'

describe('team archive pagination', () => {
  const teams = Array.from({ length: 53 }, (_, i) => ({ name: `team-${i}` }))
  it('shows seven rows of three teams and preserves the original ordering', () => {
    expect(TEAM_PAGE_SIZE).toBe(21)
    expect([1, 2, 3].flatMap(page => paginateItems(teams, page).items)).toEqual(teams)
    expect(paginateItems(teams, 2)).toMatchObject({ page: 2, totalPages: 3, from: 22, to: 42 })
    expect(paginateItems(teams, 3).items).toHaveLength(11)
  })
  it('clamps stale page numbers after filters narrow the list', () => {
    expect(paginateItems(teams.slice(0, 3), 3)).toMatchObject({ page: 1, totalPages: 1, from: 1, to: 3 })
    expect(paginateItems([], 7)).toEqual({ page: 1, totalPages: 1, from: 0, to: 0, items: [] })
    expect(paginateItems(teams, -1).page).toBe(1)
    expect(paginateItems(teams, NaN).page).toBe(1)
    expect(paginateItems(teams.slice(0, 42), 3).items).toHaveLength(21)
  })
  it('keeps long pagination compact with stable first and last pages', () => {
    expect(paginationSteps(1, 3)).toEqual([1, 2, 3])
    expect(paginationSteps(5, 20)).toEqual([1, 'gap-4', 4, 5, 6, 'gap-20', 20])
    expect(paginationSteps(3, 8)).toEqual([1, 2, 3, 4, 'gap-8', 8])
  })
  it('exposes the active page and disables unavailable arrows', () => {
    const markup = renderToStaticMarkup(<TeamPagination {...paginateItems(teams, 1)} total={teams.length} onChange={() => {}} />)
    expect(markup).toContain('aria-label="球队分页"')
    expect(markup).toContain('aria-label="第 1 页球队" aria-current="page"')
    expect(markup).toContain('aria-label="上一页球队" disabled=""')
    expect(markup).not.toContain('aria-label="下一页球队" disabled=""')
  })
})

describe('Inspiration selected identity', () => {
  it('uses the chosen overlap geometry at both navigation and Console sizes', () => {
    for (const size of [13, 24]) {
      const svg = renderToStaticMarkup(<InspirationIcon size={size} />)
      expect(svg).toContain(`width="${size}"`)
      expect(svg).toContain('viewBox="0 0 24 24"')
      expect(svg).toContain('d="m8 3 8 8-8 8-6-8Z"')
      expect(svg).toContain('d="m16 5 6 8-6 8-8-8Z"')
      expect(svg.match(/<path /g)).toHaveLength(2)
    }
  })
})
