import { getStoredToken, isFullMode, isOwnerRoute } from './displayMode'
import {
  AI_PARSE_MAX_TEXT_LENGTH,
  sanitizeAiInvestmentParse,
} from './aiInvestmentSchema'

const ENDPOINT = '/api/parse-investment'
const CLIENT_TIMEOUT_MS = 16_000

export class AiInvestmentParseError extends Error {
  constructor(reason, status = 0) {
    super(reason)
    this.name = 'AiInvestmentParseError'
    this.reason = reason
    this.status = status
  }
}

const getOwnerHeaders = () => {
  if (isOwnerRoute()) return { 'X-Dugou-Arsenal': '1' }
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : null
}

/**
 * Ask the server-side AI adapter to turn one sentence into form data.
 *
 * The API key never enters the browser. The response is allow-list validated
 * here a second time even though the server already validates it, so an
 * unexpected proxy/cache response can never inject arbitrary form fields.
 */
export const requestAiInvestmentParse = async (rawText, { signal } = {}) => {
  if (!isFullMode()) throw new AiInvestmentParseError('preview_mode')

  const text = String(rawText || '').trim()
  if (!text) throw new AiInvestmentParseError('text_required')
  if (text.length > AI_PARSE_MAX_TEXT_LENGTH) {
    throw new AiInvestmentParseError('text_too_long', 413)
  }

  const ownerHeaders = getOwnerHeaders()
  if (!ownerHeaders) throw new AiInvestmentParseError('no_token', 401)

  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        ...ownerHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.ok) {
      throw new AiInvestmentParseError(payload?.reason || `http_${response.status}`, response.status)
    }

    const sanitized = sanitizeAiInvestmentParse(payload)
    if (!sanitized.ok) throw new AiInvestmentParseError(sanitized.reason || 'invalid_ai_payload', 502)

    return {
      ...sanitized,
      source: payload.source === 'deepseek' ? 'deepseek' : 'ai',
      model: String(payload.model || ''),
      attempts: Number(payload.attempts) || 1,
      usage: payload.usage && typeof payload.usage === 'object'
        ? {
            promptTokens: Number(payload.usage.promptTokens) || 0,
            completionTokens: Number(payload.usage.completionTokens) || 0,
            totalTokens: Number(payload.usage.totalTokens) || 0,
          }
        : null,
    }
  } catch (error) {
    if (error instanceof AiInvestmentParseError) throw error
    if (error?.name === 'AbortError') {
      throw new AiInvestmentParseError(signal?.aborted ? 'request_cancelled' : 'client_timeout', 504)
    }
    throw new AiInvestmentParseError('endpoint_unreachable', 0)
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}
