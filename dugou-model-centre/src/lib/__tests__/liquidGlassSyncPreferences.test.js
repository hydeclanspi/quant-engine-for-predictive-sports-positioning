import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Use the same in-memory owner-storage fixture as liquidGlassPreferences.test.js,
// but drive the public pull entry points instead of importing bundles directly.
const sync = vi.hoisted(() => ({
  pullGitBundle: vi.fn(),
  scheduleGitCommit: vi.fn(),
  commitBundleNow: vi.fn(),
}))
vi.mock('../cloudSync', () => ({
  getTimeMachineSession: () => null,
  isInTimeMachineSession: () => false,
}))
vi.mock('../gitSync', () => sync)
vi.mock('../displayMode', () => ({
  isPreviewMode: () => false,
  DISPLAY_MODE_CHANGE_EVENT: 'test:display-mode',
}))

const configKey = 'dugou.system_config.v1'
let storage
let getSystemConfig
let bootstrapCloudSnapshotOnLoad
let pullCloudSnapshotNow

beforeAll(async () => {
  const browser = new EventTarget()
  browser.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  vi.stubGlobal('window', browser)
  vi.stubGlobal('CustomEvent', class extends Event {
    constructor(type, options = {}) {
      super(type)
      this.detail = options.detail
    }
  })
  ;({ getSystemConfig, bootstrapCloudSnapshotOnLoad, pullCloudSnapshotNow } = await import('../localData'))
})

beforeEach(() => {
  storage = new Map([
    ['dugou.genesis_applied.v1', '1'],
    ['dugou.data_patch.v20260205', '1'],
    ['dugou.data_patch.v20260206', '1'],
    ['dugou.investments.v1', '[]'],
    ['dugou.team_profiles.v1', '[]'],
    ['dugou.access_logs.v1', '[]'],
  ])
  vi.clearAllMocks()
})

afterAll(() => vi.unstubAllGlobals())

const cases = [
  { label: 'missing', local: undefined, incoming: 'full', expected: 'smooth', material: undefined, incomingMaterial: 'smooth', expectedMaterial: 'full' },
  { label: 'smooth', local: 'smooth', incoming: 'full', expected: 'smooth', material: 'smooth', incomingMaterial: 'full', expectedMaterial: 'smooth' },
  { label: 'full', local: 'full', incoming: 'smooth', expected: 'full', material: 'full', incomingMaterial: 'smooth', expectedMaterial: 'full' },
]

const preparePull = ({ local, incoming, material, incomingMaterial }) => {
  storage.set(configKey, JSON.stringify({ initialCapital: 12345, liquidGlassQuality: local, liquidGlassMaterialQuality: material }))
  sync.pullGitBundle.mockResolvedValue({
    ok: true,
    updatedAt: '2026-09-23T00:00:00.000Z',
    bundle: {
      system_config: { initialCapital: 9876, liquidGlassQuality: incoming, liquidGlassMaterialQuality: incomingMaterial },
      team_profiles: [], investments: [], access_logs: [],
    },
  })
}

const expectLocalQuality = (quality, material) => {
  // The remote business update must apply; only the device rendering choice is retained.
  expect(getSystemConfig()).toMatchObject({ initialCapital: 9876, liquidGlassQuality: quality, liquidGlassMaterialQuality: material })
  expect(JSON.parse(storage.get(configKey))).toMatchObject({ initialCapital: 9876, liquidGlassQuality: quality, liquidGlassMaterialQuality: material })
  expect(sync.pullGitBundle).toHaveBeenCalledOnce()
}

describe('Git pulls preserve device liquid glass quality', () => {
  it.each(cases)('startup keeps $label local quality when the remote disagrees', async (testCase) => {
    preparePull(testCase)
    expect(await bootstrapCloudSnapshotOnLoad()).toMatchObject({ ok: true, applied: true })
    expectLocalQuality(testCase.expected, testCase.expectedMaterial)
  })

  it.each(cases)('manual merge keeps $label local quality when the remote disagrees', async (testCase) => {
    preparePull(testCase)
    expect(await pullCloudSnapshotNow('merge')).toMatchObject({ ok: true, applied: true, mode: 'merge' })
    expectLocalQuality(testCase.expected, testCase.expectedMaterial)
  })

  it.each(cases)('unlock sync keeps $label local quality when the remote disagrees', async (testCase) => {
    preparePull(testCase)
    window.dispatchEvent(new CustomEvent('test:display-mode', { detail: { mode: 'full' } }))
    await vi.waitFor(() => expectLocalQuality(testCase.expected, testCase.expectedMaterial))
  })
})
