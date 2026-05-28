import { useEffect, useState } from 'react'

/**
 * Display Mode — Preview vs Full
 *
 * Two-tier visibility for the public-facing site:
 *   - 'preview' (default): hides proprietary parameter naming + real data,
 *      shows hand-crafted demo bundle. What recruiters/visitors see.
 *   - 'full': unlocked state. Identical to the pre-existing product.
 *
 * Unlock token lives in sessionStorage, so closing the browser snaps
 * back to preview. localStorage is intentionally avoided to prevent
 * residual access across browser restarts.
 *
 * Real token validation lives in the Vercel /api/unlock function
 * (wired in Step 6). Until then a mock token is accepted.
 */

const TOKEN_KEY = 'dugou.preview_unlock_token.v1'
const DISPLAY_MODE_EVENT = 'dugou:display-mode-changed'

const MOCK_TOKEN_PREFIX = 'dev.mock.'

export const PREVIEW_MODE = 'preview'
export const FULL_MODE = 'full'

const safeGetSession = (key) => {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(key)
  } catch (err) {
    return null
  }
}

const safeSetSession = (key, value) => {
  if (typeof window === 'undefined') return
  try {
    if (value == null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch (err) {
    /* sessionStorage unavailable — fail silent */
  }
}

const decodeJwtPayload = (token) => {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const decoded = atob(padded)
    return JSON.parse(decoded)
  } catch (err) {
    return null
  }
}

const isTokenLive = (token) => {
  if (!token) return false
  if (token.startsWith(MOCK_TOKEN_PREFIX)) {
    const expiresAtRaw = token.slice(MOCK_TOKEN_PREFIX.length)
    const expiresAt = Number.parseInt(expiresAtRaw, 10)
    if (!Number.isFinite(expiresAt)) return false
    return expiresAt > Date.now()
  }
  const payload = decodeJwtPayload(token)
  if (!payload) return false
  if (typeof payload.exp !== 'number') return true
  return payload.exp * 1000 > Date.now()
}

export const getStoredToken = () => safeGetSession(TOKEN_KEY)

export const getDisplayMode = () => {
  const token = getStoredToken()
  return isTokenLive(token) ? FULL_MODE : PREVIEW_MODE
}

export const isPreviewMode = () => getDisplayMode() === PREVIEW_MODE
export const isFullMode = () => getDisplayMode() === FULL_MODE

const dispatchModeChanged = (mode) => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(DISPLAY_MODE_EVENT, { detail: { mode } }))
}

export const lockToPreview = () => {
  safeSetSession(TOKEN_KEY, null)
  dispatchModeChanged(PREVIEW_MODE)
}

export const unlockWithToken = (token) => {
  if (!isTokenLive(token)) {
    return { ok: false, reason: 'invalid_or_expired_token' }
  }
  safeSetSession(TOKEN_KEY, token)
  dispatchModeChanged(FULL_MODE)
  return { ok: true }
}

/**
 * Dev / staging shortcut — issues a session-scoped mock token without
 * hitting the Vercel function. Replaced by real auth in Step 6.
 */
export const issueMockUnlockToken = (ttlMs = 1000 * 60 * 60 * 12) => {
  return `${MOCK_TOKEN_PREFIX}${Date.now() + ttlMs}`
}

export const onDisplayModeChange = (handler) => {
  if (typeof window === 'undefined') return () => {}
  const wrapped = (event) => handler(event?.detail?.mode || getDisplayMode())
  window.addEventListener(DISPLAY_MODE_EVENT, wrapped)
  return () => window.removeEventListener(DISPLAY_MODE_EVENT, wrapped)
}

export const useDisplayMode = () => {
  const [mode, setMode] = useState(() => getDisplayMode())

  useEffect(() => {
    const unsubscribe = onDisplayModeChange((nextMode) => setMode(nextMode))
    return unsubscribe
  }, [])

  return mode
}

export const DISPLAY_MODE_CHANGE_EVENT = DISPLAY_MODE_EVENT
