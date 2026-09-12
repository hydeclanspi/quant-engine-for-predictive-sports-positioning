import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireOwner } from '../../../api/_shared.js'
import {
  FULL_MODE,
  getDisplayMode,
  isOwnerRoutePath,
  OWNER_ROUTE_BASENAME,
  PREVIEW_MODE,
} from '../displayMode.js'

const stubBrowserAt = (pathname) => {
  vi.stubGlobal('window', {
    location: { pathname },
    sessionStorage: {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {},
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hidden owner route', () => {
  it('recognises the owner mount and all nested pages', () => {
    expect(OWNER_ROUTE_BASENAME).toBe('/arsenal')
    expect(isOwnerRoutePath('/arsenal')).toBe(true)
    expect(isOwnerRoutePath('/arsenal/')).toBe(true)
    expect(isOwnerRoutePath('/arsenal/dashboard')).toBe(true)
    expect(isOwnerRoutePath('/arsenal/war-report')).toBe(true)
  })

  it('does not leak full mode into ordinary or lookalike URLs', () => {
    expect(isOwnerRoutePath('/')).toBe(false)
    expect(isOwnerRoutePath('/dashboard')).toBe(false)
    expect(isOwnerRoutePath('/arsenall')).toBe(false)
    expect(isOwnerRoutePath('/demo/arsenal')).toBe(false)
  })

  it('forces full mode only while browsing below the owner mount', () => {
    stubBrowserAt('/arsenal/dashboard')
    expect(getDisplayMode()).toBe(FULL_MODE)

    stubBrowserAt('/dashboard')
    expect(getDisplayMode()).toBe(PREVIEW_MODE)
  })

  it('accepts the route marker without a password token', () => {
    expect(requireOwner({ headers: { 'x-dugou-arsenal': '1' } })).toEqual({
      ok: true,
      claims: { scope: 'full', sub: 'arsenal-route' },
    })
  })
})
