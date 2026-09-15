import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../../api/parse-investment.js'

const ORIGINAL_ENV = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  DEEPSEEK_TIMEOUT_MS: process.env.DEEPSEEK_TIMEOUT_MS,
  AI_API_KEY: process.env.AI_API_KEY,
  AI_BASE_URL: process.env.AI_BASE_URL,
  AI_MODEL: process.env.AI_MODEL,
}

const restoreEnv = () => {
  Object.entries(ORIGINAL_ENV).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}

const ownerRequest = (body) => ({
  method: 'POST',
  headers: { 'x-dugou-arsenal': '1' },
  body,
})

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  headers: {},
  setHeader(name, value) { this.headers[name] = value },
  status(code) { this.statusCode = code; return this },
  json(payload) { this.body = payload; return this },
})

const providerResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn().mockResolvedValue(payload),
})

const modelEnvelope = (content) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: 91, completion_tokens: 27, total_tokens: 118 },
})

beforeEach(() => {
  process.env.DEEPSEEK_API_KEY = 'test-deepseek-key'
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/'
  process.env.DEEPSEEK_MODEL = 'deepseek-flash'
  delete process.env.AI_API_KEY
  delete process.env.AI_BASE_URL
  delete process.env.AI_MODEL
})

afterEach(() => {
  restoreEnv()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('POST /api/parse-investment', () => {
  it('authenticates the owner, calls JSON Output, and returns only sanitized fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(200, modelEnvelope(JSON.stringify({
      confidence: 0.9,
      actualInput: 30,
      matches: [{
        homeTeam: '皇马', awayTeam: '皇社',
        entries: [{ name: '-1 win', odds: 1.52, hidden: 'drop me' }],
        conf: 0.55, mode: '常规', tys_home: 'M', tys_away: 'M', fid: 0.4,
        fse_home: 50, fse_away: 50, note: '',
      }],
      arbitrary: 'drop me too', warnings: [],
    }))))
    vi.stubGlobal('fetch', fetchMock)

    const res = makeResponse()
    await handler(ownerRequest({ text: '皇马vs皇社，-1 win，赔率1.52，conf 0.55，投入30' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    expect(res.body).toMatchObject({
      ok: true, source: 'deepseek', model: 'deepseek-flash', attempts: 1,
      actualInput: 30, confidence: 0.9,
      usage: { promptTokens: 91, completionTokens: 27, totalTokens: 118 },
    })
    expect(res.body.arbitrary).toBeUndefined()
    expect(res.body.matches[0]).toMatchObject({ conf: 55, entries: [{ name: '-1 win', odds: '1.52' }] })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(options.headers.Authorization).toBe('Bearer test-deepseek-key')
    const requestBody = JSON.parse(options.body)
    expect(requestBody).toMatchObject({
      model: 'deepseek-flash', thinking: { type: 'disabled' }, temperature: 0, stream: false,
      response_format: { type: 'json_object' },
    })
    expect(requestBody.messages[0].content.toLowerCase()).toContain('json')
    expect(requestBody.messages[1].content).toContain('皇马vs皇社')
  })

  it('retries one empty model response and succeeds on the second attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse(200, modelEnvelope('')))
      .mockResolvedValueOnce(providerResponse(200, modelEnvelope(JSON.stringify({
        confidence: 0.7,
        matches: [{ homeTeam: 'A', awayTeam: 'B', entries: [{ name: 'win', odds: 2 }] }],
      }))))
    vi.stubGlobal('fetch', fetchMock)

    const res = makeResponse()
    await handler(ownerRequest({ text: 'A vs B win odds 2' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.attempts).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a rate limit response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(providerResponse(429, { error: { message: 'limited' } }))
    vi.stubGlobal('fetch', fetchMock)

    const res = makeResponse()
    await handler(ownerRequest({ text: 'A vs B win' }), res)

    expect(res.statusCode).toBe(429)
    expect(res.body).toEqual({ ok: false, reason: 'provider_rate_limited' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the API key is missing', async () => {
    delete process.env.DEEPSEEK_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = makeResponse()
    await handler(ownerRequest({ text: 'A vs B win' }), res)

    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ ok: false, reason: 'ai_not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized input before contacting the provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = makeResponse()
    await handler(ownerRequest({ text: 'x'.repeat(1501) }), res)

    expect(res.statusCode).toBe(413)
    expect(res.body).toMatchObject({ ok: false, reason: 'text_too_long', maxLength: 1500 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
