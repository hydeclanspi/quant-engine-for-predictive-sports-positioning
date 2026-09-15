import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestAiSettlementParse } from '../aiSettlementClient.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AI settlement browser client', () => {
  it('authenticates the hidden owner route and revalidates output', async () => {
    vi.stubGlobal('window', {
      location: { pathname: '/arsenal/settle' },
      sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true, source: 'deepseek', model: 'deepseek-flash', confidence: 0.8,
        settlements: [{ pendingId: 'inv_1', revenues: 50, matches: [{ matchIndex: 0, results: '2-1', isCorrect: true }] }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestAiSettlementParse('皇马2-1皇社 收入50', [{
      id: 'inv_1', matches: [{ homeTeam: '皇马', awayTeam: '皇社', entry: 'win' }],
    }])
    expect(result).toMatchObject({ ok: true, source: 'deepseek' })
    expect(result.settlements[0]).toMatchObject({ pendingId: 'inv_1', revenues: 50 })
    expect(fetchMock).toHaveBeenCalledWith('/api/parse-settlement', expect.objectContaining({
      headers: expect.objectContaining({ 'X-Dugou-Arsenal': '1' }),
    }))
  })
})
