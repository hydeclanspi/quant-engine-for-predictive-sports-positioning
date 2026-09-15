import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../../api/parse-settlement.js'

const originalKey = process.env.DEEPSEEK_API_KEY
const ownerRequest = (body) => ({ method: 'POST', headers: { 'x-dugou-arsenal': '1' }, body })
const makeResponse = () => ({
  statusCode: 200, body: null, headers: {},
  setHeader(name, value) { this.headers[name] = value },
  status(code) { this.statusCode = code; return this },
  json(payload) { this.body = payload; return this },
})

beforeEach(() => { process.env.DEEPSEEK_API_KEY = 'test-key' })
afterEach(() => {
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalKey
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('POST /api/parse-settlement', () => {
  it('sends compact pending context and returns sanitized JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({
          confidence: 0.9,
          settlements: [{ pendingId: 'inv_1', revenues: 58, matches: [{ matchIndex: 0, results: '2-1', isCorrect: true }] }],
          warnings: [],
        }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = makeResponse()
    await handler(ownerRequest({
      text: '皇马2-1皇社 收入58',
      pending: [{ id: 'inv_1', secret: 'drop', matches: [{ homeTeam: '皇马', awayTeam: '皇社', entry: 'win' }] }],
    }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, source: 'deepseek', confidence: 0.9 })
    expect(res.body.settlements[0]).toMatchObject({ pendingId: 'inv_1', revenues: 58 })
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(requestBody).toMatchObject({
      thinking: { type: 'disabled' }, temperature: 0, max_tokens: 3000,
      response_format: { type: 'json_object' },
    })
    expect(requestBody.messages[1].content).not.toContain('secret')
  })

  it('rejects requests without pending context before calling the provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = makeResponse()
    await handler(ownerRequest({ text: '结算', pending: [] }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.reason).toBe('no_pending_records')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
