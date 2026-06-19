import { getStoredToken, isFullMode } from './displayMode'

/**
 * Git-as-sync client — the cross-device live-sync layer.
 *
 * Replaces Supabase for the *live* snapshot (the old `id='latest'` row).
 * The owner's snapshot is pushed to the repo's `data` branch (encrypted,
 * server-side) via /api/commit-bundle and read back via /api/bundle. Time
 * Machine snapshots still live in Supabase — see cloudSync.js.
 *
 * Trigger policy (hybrid): every change schedules a debounced commit
 * (coalescing bursts), but once COMMIT_THRESHOLD changes have piled up we
 * flush immediately so other devices never lag too far behind.
 *
 * All writes/reads require FULL mode (the owner unlocked this tab) and a
 * live token — preview/public visitors never touch the owner's store.
 */

const COMMIT_ENDPOINT = '/api/commit-bundle'
const PULL_ENDPOINT = '/api/bundle'
const STATE_KEY = 'dugou.git_sync_state.v1'

const DEBOUNCE_MS = 30_000 // coalesce a burst of edits into one commit
const COMMIT_THRESHOLD = 8 // …but flush immediately at this many pending changes

const DEFAULT_STATE = {
  enabled: true, // on by default — "just works" once the Vercel env vars exist
  lastSyncAt: '',
  lastPullAt: '',
  lastError: '',
}

const isBrowser = typeof window !== 'undefined'

// Once we learn the endpoints aren't deployed (e.g. local `vite dev`, which
// doesn't run Vercel functions), stop hammering them for the session.
let endpointUnavailable = false
let pendingChanges = 0
let debounceTimer = null
let commitInFlight = false
let lastSnapshotFactory = null

const readState = () => {
  if (!isBrowser) return { ...DEFAULT_STATE }
  try {
    const raw = window.localStorage.getItem(STATE_KEY)
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : { ...DEFAULT_STATE }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

const writeState = (next) => {
  if (!isBrowser) return
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(next))
  } catch {
    /* storage full / unavailable — non-fatal */
  }
}

export const getGitSyncState = () => ({
  ...readState(),
  // Parity with the old getCloudSyncStatus() shape consumed by ParamsPage.
  hasEnv: true,
  endpointUnavailable,
})

export const saveGitSyncState = (patch) => {
  const next = { ...readState(), ...(patch || {}) }
  writeState(next)
  return getGitSyncState()
}

export const setGitSyncEnabled = (enabled) => saveGitSyncState({ enabled: Boolean(enabled), lastError: '' })

const authHeaders = () => {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : null
}

const canSync = () => isBrowser && !endpointUnavailable && isFullMode() && getGitSyncState().enabled

/** Push the given snapshot to git now (union-merged server-side). */
export const commitBundleNow = async (snapshot) => {
  if (!isBrowser) return { ok: false, reason: 'no_window' }
  if (!isFullMode()) return { ok: false, reason: 'preview_mode' }
  const headers = authHeaders()
  if (!headers) return { ok: false, reason: 'no_token' }
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, reason: 'invalid_snapshot' }
  if (commitInFlight) return { ok: false, reason: 'in_flight' }

  commitInFlight = true
  try {
    const res = await fetch(COMMIT_ENDPOINT, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
    })
    if (res.status === 404) {
      endpointUnavailable = true
      saveGitSyncState({ lastError: '同步端点未部署（本地 vite dev 不运行 /api）。' })
      return { ok: false, reason: 'endpoint_unavailable' }
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      saveGitSyncState({ lastError: data.reason ? `提交失败：${data.reason}` : `提交失败（HTTP ${res.status}）。` })
      return { ok: false, reason: data.reason || 'commit_failed', status: res.status }
    }
    pendingChanges = 0
    saveGitSyncState({ lastSyncAt: new Date().toISOString(), lastError: '' })
    return { ok: true, count: data.count, updatedAt: data.updated_at }
  } catch (err) {
    saveGitSyncState({ lastError: `提交异常：${err?.message || err}` })
    return { ok: false, reason: 'network_error' }
  } finally {
    commitInFlight = false
  }
}

/**
 * Hybrid debounce + threshold scheduler. Call on every owner data change;
 * pass a factory so the snapshot is built at flush time (always latest).
 */
export const scheduleGitCommit = (snapshotFactory) => {
  if (typeof snapshotFactory === 'function') lastSnapshotFactory = snapshotFactory
  if (!canSync()) return

  pendingChanges += 1

  const flush = () => {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer)
      debounceTimer = null
    }
    const snapshot = typeof lastSnapshotFactory === 'function' ? lastSnapshotFactory() : null
    if (snapshot) commitBundleNow(snapshot)
  }

  if (pendingChanges >= COMMIT_THRESHOLD) {
    flush()
    return
  }
  if (debounceTimer) window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(flush, DEBOUNCE_MS)
}

/** Fetch the latest snapshot from git. Returns { ok, bundle, updatedAt }. */
export const pullGitBundle = async () => {
  if (!isBrowser || endpointUnavailable) return { ok: false, reason: 'unavailable', bundle: null }
  if (!isFullMode()) return { ok: false, reason: 'preview_mode', bundle: null }
  const headers = authHeaders()
  if (!headers) return { ok: false, reason: 'no_token', bundle: null }

  try {
    const res = await fetch(PULL_ENDPOINT, { headers })
    if (res.status === 404) {
      endpointUnavailable = true
      return { ok: false, reason: 'endpoint_unavailable', bundle: null }
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      saveGitSyncState({ lastError: data.reason ? `拉取失败：${data.reason}` : `拉取失败（HTTP ${res.status}）。` })
      return { ok: false, reason: data.reason || 'pull_failed', bundle: null }
    }
    saveGitSyncState({ lastPullAt: new Date().toISOString(), lastError: '' })
    return { ok: true, bundle: data.bundle || null, updatedAt: data.updated_at || '' }
  } catch (err) {
    saveGitSyncState({ lastError: `拉取异常：${err?.message || err}` })
    return { ok: false, reason: 'network_error', bundle: null }
  }
}

// Best-effort flush of un-committed changes when the tab is hidden/closed.
// keepalive lets the request outlive the page, but is capped at ~64KB — for
// a larger bundle this may not send, in which case the next edit re-commits.
if (isBrowser) {
  const flushOnHide = () => {
    if (pendingChanges <= 0 || !canSync()) return
    const headers = authHeaders()
    const snapshot = typeof lastSnapshotFactory === 'function' ? lastSnapshotFactory() : null
    if (!headers || !snapshot) return
    try {
      fetch(COMMIT_ENDPOINT, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      /* body too large for keepalive — next edit will re-commit */
    }
  }
  window.addEventListener('pagehide', flushOnHide)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnHide()
  })
}
