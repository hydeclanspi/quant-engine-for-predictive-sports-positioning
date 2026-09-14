import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestAiInvestmentParse } from '../aiInvestmentClient.js'

const stubBrowserAt = (pathname) => {
  vi.stubGlobal('window', {
    location: { pathname },
    sessionStorage: {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => {},
    },
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AI Quick Input browser client', () => {
  it('uses the hidden owner marker and validates the response again', async () => {
    stubBrowserAt('/arsenal/new')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        source: 'deepseek',
        model: 'deepseek-flash',
        attempts: 1,
        confidence: 0.8,
        actualInput: 76,
        usage: { totalTokens: 100 },
        matches: [{
          homeTeam: '西班牙',
          awayTeam: '皇马',
          entries: [{ name: 'lose', odds: 1.3 }],
          conf: 70,
          arbitrary: 'drop',
        }],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestAiInvestmentParse('西班牙 vs 皇马，负，1.3，投入 76')

    expect(result).toMatchObject({ ok: true, source: 'deepseek', actualInput: 76 })
    expect(result.matches[0]).toMatchObject({
      homeTeam: '西班牙', awayTeam: '皇马', conf: 70,
      entries: [{ name: 'lose', odds: '1.3' }],
    })
    expect(result.matches[0].arbitrary).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/parse-investment', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Dugou-Arsenal': '1' }),
    }))
  })

  it('never spends an AI request in public preview mode', async () => {
    stubBrowserAt('/')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestAiInvestmentParse('A vs B')).rejects.toMatchObject({ reason: 'preview_mode' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
