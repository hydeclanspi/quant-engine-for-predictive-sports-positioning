/** Shared allow-list contract for AI-assisted settlement input. */
export const AI_SETTLE_MAX_TEXT_LENGTH = 1500
export const AI_SETTLE_MAX_PENDING_CONTEXT = 30
export const AI_SETTLE_MAX_RECORDS = 10
export const AI_SETTLE_MAX_MATCHES = 5

const cleanText = (value, maxLength) =>
  String(value ?? '')
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)

const finiteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

const boundedNumber = (value, min, max, decimals = 2) => {
  const parsed = finiteNumber(value)
  if (parsed === null || parsed < min || parsed > max) return null
  return Number(parsed.toFixed(decimals))
}

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value
  const normalized = cleanText(value, 16).toLowerCase()
  if (['true', 'yes', 'hit', 'win', 'won', '中', '命中', '对', '中了', '拿下'].includes(normalized)) return true
  if (['false', 'no', 'miss', 'missed', 'lose', 'lost', 'loss', '未中', '没中', '不中', '错', '错了', '输', '输了', '挂了', '寄了'].includes(normalized)) return false
  return null
}

const normalizeMatch = (match) => {
  const parsedIndex = Number.parseInt(match?.matchIndex, 10)
  return {
    matchIndex: Number.isInteger(parsedIndex) && parsedIndex >= 0 && parsedIndex < AI_SETTLE_MAX_MATCHES
      ? parsedIndex
      : null,
    homeTeam: cleanText(match?.homeTeam, 60),
    awayTeam: cleanText(match?.awayTeam, 60),
    results: cleanText(match?.results, 80),
    isCorrect: normalizeBoolean(match?.isCorrect),
    matchRating: boundedNumber(match?.matchRating, 0, 0.8),
    matchRep: boundedNumber(match?.matchRep, 0, 1.8),
    postNote: cleanText(match?.postNote, 400),
  }
}

const normalizeSettlement = (settlement) => ({
  pendingId: cleanText(settlement?.pendingId, 160),
  reference: cleanText(settlement?.reference, 120),
  revenues: boundedNumber(settlement?.revenues, 0, 10_000_000),
  matches: (Array.isArray(settlement?.matches) ? settlement.matches : [])
    .slice(0, AI_SETTLE_MAX_MATCHES)
    .map(normalizeMatch),
})

export const sanitizeAiSettlementParse = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'invalid_ai_payload' }
  }
  const settlements = (Array.isArray(payload.settlements) ? payload.settlements : [])
    .slice(0, AI_SETTLE_MAX_RECORDS)
    .map(normalizeSettlement)
    .filter((settlement) => settlement.pendingId || settlement.reference || settlement.matches.length > 0)
  if (settlements.length === 0) return { ok: false, reason: 'no_settlements' }

  const confidence = boundedNumber(payload.confidence, 0, 1) ?? 0
  const warnings = (Array.isArray(payload.warnings) ? payload.warnings : [])
    .map((warning) => cleanText(warning, 180))
    .filter(Boolean)
    .slice(0, 10)

  return {
    ok: true,
    confidence,
    settlements,
    warnings,
    diagnostics: warnings.map((message) => ({ level: 'warning', message })),
  }
}

export const sanitizePendingSettlementContext = (pending) =>
  (Array.isArray(pending) ? pending : [])
    .slice(0, AI_SETTLE_MAX_PENDING_CONTEXT)
    .map((combo, comboIndex) => ({
      pendingId: cleanText(combo?.id ?? combo?.pendingId, 160),
      ordinal: comboIndex + 1,
      date: cleanText(combo?.date, 20),
      comboName: cleanText(combo?.comboName, 80),
      inputs: boundedNumber(combo?.totalInputs ?? combo?.inputs, 0, 10_000_000),
      matches: (Array.isArray(combo?.matches) ? combo.matches : [])
        .slice(0, AI_SETTLE_MAX_MATCHES)
        .map((match, matchIndex) => ({
          matchIndex,
          homeTeam: cleanText(match?.homeTeam ?? match?.home_team, 60),
          awayTeam: cleanText(match?.awayTeam ?? match?.away_team, 60),
          prediction: cleanText(match?.entry ?? match?.entry_text, 120),
        })),
    }))
    .filter((combo) => combo.pendingId && combo.matches.length > 0)
