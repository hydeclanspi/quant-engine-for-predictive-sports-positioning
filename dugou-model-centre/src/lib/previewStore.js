/**
 * Preview Store — in-memory backing store for the public-facing demo mode.
 *
 * When the app is in PREVIEW_MODE every read/write that would normally
 * hit localStorage is rerouted here. This achieves two things:
 *   1. Visitors can interact freely (create investments, settle, edit
 *      params) and see the changes reflected in the UI within the same
 *      session — without ever touching the real owner's localStorage.
 *   2. The instant the visitor unlocks into FULL mode (or closes the
 *      tab and reopens), the store is dropped and the demo resets to
 *      the curated bundle.
 *
 * The store is lazily initialised from `demoData` on first access and
 * reset on every display-mode change.
 */

import {
  getDemoAccessLogs,
  getDemoInvestments,
  getDemoSystemConfig,
  getDemoTeamProfiles,
} from './demoData'

const STORAGE_KEYS = {
  investments: 'dugou.investments.v1',
  teamProfiles: 'dugou.team_profiles.v1',
  systemConfig: 'dugou.system_config.v1',
  accessLogs: 'dugou.access_logs.v1',
}

let memoryStore = null

const deepClone = (value) => {
  if (value == null) return value
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value)
    } catch (_) {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(value))
}

const buildInitialStore = () => ({
  [STORAGE_KEYS.investments]: getDemoInvestments(),
  [STORAGE_KEYS.teamProfiles]: getDemoTeamProfiles(),
  [STORAGE_KEYS.systemConfig]: getDemoSystemConfig(),
  [STORAGE_KEYS.accessLogs]: getDemoAccessLogs(),
})

const ensureStore = () => {
  if (memoryStore == null) memoryStore = buildInitialStore()
  return memoryStore
}

/**
 * Returns a deep clone of the requested key, or the fallback if no
 * demo seed exists for that key. Callers receive a fresh copy so they
 * cannot accidentally mutate the live demo state.
 */
export const previewRead = (key, fallback) => {
  const store = ensureStore()
  if (Object.prototype.hasOwnProperty.call(store, key)) {
    return deepClone(store[key])
  }
  return fallback
}

/**
 * Persists a deep clone of the value into the in-memory store under
 * the given key. Returns true so callers can treat it as a successful
 * write equivalent to a localStorage setItem.
 */
export const previewWrite = (key, value) => {
  const store = ensureStore()
  store[key] = deepClone(value)
  return true
}

/**
 * Drops the in-memory store. Triggered on every display-mode change so
 * leaving and re-entering preview returns the visitor to a clean demo
 * baseline.
 */
export const resetPreviewStore = () => {
  memoryStore = null
}

/**
 * Returns true if the store has been touched (i.e. the visitor has
 * interacted with the demo). Useful for showing a subtle "reset demo"
 * affordance later if desired.
 */
export const isPreviewStoreDirty = () => memoryStore != null

export const PREVIEW_STORE_KEYS = STORAGE_KEYS
