import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LAB_EDITIONS,
  getDesignPreviewBase,
  getLabReturnPath,
  normalizeLabEdition,
  readLabEdition,
} from '../../design/labEditions'
import {
  FULL_MODE,
  PREVIEW_MODE,
  getDisplayMode,
  unlockWithToken,
  lockToPreview,
} from '../displayMode'

afterEach(() => vi.unstubAllGlobals())

describe('lab preview routes and visual-only preferences', () => {
  it('mounts every existing page below public and owner preview basenames', () => {
    const routes = [
      '',
      '/new',
      '/combo',
      '/settle',
      '/dashboard',
      '/dashboard/report',
      '/dashboard/metrics',
      '/dashboard/analysis',
      '/history',
      '/history/teams',
      '/params',
    ]
    for (const prefix of ['', '/arsenal']) {
      for (const route of routes) {
        expect(
          getDesignPreviewBase(`${prefix}/design/inpiration${route}`),
        ).toBe(`${prefix}/design/inpiration`)
      }
    }
    for (const route of [
      '/new',
      '/arsenal/new',
      '/design/inpiration-other',
      '/other/design/inpiration',
    ])
      expect(getDesignPreviewBase(route)).toBeNull()
  })
  it('provides four schemes and validates shared URLs without affecting saved layout', () => {
    expect(LAB_EDITIONS).toHaveLength(4)
    expect(new Set(LAB_EDITIONS.map((e) => e.id)).size).toBe(4)
    expect(readLabEdition('?edition=cobalt', { getItem: () => 'folio' })).toBe(
      'cobalt',
    )
    expect(readLabEdition('', { getItem: () => 'folio' })).toBe('folio')
    expect(readLabEdition('?edition=2609', { getItem: () => 'folio' })).toBe(
      '2609',
    )
    expect(readLabEdition('?edition=unknown', {})).toBe('2609')
    expect(
      readLabEdition('', {
        getItem() {
          throw Error('blocked')
        },
      }),
    ).toBe('2609')
    expect(normalizeLabEdition('modern')).toBe('2609')
    expect(getLabReturnPath('/arsenal/design/inpiration/new')).toBe(
      '/arsenal/new',
    )
    expect(getLabReturnPath('/design/inpiration/new')).toBe('/new')
  })
  it('keeps even owner and unlocked previews in the existing in-memory demo store', () => {
    const write = vi.fn(),
      remove = vi.fn(),
      read = vi.fn(() => '1')
    const browser = {
      location: { pathname: '/arsenal/design/inpiration/settle' },
      sessionStorage: { getItem: read, setItem: write, removeItem: remove },
    }
    vi.stubGlobal('window', browser)
    expect(getDisplayMode()).toBe(PREVIEW_MODE)
    expect(read).not.toHaveBeenCalled()
    expect(unlockWithToken(`dev.mock.${Date.now() + 60000}`)).toEqual({
      ok: false,
      reason: 'design_preview_only',
    })
    lockToPreview()
    expect(write).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    browser.location.pathname = '/design/inpiration/params'
    expect(getDisplayMode()).toBe(PREVIEW_MODE)
    browser.location.pathname = '/arsenal/settle'
    expect(getDisplayMode()).toBe(FULL_MODE)
  })
  it('isolates Console sync preferences and blocks cloud pulls and writes in design previews', async () => {
    const read = vi.fn(() => JSON.stringify({ enabled: true }))
    const write = vi.fn()
    const fetch = vi.fn()
    vi.stubGlobal('window', {
      location: { pathname: '/arsenal/design/inpiration/params' },
      localStorage: { getItem: read, setItem: write },
      addEventListener: vi.fn(),
    })
    vi.stubGlobal('fetch', fetch)
    const sync = await import('../gitSync')
    expect(sync.setGitSyncEnabled(false).enabled).toBe(false)
    expect(sync.getGitSyncState().enabled).toBe(false)
    expect(await sync.commitBundleNow({ investments: [] })).toMatchObject({
      ok: false,
      reason: 'preview_mode',
    })
    expect(await sync.pullGitBundle()).toMatchObject({
      ok: false,
      reason: 'preview_mode',
    })
    expect(read).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    window.location.pathname = '/arsenal/params'
    expect(sync.getGitSyncState().enabled).toBe(true)
    expect(read).toHaveBeenCalled()
  })
})
