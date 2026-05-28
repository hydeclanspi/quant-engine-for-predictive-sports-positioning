/**
 * Demo Data Bundle — what visitors see in preview mode.
 *
 * STEP 1 SCAFFOLD: this file exposes empty/safe defaults so the
 * preview-mode plumbing can be wired without breaking pages.
 *
 * STEP 4 will replace these stubs with a curated ~40-entry virtual
 * dataset spanning ~3 months: hit rate ~55%, gentle upward ROI,
 * 1-2 mild drawdowns, coverage of all 6 modes + 1-5 leg parlays,
 * 3 didactic samples (high-surplus hit / anchor failure /
 * contrarian-edge win).
 */

const DEMO_REVISION = 'step1-scaffold-v0'

/**
 * Returns an empty investment list. Once Step 4 lands, replace with
 * the hand-crafted virtual dataset.
 */
export const getDemoInvestments = () => []

/**
 * Returns an empty team profile list. Step 4 will seed virtual
 * teams (League A · Team A1 etc.).
 */
export const getDemoTeamProfiles = () => []

/**
 * Returns a system config object suitable for demo mode. Mirrors
 * the canonical shape so pages reading it don't crash.
 */
export const getDemoSystemConfig = () => ({
  initialCapital: 600,
  riskCapRatio: 0.12,
  defaultOdds: 2.5,
  kellyDivisor: 4,
  weights: {
    conf: 0.18,
    mode: 0.14,
    tys: 0.12,
    fid: 0.10,
    odds: 0.06,
    fse: 0.07,
  },
  layoutMode: 'modern',
  pageAmbientThemes: {},
  capitalInjections: [],
  // marker so downstream code can identify demo-origin state
  __demo: true,
  __revision: DEMO_REVISION,
})

export const getDemoAccessLogs = () => []

export const DEMO_BUNDLE_REVISION = DEMO_REVISION
