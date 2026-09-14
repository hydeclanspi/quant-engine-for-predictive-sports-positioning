/**
 * Shared contract for AI-assisted Quick Input.
 *
 * This module is intentionally dependency-free so the Vercel function and the
 * browser can run the exact same allow-list validation. Model output is always
 * treated as untrusted input: unknown fields are dropped and every value is
 * bounded before it can touch form state.
 */

export const AI_PARSE_MAX_TEXT_LENGTH = 1500
export const AI_PARSE_MAX_MATCHES = 5
export const AI_PARSE_MAX_ENTRIES = 5

export const AI_MODE_OPTIONS = [
  '常规',
  '常规-稳',
  '常规-杠杆',
  '常规-激进',
  '半彩票半保险',
  '保险产品',
  '赌一把',
]

const TYS_OPTIONS = new Set(['S', 'M', 'L', 'H'])
const FID_OPTIONS = [0, 0.25, 0.4, 0.6, 0.75]

const cleanText = (value, maxLength) =>
  String(value ?? '')
    .replace(/[\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)

const toFiniteNumber = (value) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const normalizePercent = (value, fallback = 50) => {
  const parsed = toFiniteNumber(value)
  if (parsed === null || parsed < 0) return fallback
  const percent = parsed <= 1 ? parsed * 100 : parsed > 1 && parsed < 10 ? parsed * 10 : parsed
  return Number(clamp(percent, 0, 100).toFixed(1))
}

const normalizeConfidence = (value) => {
  const parsed = toFiniteNumber(value)
  if (parsed === null) return 0
  return Number(clamp(parsed, 0, 1).toFixed(2))
}

const normalizeFid = (value) => {
  const parsed = toFiniteNumber(value)
  if (parsed === null) return '0.4'
  const closest = FID_OPTIONS.reduce(
    (best, option) => Math.abs(option - parsed) < Math.abs(best - parsed) ? option : best,
    0.4,
  )
  return String(closest)
}

const normalizeTys = (value) => {
  const normalized = cleanText(value, 1).toUpperCase()
  return TYS_OPTIONS.has(normalized) ? normalized : 'M'
}

const normalizeMode = (value) => {
  const clean = cleanText(value, 20)
  return AI_MODE_OPTIONS.includes(clean) ? clean : '常规'
}

const normalizeEntry = (entry) => {
  const name = cleanText(entry?.name, 80)
  const oddsValue = toFiniteNumber(entry?.odds)
  const odds = oddsValue !== null && oddsValue >= 1 && oddsValue <= 1000
    ? String(Number(oddsValue.toFixed(4)))
    : ''
  return { name, odds }
}

const normalizeMatch = (match) => {
  const rawEntries = Array.isArray(match?.entries) ? match.entries : []
  const entries = rawEntries.slice(0, AI_PARSE_MAX_ENTRIES).map(normalizeEntry)
  return {
    homeTeam: cleanText(match?.homeTeam, 60),
    awayTeam: cleanText(match?.awayTeam, 60),
    entries: entries.length > 0 ? entries : [{ name: '', odds: '' }],
    conf: normalizePercent(match?.conf, 50),
    mode: normalizeMode(match?.mode),
    tys_home: normalizeTys(match?.tys_home),
    tys_away: normalizeTys(match?.tys_away),
    fid: normalizeFid(match?.fid),
    fse_home: normalizePercent(match?.fse_home, 50),
    fse_away: normalizePercent(match?.fse_away, 50),
    note: cleanText(match?.note, 400),
  }
}

export const sanitizeAiInvestmentParse = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'invalid_ai_payload' }
  }

  const rawMatches = Array.isArray(payload.matches) ? payload.matches : []
  const matches = rawMatches
    .slice(0, AI_PARSE_MAX_MATCHES)
    .map(normalizeMatch)
    .filter((match) => match.homeTeam || match.awayTeam || match.entries.some((entry) => entry.name))

  if (matches.length === 0) {
    return { ok: false, reason: 'no_matches' }
  }

  const actualInputValue = toFiniteNumber(payload.actualInput)
  const actualInput = actualInputValue !== null && actualInputValue > 0 && actualInputValue <= 10_000_000
    ? Number(actualInputValue.toFixed(2))
    : null
  const warnings = (Array.isArray(payload.warnings) ? payload.warnings : [])
    .map((warning) => cleanText(warning, 180))
    .filter(Boolean)
    .slice(0, 8)

  return {
    ok: true,
    confidence: normalizeConfidence(payload.confidence),
    actualInput,
    comboName: cleanText(payload.comboName, 80),
    matches,
    warnings,
    diagnostics: warnings.map((message) => ({ level: 'warning', message })),
  }
}

export const parseJsonObjectText = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null
  const stripped = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const parsed = JSON.parse(stripped)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
