import { getStoredToken, isFullMode, isOwnerRoute } from './displayMode'
import {
  AI_SETTLE_MAX_TEXT_LENGTH,
  sanitizeAiSettlementParse,
  sanitizePendingSettlementContext,
} from './aiSettlementSchema'

const ENDPOINT = '/api/parse-settlement'
const CLIENT_TIMEOUT_MS = 18_000

export class AiSettlementParseError extends Error {
  constructor(reason, status = 0) {
    super(reason)
    this.name = 'AiSettlementParseError'
    this.reason = reason
    this.status = status
  }
}

const getOwnerHeaders = () => {
  if (isOwnerRoute()) return { 'X-Dugou-Arsenal': '1' }
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : null
}

export const requestAiSettlementParse = async (rawText, pending, { signal } = {}) => {
  if (!isFullMode()) throw new AiSettlementParseError('preview_mode')
  const text = String(rawText || '').trim()
  if (!text) throw new AiSettlementParseError('text_required')
  if (text.length > AI_SETTLE_MAX_TEXT_LENGTH) throw new AiSettlementParseError('text_too_long', 413)

  const pendingContext = sanitizePendingSettlementContext(pending)
  if (pendingContext.length === 0) throw new AiSettlementParseError('no_pending_records', 400)
  const ownerHeaders = getOwnerHeaders()
  if (!ownerHeaders) throw new AiSettlementParseError('no_token', 401)

  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = window.setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS)

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, pending: pendingContext }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.ok) {
      throw new AiSettlementParseError(payload?.reason || `http_${response.status}`, response.status)
    }
    const sanitized = sanitizeAiSettlementParse(payload)
    if (!sanitized.ok) throw new AiSettlementParseError(sanitized.reason, 502)
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
    if (error instanceof AiSettlementParseError) throw error
    if (error?.name === 'AbortError') {
      throw new AiSettlementParseError(signal?.aborted ? 'request_cancelled' : 'client_timeout', 504)
    }
    throw new AiSettlementParseError('endpoint_unreachable')
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}
