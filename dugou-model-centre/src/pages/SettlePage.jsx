import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, Check, X, Trash2, Sparkles, Loader2, ShieldCheck, Archive, RotateCcw } from 'lucide-react'
import { deleteInvestment, getInvestments, updateInvestment, updateInvestments } from '../lib/localData'
import { autoApplyAdaptiveWeights } from '../lib/analytics'
import { handleNoteShortcut } from '../lib/noteFormatting'
import { normalizeEntryName } from '../lib/entryParsing'
import WaxSealStampOverlay, { getWaxSealStampPoint } from '../components/WaxSealStampOverlay'
import { useLabels } from '../lib/labels'
import { isPreviewMode } from '../lib/displayMode'
import { requestAiSettlementParse } from '../lib/aiSettlementClient'
import { AI_SETTLE_MAX_TEXT_LENGTH } from '../lib/aiSettlementSchema'
import {
  formatStructuredSettlementInput,
  inferIsCorrectFromResult,
  parseSettlementLocally,
  parseSingleMatchSettlementLocally,
  resolveAiSettlementParse,
} from '../lib/settlementQuickInput'

// 演示态首屏「展卷」：进入待结算页 1.7s 后，自动把第一条记录从容「展卷」展开
// （复用 qi-collapse 高度动效，但走待结算专属的 is-peek-unfurl 慢展 + 内容无回弹），
// 同时顶部漫起一束「破晓」柔光自我介绍——只展开，不收回。
const SETTLE_PEEK_DELAY_MS = 1700
const SETTLE_PEEK_DAWN_MS = 1400 // 破晓柔光播放时长后撤下 is-peek-dawn（展卷态常驻保留）
const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const formatDate = (isoString) => {
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '--'
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

const createPendingCombos = () =>
  getInvestments()
    .filter((item) => item.status === 'pending')
    .map((item) => ({
      id: item.id,
      date: formatDate(item.created_at),
      comboName: String(item.combo_name || ''),
      totalOdds: Number(item.combined_odds || 0).toFixed(2),
      totalInputs: Number(item.inputs || 0),
      matches:
        item.matches?.map((match) => ({
          homeTeam: match.home_team || '',
          awayTeam: match.away_team || '',
          match: `${match.home_team || '-'} vs ${match.away_team || '-'}`,
          entry: match.entry_text || (Array.isArray(match.entries) ? match.entries.map((entry) => entry.name).join(', ') : '-'),
          odds: Number(match.odds || 0).toFixed(2),
          preNote: match.note || '',
          results: match.results || '',
          isCorrect: typeof match.is_correct === 'boolean' ? match.is_correct : null,
          matchRating: match.match_rating ?? '',
          matchRep: match.match_rep ?? '',
          postNote: match.post_note || '',
        })) || [],
      revenues: item.revenues === null || item.revenues === undefined || item.revenues === ''
        ? null
        : Number(item.revenues),
    }))

const createInitialForms = (combos) =>
  combos.reduce((acc, combo) => {
    acc[combo.id] = {
      revenues: combo.revenues === null ? '' : String(combo.revenues),
      matches: combo.matches.map((match) => ({
        results: match.results,
        isCorrect: match.isCorrect,
        matchRating: match.matchRating,
        matchRep: match.matchRep,
        postNote: match.postNote,
      })),
    }
    return acc
  }, {})

const getComboLabel = (matchCount) => {
  if (matchCount === 1) return 'Single Match'
  return `${matchCount} Matches Combo`
}

const AJR_MIN = 0
const AJR_MAX = 0.8
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const isEmptyValue = (value) => value === '' || value === null || value === undefined

const buildTeamMatchupKey = (homeTeam, awayTeam) => {
  const home = normalizeKey(homeTeam)
  const away = normalizeKey(awayTeam)
  if (!home || !away) return ''
  // 主客队严格匹配，避免把同队对阵但主客对调的历史误判为同一场
  return `${home}::${away}`
}

const toEntryNames = (entryText = '') =>
  normalizeEntryName(entryText)
    .split(',')
    .map((name) => normalizeEntryName(name).toLowerCase())
    .filter(Boolean)

const buildEntryKey = (entryText = '') => {
  const names = [...new Set(toEntryNames(entryText))]
  if (names.length === 0) return ''
  return names.sort().join('|')
}

const buildHistoryLookupKey = ({ homeTeam, awayTeam, entryText }) => {
  const matchupKey = buildTeamMatchupKey(homeTeam, awayTeam)
  const entryKey = buildEntryKey(entryText)
  if (!matchupKey || !entryKey) return ''
  return `${matchupKey}##${entryKey}`
}

const toNumberOrNull = (value) => {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : null
}

const isAjrValueValid = (value) => {
  const text = String(value ?? '').trim()
  if (!text) return true
  const parsed = Number.parseFloat(text)
  return Number.isFinite(parsed) && parsed >= AJR_MIN && parsed <= AJR_MAX
}

const toAjrOrNull = (value) => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return null
  return Number(clamp(parsed, AJR_MIN, AJR_MAX).toFixed(2))
}

const sanitizeDecimalInputText = (value, { maxDecimals = null } = {}) => {
  let text = String(value ?? '')
    .replace(/[。．，]/g, '.')
    .replace(/[^\d.]/g, '')

  const firstDotIdx = text.indexOf('.')
  if (firstDotIdx >= 0) {
    const head = text.slice(0, firstDotIdx + 1)
    const tailRaw = text.slice(firstDotIdx + 1).replace(/\./g, '')
    const tail = Number.isFinite(maxDecimals) ? tailRaw.slice(0, maxDecimals) : tailRaw
    text = `${head}${tail}`
  }
  return text
}

const getMatchAiKey = (comboId, matchIdx) => `${comboId}::${matchIdx}`

const formatMatchAiReceipt = (patch) => {
  const parts = []
  if (patch?.isCorrect === true) parts.push('命中')
  if (patch?.isCorrect === false) parts.push('未中')
  if (patch?.results) parts.push(`赛果 ${patch.results}`)
  if (patch?.matchRating !== null && patch?.matchRating !== undefined) parts.push(`AJR ${patch.matchRating}`)
  if (patch?.matchRep !== null && patch?.matchRep !== undefined) parts.push(`REP ${patch.matchRep}`)
  if (patch?.postNote) parts.push(`备注 ${patch.postNote}`)
  return parts.join(' · ')
}

export default function SettlePage() {
  const labels = useLabels()
  const [pendingCombos, setPendingCombos] = useState(() => createPendingCombos())
  // 默认展开第一条待结算记录；演示态则全部折叠，进入后由「秀一下」动效展开首条。
  const [expandedCombo, setExpandedCombo] = useState(() => {
    if (isPreviewMode()) return null
    const initial = createPendingCombos()
    return initial.length > 0 ? initial[0].id : null
  })
  // 演示态首屏「展卷」：is-peek-unfurl 常驻（首条慢展、内容无回弹，手动再展亦从容）；
  // is-peek-dawn 瞬时（顶部破晓柔光，播放一次后撤下，手动再展不再复现）。
  const [peekUnfurlComboId, setPeekUnfurlComboId] = useState(null)
  const [peekDawnComboId, setPeekDawnComboId] = useState(null)
  const [forms, setForms] = useState(() => createInitialForms(createPendingCombos()))
  const [selectedComboIds, setSelectedComboIds] = useState({})
  const [batchRating, setBatchRating] = useState('')
  const [batchRep, setBatchRep] = useState('')
  const [historyAutoFillSnapshots, setHistoryAutoFillSnapshots] = useState({})
  const [waxSealBurst, setWaxSealBurst] = useState({ active: false, token: 0, x: 0, y: 0 })
  const [settleQuickOpen, setSettleQuickOpen] = useState(false)
  const [settleQuickText, setSettleQuickText] = useState('')
  const [settleQuickResult, setSettleQuickResult] = useState(null)
  const [settleQuickPhase, setSettleQuickPhase] = useState('idle')
  const [settleQuickMeta, setSettleQuickMeta] = useState(null)
  const settleQuickSourceRef = useRef('')
  const settleQuickAbortRef = useRef(null)
  const [matchAiStates, setMatchAiStates] = useState({})
  const matchAiAbortRef = useRef(new Map())

  useEffect(() => () => {
    settleQuickAbortRef.current?.abort()
    matchAiAbortRef.current.forEach((controller) => controller.abort())
    matchAiAbortRef.current.clear()
  }, [])

  const settledHistoryLookup = useMemo(() => {
    const lookup = new Map()

    getInvestments()
      .filter((item) => item.status !== 'pending')
      .forEach((investment) => {
        const createdAtTs = Number(new Date(investment.created_at).getTime()) || 0
        const matches = Array.isArray(investment.matches) ? investment.matches : []

        matches.forEach((match) => {
          const entryText =
            match.entry_text ||
            (Array.isArray(match.entries) ? match.entries.map((entry) => normalizeEntryName(entry?.name || '')).join(', ') : '')
          const key = buildHistoryLookupKey({
            homeTeam: match.home_team,
            awayTeam: match.away_team,
            entryText,
          })
          if (!key) return

          const source = {
            createdAtTs,
            results: String(match.results || '').trim(),
            isCorrect: typeof match.is_correct === 'boolean' ? match.is_correct : null,
            matchRating: toAjrOrNull(match.match_rating),
            matchRep: toNumberOrNull(match.match_rep),
            postNote: String(match.post_note || '').trim(),
          }
          const hasFillPayload =
            source.results || source.isCorrect !== null || source.matchRating !== null || source.matchRep !== null || source.postNote
          if (!hasFillPayload) return

          const previous = lookup.get(key)
          if (!previous || source.createdAtTs > previous.createdAtTs) {
            lookup.set(key, source)
          }
        })
      })

    return lookup
  }, [pendingCombos.length])

  useEffect(() => {
    setSelectedComboIds((prev) => {
      const next = {}
      pendingCombos.forEach((combo) => {
        next[combo.id] = prev[combo.id] ?? true
      })
      return next
    })
  }, [pendingCombos])

  // 演示态首屏「展卷」：进入页面后稍候，自动从容展开第一条待结算记录。
  // 走待结算专属的 is-peek-unfurl（慢展 + 内容无回弹）+ is-peek-dawn（顶部破晓柔光），
  // 只展开、不收回——让首条记录自我介绍，又保持整页克制的默认折叠态。
  useEffect(() => {
    if (!isPreviewMode()) return undefined
    const firstId = createPendingCombos()[0]?.id
    if (!firstId) return undefined
    // 降级：尊重 prefers-reduced-motion——直接展开，不加任何动效/柔光。
    if (prefersReducedMotion()) {
      setExpandedCombo((prev) => prev ?? firstId)
      return undefined
    }
    const timers = []
    timers.push(
      window.setTimeout(() => {
        setExpandedCombo((prev) => prev ?? firstId)
        setPeekUnfurlComboId(firstId)
        setPeekDawnComboId(firstId)
      }, SETTLE_PEEK_DELAY_MS),
    )
    timers.push(
      window.setTimeout(() => {
        // 破晓柔光退场（撤下 is-peek-dawn）；is-peek-unfurl 常驻不动。
        setPeekDawnComboId((cur) => (cur === firstId ? null : cur))
      }, SETTLE_PEEK_DELAY_MS + SETTLE_PEEK_DAWN_MS),
    )
    return () => timers.forEach((t) => window.clearTimeout(t))
    // 仅挂载时执行一次；演示态在页面生命周期内稳定。
  }, [])

  useEffect(() => {
    const pendingIds = new Set(pendingCombos.map((combo) => combo.id))
    setHistoryAutoFillSnapshots((prev) => {
      const next = {}
      Object.keys(prev).forEach((comboId) => {
        if (pendingIds.has(comboId)) {
          next[comboId] = prev[comboId]
        }
      })
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [pendingCombos])

  useEffect(() => {
    if (pendingCombos.length === 0 || settledHistoryLookup.size === 0) return
    // In preview mode the demo bundle intentionally pairs each pending
    // marquee single with a settled bundle containing the same teams.
    // The history-auto-fill engine would happily pull last week's
    // results / post_note into the new pending row, defeating the
    // demo's "fresh, blank, ready-to-record" framing. Skip the
    // entire auto-fill pass for preview.
    if (isPreviewMode()) return

    let changed = false
    const nextForms = { ...forms }
    const nextSnapshots = {}

    pendingCombos.forEach((combo) => {
      const currentForm = nextForms[combo.id]
      if (!currentForm || !Array.isArray(currentForm.matches)) return
      const comboSnapshots = historyAutoFillSnapshots[combo.id] || {}

      let comboChanged = false
      const nextMatches = currentForm.matches.map((formMatch, matchIdx) => {
        const existingSnapshot = comboSnapshots[matchIdx]
        if (existingSnapshot?.status === 'applied' || existingSnapshot?.status === 'dismissed') return formMatch

        const comboMatch = combo.matches[matchIdx]
        if (!comboMatch) return formMatch

        const key = buildHistoryLookupKey({
          homeTeam: comboMatch.homeTeam,
          awayTeam: comboMatch.awayTeam,
          entryText: comboMatch.entry,
        })
        if (!key) return formMatch

        const matched = settledHistoryLookup.get(key)
        if (!matched) return formMatch

        let matchChanged = false
        const filledFields = []
        const nextMatch = { ...formMatch }

        if (!String(nextMatch.results || '').trim() && matched.results) {
          nextMatch.results = matched.results
          matchChanged = true
          filledFields.push('results')
        }
        if (nextMatch.isCorrect === null && matched.isCorrect !== null) {
          nextMatch.isCorrect = matched.isCorrect
          matchChanged = true
          filledFields.push('isCorrect')
        }
        if (isEmptyValue(nextMatch.matchRating) && matched.matchRating !== null) {
          nextMatch.matchRating = String(matched.matchRating)
          matchChanged = true
          filledFields.push('matchRating')
        }
        if (isEmptyValue(nextMatch.matchRep) && matched.matchRep !== null) {
          nextMatch.matchRep = String(matched.matchRep)
          matchChanged = true
          filledFields.push('matchRep')
        }
        if (isEmptyValue(nextMatch.postNote) && matched.postNote) {
          nextMatch.postNote = matched.postNote
          matchChanged = true
          filledFields.push('postNote')
        }

        if (!matchChanged) return formMatch
        comboChanged = true
        if (!nextSnapshots[combo.id]) nextSnapshots[combo.id] = {}
        nextSnapshots[combo.id][matchIdx] = {
          status: 'applied',
          previousMatch: { ...formMatch },
          filledFields,
        }
        return nextMatch
      })

      if (!comboChanged) return

      changed = true
      nextForms[combo.id] = {
        ...currentForm,
        matches: nextMatches,
      }
    })

    if (!changed) return
    setForms(nextForms)
    setHistoryAutoFillSnapshots((prev) => {
      const next = { ...prev }
      Object.keys(nextSnapshots).forEach((comboId) => {
        next[comboId] = {
          ...(next[comboId] || {}),
          ...nextSnapshots[comboId],
        }
      })
      return next
    })
  }, [forms, historyAutoFillSnapshots, pendingCombos, settledHistoryLookup])

  const selectedCount = useMemo(
    () => pendingCombos.filter((combo) => selectedComboIds[combo.id]).length,
    [pendingCombos, selectedComboIds],
  )

  const updateMatchField = (comboId, matchIdx, field, value) => {
    const normalizedValue =
      field === 'matchRating' || field === 'matchRep'
        ? sanitizeDecimalInputText(value, { maxDecimals: 2 })
        : value
    setForms((prev) => ({
      ...prev,
      [comboId]: {
        ...prev[comboId],
        matches: prev[comboId].matches.map((match, idx) => (idx === matchIdx ? { ...match, [field]: normalizedValue } : match)),
      },
    }))
  }

  const updateMatchResult = (combo, matchIdx, value) => {
    const inferredHit = inferIsCorrectFromResult(combo.matches[matchIdx]?.entry, value)
    const isEmpty = !String(value || '').trim()
    setForms((prev) => {
      const current = prev[combo.id]
      if (!current) return prev
      return {
        ...prev,
        [combo.id]: {
          ...current,
          matches: current.matches.map((match, idx) => (idx === matchIdx
            ? {
              ...match,
              results: value,
              isCorrect: inferredHit === null ? (isEmpty ? null : match.isCorrect) : inferredHit,
            }
            : match)),
        },
      }
    })
  }

  const updateRevenue = (comboId, value) => {
    const normalizedRevenue = sanitizeDecimalInputText(value, { maxDecimals: 2 })
    setForms((prev) => ({
      ...prev,
      [comboId]: {
        ...prev[comboId],
        revenues: normalizedRevenue,
      },
    }))
  }

  const applySettleQuickResult = (parsed) => {
    const resolvedResult = resolveAiSettlementParse(parsed, pendingCombos)
    setForms((prev) => {
      const next = { ...prev }
      resolvedResult.resolved.forEach((item) => {
        const current = next[item.comboId]
        if (!current) return
        const patches = new Map(item.matchPatches.map((patch) => [patch.matchIndex, patch]))
        next[item.comboId] = {
          ...current,
          revenues: item.revenues === null ? current.revenues : String(item.revenues),
          matches: current.matches.map((match, matchIndex) => {
            const patch = patches.get(matchIndex)
            if (!patch) return match
            return {
              ...match,
              results: patch.results || match.results,
              isCorrect: patch.isCorrect === null ? match.isCorrect : patch.isCorrect,
              matchRating: patch.matchRating === null ? match.matchRating : String(patch.matchRating),
              matchRep: patch.matchRep === null ? match.matchRep : String(patch.matchRep),
              postNote: patch.postNote || match.postNote,
            }
          }),
        }
      })
      return next
    })
    if (resolvedResult.resolved.length > 0) {
      const ids = new Set(resolvedResult.resolved.map((item) => item.comboId))
      setSelectedComboIds(Object.fromEntries(pendingCombos.map((combo) => [combo.id, ids.has(combo.id)])))
      setExpandedCombo(resolvedResult.resolved[0].comboId)
    }
    setSettleQuickResult(resolvedResult)
    const formatted = formatStructuredSettlementInput(resolvedResult, pendingCombos)
    if (formatted) setSettleQuickText(formatted)
    return resolvedResult
  }

  const handleSettleQuickParse = async () => {
    const text = settleQuickText.trim()
    if (!text || pendingCombos.length === 0) return
    settleQuickAbortRef.current?.abort()
    settleQuickSourceRef.current = text
    setSettleQuickResult(null)
    setSettleQuickMeta(null)

    if (isPreviewMode()) {
      applySettleQuickResult(parseSettlementLocally(text, pendingCombos))
      setSettleQuickPhase('local')
      return
    }

    const controller = new AbortController()
    settleQuickAbortRef.current = controller
    setSettleQuickPhase('loading')
    try {
      const result = await requestAiSettlementParse(text, pendingCombos, { signal: controller.signal })
      if (controller.signal.aborted) return
      applySettleQuickResult(result)
      setSettleQuickMeta({ model: result.model, totalTokens: result.usage?.totalTokens || 0 })
      setSettleQuickPhase('ai')
    } catch (error) {
      if (controller.signal.aborted || error?.reason === 'request_cancelled') return
      const fallbackReason = {
        ai_not_configured: 'AI 尚未配置',
        provider_rate_limited: 'AI 请求较多',
        provider_timeout: 'AI 响应超时',
        client_timeout: 'AI 响应超时',
        provider_auth_failed: 'AI 密钥无效',
        no_pending_records: '没有待结算记录',
        text_too_long: '输入内容过长',
      }[error?.reason] || 'AI 暂时不可用'
      const local = parseSettlementLocally(text, pendingCombos)
      applySettleQuickResult({
        ...local,
        diagnostics: [
          { level: 'info', message: `${fallbackReason}，已切换为本地基础解析。` },
          ...(local.diagnostics || []),
        ],
      })
      setSettleQuickMeta({ reason: error?.reason || 'unknown' })
      setSettleQuickPhase('fallback')
    } finally {
      if (settleQuickAbortRef.current === controller) settleQuickAbortRef.current = null
    }
  }

  const resetSettleQuick = ({ restoreSource = false } = {}) => {
    settleQuickAbortRef.current?.abort()
    setSettleQuickText(restoreSource ? settleQuickSourceRef.current : '')
    if (!restoreSource) settleQuickSourceRef.current = ''
    setSettleQuickResult(null)
    setSettleQuickPhase('idle')
    setSettleQuickMeta(null)
  }

  const updateMatchAiText = (comboId, matchIdx, text) => {
    const key = getMatchAiKey(comboId, matchIdx)
    matchAiAbortRef.current.get(key)?.abort()
    matchAiAbortRef.current.delete(key)
    setMatchAiStates((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        text,
        phase: 'idle',
        result: null,
        diagnostics: [],
        meta: null,
      },
    }))
  }

  const applyMatchAiResult = (combo, matchIdx, parsed) => {
    const targetMatch = combo.matches[matchIdx]
    if (!targetMatch) return { patch: null, diagnostics: [{ level: 'warning', message: '目标比赛不存在。' }] }
    const contextCombo = { ...combo, matches: [targetMatch] }
    const resolved = resolveAiSettlementParse(parsed, [contextCombo])
    const parsedPatch = resolved.resolved?.[0]?.matchPatches?.[0]
    if (!parsedPatch) {
      return { patch: null, diagnostics: resolved.diagnostics || [] }
    }
    const patch = {
      ...parsedPatch,
      // Per-match shorthand: once AJR is supplied, omitted REP means no
      // random event, not an unfinished field.
      matchRep:
        parsedPatch.matchRating !== null &&
        parsedPatch.matchRating !== undefined &&
        (parsedPatch.matchRep === null || parsedPatch.matchRep === undefined)
          ? 0
          : parsedPatch.matchRep,
    }
    const hasPayload = Boolean(
      patch.results ||
      (patch.isCorrect !== null && patch.isCorrect !== undefined) ||
      (patch.matchRating !== null && patch.matchRating !== undefined) ||
      (patch.matchRep !== null && patch.matchRep !== undefined) ||
      patch.postNote,
    )
    if (!hasPayload) {
      return {
        patch: null,
        diagnostics: [...(resolved.diagnostics || []), { level: 'warning', message: '没有识别到可填入本场的结算信息。' }],
      }
    }

    setForms((prev) => {
      const current = prev[combo.id]
      if (!current) return prev
      return {
        ...prev,
        [combo.id]: {
          ...current,
          matches: current.matches.map((match, index) => index === matchIdx
            ? {
                ...match,
                results: patch.results || match.results,
                isCorrect: patch.isCorrect === null || patch.isCorrect === undefined ? match.isCorrect : patch.isCorrect,
                matchRating: patch.matchRating === null || patch.matchRating === undefined ? match.matchRating : String(patch.matchRating),
                matchRep: patch.matchRep === null || patch.matchRep === undefined ? match.matchRep : String(patch.matchRep),
                postNote: patch.postNote || match.postNote,
              }
            : match),
        },
      }
    })
    return { patch, diagnostics: resolved.diagnostics || [] }
  }

  const finishMatchAiParse = (combo, matchIdx, parsed, phase, meta = null) => {
    const key = getMatchAiKey(combo.id, matchIdx)
    const applied = applyMatchAiResult(combo, matchIdx, parsed)
    setMatchAiStates((prev) => {
      const current = prev[key] || {}
      if (!applied.patch) {
        return {
          ...prev,
          [key]: {
            ...current,
            phase: 'error',
            result: null,
            diagnostics: applied.diagnostics,
            meta,
          },
        }
      }
      return {
        ...prev,
        [key]: {
          ...current,
          text: formatMatchAiReceipt(applied.patch),
          phase,
          result: applied.patch,
          diagnostics: applied.diagnostics,
          meta,
        },
      }
    })
    return applied.patch
  }

  const handleMatchAiParse = async (combo, matchIdx) => {
    const key = getMatchAiKey(combo.id, matchIdx)
    const text = String(matchAiStates[key]?.text || '').trim()
    const targetMatch = combo.matches[matchIdx]
    if (!text || !targetMatch) return

    matchAiAbortRef.current.get(key)?.abort()
    const sourceText = text
    setMatchAiStates((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        text,
        sourceText,
        phase: 'loading',
        result: null,
        diagnostics: [],
        meta: null,
      },
    }))
    const contextCombo = { ...combo, matches: [targetMatch] }

    if (isPreviewMode()) {
      finishMatchAiParse(combo, matchIdx, parseSingleMatchSettlementLocally(text, contextCombo), 'local')
      return
    }

    const controller = new AbortController()
    matchAiAbortRef.current.set(key, controller)
    try {
      const result = await requestAiSettlementParse(text, [contextCombo], { signal: controller.signal, scope: 'match' })
      if (controller.signal.aborted) return
      finishMatchAiParse(combo, matchIdx, result, 'ai', {
        model: result.model,
        totalTokens: result.usage?.totalTokens || 0,
      })
    } catch (error) {
      if (controller.signal.aborted || error?.reason === 'request_cancelled') return
      const local = parseSingleMatchSettlementLocally(text, contextCombo)
      finishMatchAiParse(combo, matchIdx, {
        ...local,
        diagnostics: [
          { level: 'info', message: 'AI 暂时不可用，已切换为本地基础解析。' },
          ...(local.diagnostics || []),
        ],
      }, 'fallback', { reason: error?.reason || 'unknown' })
    } finally {
      if (matchAiAbortRef.current.get(key) === controller) matchAiAbortRef.current.delete(key)
    }
  }

  const resetMatchAi = (comboId, matchIdx, { restoreSource = false } = {}) => {
    const key = getMatchAiKey(comboId, matchIdx)
    matchAiAbortRef.current.get(key)?.abort()
    matchAiAbortRef.current.delete(key)
    setMatchAiStates((prev) => {
      const current = prev[key] || {}
      return {
        ...prev,
        [key]: {
          text: restoreSource ? String(current.sourceText || '') : '',
          sourceText: restoreSource ? String(current.sourceText || '') : '',
          phase: 'idle',
          result: null,
          diagnostics: [],
          meta: null,
        },
      }
    })
  }

  const revertHistoryAutoFillMatch = (comboId, matchIdx) => {
    const snapshot = historyAutoFillSnapshots[comboId]?.[matchIdx]
    if (!snapshot?.previousMatch || snapshot.status !== 'applied') return

    setForms((prev) => ({
      ...prev,
      [comboId]: {
        ...prev[comboId],
        matches: prev[comboId].matches.map((match, idx) => (idx === matchIdx ? { ...snapshot.previousMatch } : match)),
      },
    }))
    setHistoryAutoFillSnapshots((prev) => ({
      ...prev,
      [comboId]: {
        ...(prev[comboId] || {}),
        [matchIdx]: {
          status: 'dismissed',
        },
      },
    }))
  }

  const getValidationError = (form) => {
    if (!form) return '记录表单不存在。'
    const hasUnsetHit = form.matches.some((match) => match.isCorrect === null)
    if (hasUnsetHit) {
      return '请先把每场比赛的“是否命中”填写完整。'
    }

    const invalidAjrIndex = form.matches.findIndex((match) => !isAjrValueValid(match.matchRating))
    if (invalidAjrIndex >= 0) {
      return `第 ${invalidAjrIndex + 1} 场 AJR 需在 0~0.8 之间。`
    }

    const revenues = Number.parseFloat(form.revenues)
    if (!Number.isFinite(revenues) || revenues < 0) {
      return 'Revenue 实际收益需要是大于等于 0 的数字。'
    }
    return ''
  }

  const buildSettlementUpdater = (combo, form) => (previous) => {
    const revenues = Number.parseFloat(form.revenues)
    const status = form.matches.every((match) => match.isCorrect === true) ? 'win' : 'lose'
    const profit = Number((revenues - combo.totalInputs).toFixed(2))
    const ratingValues = form.matches.map((match) => toAjrOrNull(match.matchRating)).filter((value) => value !== null)
    const repValues = form.matches.map((match) => toNumberOrNull(match.matchRep)).filter((value) => value !== null)
    const actualRating =
      ratingValues.length > 0 ? Number((ratingValues.reduce((sum, value) => sum + value, 0) / ratingValues.length).toFixed(2)) : null
    const rep = repValues.length > 0 ? Number((repValues.reduce((sum, value) => sum + value, 0) / repValues.length).toFixed(2)) : null
    const remarks = form.matches
      .map((match, idx) => {
        const note = String(match.postNote || '').trim()
        if (!note) return ''
        return `M${idx + 1}: ${note}`
      })
      .filter(Boolean)
      .join('；')

    return {
      ...previous,
      status,
      revenues: Number(revenues.toFixed(2)),
      profit,
      actual_rating: actualRating,
      rep,
      remarks,
      matches: (previous.matches || []).map((match, idx) => ({
        ...match,
        results: String(form.matches[idx]?.results || '').trim(),
        is_correct: form.matches[idx]?.isCorrect ?? null,
        match_rating: toAjrOrNull(form.matches[idx]?.matchRating),
        match_rep: toNumberOrNull(form.matches[idx]?.matchRep),
        post_note: String(form.matches[idx]?.postNote || '').trim(),
      })),
    }
  }

  const applySettlement = (combo, form) => updateInvestment(combo.id, buildSettlementUpdater(combo, form))

  const applySettlementsAtomically = (targetCombos) => updateInvestments(
    targetCombos.map((combo) => ({
      id: combo.id,
      updater: buildSettlementUpdater(combo, forms[combo.id]),
    })),
  )

  const settleCombos = (targetCombos) => {
    const ids = new Set(targetCombos.map((combo) => combo.id))
    const isSettledMatchKey = (key) => ids.has(String(key).split('::')[0])
    matchAiAbortRef.current.forEach((controller, key) => {
      if (isSettledMatchKey(key)) {
        controller.abort()
        matchAiAbortRef.current.delete(key)
      }
    })
    setPendingCombos((prev) => prev.filter((item) => !ids.has(item.id)))
    setForms((prev) => {
      const next = { ...prev }
      targetCombos.forEach((combo) => {
        delete next[combo.id]
      })
      return next
    })
    setSelectedComboIds((prev) => {
      const next = { ...prev }
      targetCombos.forEach((combo) => {
        delete next[combo.id]
      })
      return next
    })
    setHistoryAutoFillSnapshots((prev) => {
      const next = { ...prev }
      targetCombos.forEach((combo) => {
        delete next[combo.id]
      })
      return next
    })
    setMatchAiStates((prev) => Object.fromEntries(
      Object.entries(prev).filter(([key]) => !isSettledMatchKey(key)),
    ))
    setExpandedCombo((prev) => (prev && ids.has(prev) ? null : prev))
  }

  const triggerWaxSealStamp = (target, options = {}) => {
    const point = getWaxSealStampPoint(target)
    setWaxSealBurst((prev) => ({
      active: true,
      token: prev.token + 1,
      x: point.x,
      y: point.y,
      // A hit earns an emerald, celebratory seal; everything else (a loss,
      // or a mixed batch) keeps the sober amber stamp.
      tone: options.tone === 'win' ? 'win' : 'neutral',
      profit: Number.isFinite(options.profit) ? options.profit : null,
    }))
  }

  const handleWaxSealStampDone = () => {
    setWaxSealBurst((prev) => ({ ...prev, active: false }))
  }

  const confirmSettlement = (combo, event) => {
    const form = forms[combo.id]
    const error = getValidationError(form)
    if (error) {
      window.alert(error)
      return
    }
    const isWin = form.matches.every((match) => match.isCorrect === true)
    const profit = Number((Number.parseFloat(form.revenues) - combo.totalInputs).toFixed(2))
    triggerWaxSealStamp(event?.currentTarget, { tone: isWin ? 'win' : 'neutral', profit })
    applySettlement(combo, form)

    // 结算后自动微调自适应权重（安全约束：单次 ±0.02，总量 ≤0.08）
    try { autoApplyAdaptiveWeights() } catch { /* non-critical */ }

    // 找到当前结算项的下一条，用于自动展开
    const currentIndex = pendingCombos.findIndex((c) => c.id === combo.id)
    const nextCombo = pendingCombos[currentIndex + 1]

    settleCombos([combo])

    // 自动展开下一条待结算记录
    if (nextCombo) {
      setExpandedCombo(nextCombo.id)
    }
  }

  const handleDeletePending = (combo, event) => {
    event.stopPropagation()
    const ok = window.confirm(`确认删除这笔待结算记录吗？\n${combo.date} · ${getComboLabel(combo.matches.length)}`)
    if (!ok) return
    const deleted = deleteInvestment(combo.id)
    if (!deleted) return
    settleCombos([combo])
  }

  const toggleComboSelection = (comboId) => {
    setSelectedComboIds((prev) => ({ ...prev, [comboId]: !prev[comboId] }))
  }

  const toggleSelectAll = () => {
    const shouldSelectAll = selectedCount !== pendingCombos.length
    const next = {}
    pendingCombos.forEach((combo) => {
      next[combo.id] = shouldSelectAll
    })
    setSelectedComboIds(next)
  }

  const handleBatchSettlement = (event) => {
    const targetCombos = pendingCombos.filter((combo) => selectedComboIds[combo.id])
    if (targetCombos.length === 0) {
      window.alert('请先勾选要批量结算的记录。')
      return
    }

    const invalid = targetCombos
      .map((combo) => {
        const error = getValidationError(forms[combo.id])
        if (!error) return ''
        return `${combo.date} ${getComboLabel(combo.matches.length)}：${error}`
      })
      .filter(Boolean)

    if (invalid.length > 0) {
      window.alert(`以下记录尚未填完整，无法批量结算：\n${invalid.slice(0, 5).join('\n')}`)
      return
    }

    const ok = window.confirm(`确认批量结算已勾选的 ${targetCombos.length} 笔记录吗？`)
    if (!ok) return

    const saved = applySettlementsAtomically(targetCombos)
    if (saved.length !== targetCombos.length) {
      window.alert('批量结算写入失败，表单已保留，请重试。')
      return
    }
    triggerWaxSealStamp(event?.currentTarget)
    try { autoApplyAdaptiveWeights() } catch { /* non-critical */ }
    settleCombos(targetCombos)
  }

  const handleSettleQuickArchive = (event) => {
    const resolvedIds = [...new Set((settleQuickResult?.resolved || []).map((item) => item.comboId))]
    const targetCombos = resolvedIds
      .map((id) => pendingCombos.find((combo) => combo.id === id))
      .filter(Boolean)
    if (targetCombos.length === 0) {
      window.alert('没有可结算的匹配记录。')
      return
    }
    const invalid = targetCombos
      .map((combo) => ({ combo, error: getValidationError(forms[combo.id]) }))
      .filter((item) => item.error)
    if (invalid.length > 0) {
      setExpandedCombo(invalid[0].combo.id)
      window.alert(`AI 已填入，但以下记录仍需补充：\n${invalid
        .slice(0, 5)
        .map(({ combo, error }) => `${combo.date} ${getComboLabel(combo.matches.length)}：${error}`)
        .join('\n')}`)
      return
    }
    const ok = window.confirm(`确认一键结算已匹配的 ${targetCombos.length} 笔记录吗？`)
    if (!ok) return

    const totalProfit = targetCombos.reduce((sum, combo) => {
      const revenue = Number.parseFloat(forms[combo.id]?.revenues)
      return sum + (Number.isFinite(revenue) ? revenue - combo.totalInputs : 0)
    }, 0)
    const allWin = targetCombos.every((combo) => forms[combo.id]?.matches.every((match) => match.isCorrect === true))
    const saved = applySettlementsAtomically(targetCombos)
    if (saved.length !== targetCombos.length) {
      window.alert('一键结算写入失败，解析结果和表单已保留。')
      return
    }
    triggerWaxSealStamp(event?.currentTarget, {
      tone: allWin ? 'win' : 'neutral',
      profit: Number(totalProfit.toFixed(2)),
    })
    try { autoApplyAdaptiveWeights() } catch { /* non-critical */ }
    settleCombos(targetCombos)
    resetSettleQuick()
  }

  const applyBatchFill = () => {
    const targetIds = pendingCombos.filter((combo) => selectedComboIds[combo.id]).map((combo) => combo.id)
    if (targetIds.length === 0) {
      window.alert('请先勾选要填充的记录。')
      return
    }

    const hasBatchRating = String(batchRating ?? '').trim() !== ''
    if (hasBatchRating && !isAjrValueValid(batchRating)) {
      window.alert('批量 AJR 需在 0~0.8 之间。')
      return
    }

    const ratingValue = hasBatchRating ? toAjrOrNull(batchRating) : null
    const repValue = toNumberOrNull(batchRep)
    if (ratingValue === null && repValue === null) {
      window.alert('请至少填写一个批量值（AJR 或 REP）。')
      return
    }

    setForms((prev) => {
      const next = { ...prev }
      targetIds.forEach((comboId) => {
        const form = next[comboId]
        if (!form) return
        next[comboId] = {
          ...form,
          matches: form.matches.map((match) => ({
            ...match,
            matchRating:
              ratingValue !== null && (match.matchRating === '' || match.matchRating === null || match.matchRating === undefined)
                ? String(ratingValue)
                : match.matchRating,
            matchRep:
              repValue !== null && (match.matchRep === '' || match.matchRep === null || match.matchRep === undefined)
                ? String(repValue)
                : match.matchRep,
          })),
        }
      })
      return next
    })
  }

  const settleQuickHasResult = Boolean(
    settleQuickResult?.resolved?.length > 0 && ['ai', 'fallback', 'local'].includes(settleQuickPhase),
  )
  const settleQuickResolvedCount = settleQuickResult?.resolved?.length || 0

  return (
    <div className="page-shell page-content-wide motion-v2-scope">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-stone-800 font-display">待结算</h2>
        <p className="text-stone-400 text-sm mt-1">{pendingCombos.length} 笔投资待录入结果</p>
      </div>

      {pendingCombos.length > 0 && (
        <div className="settle-ai-quick-card motion-v2-surface glow-card mb-4 overflow-hidden rounded-2xl border">
          <button
            type="button"
            onClick={() => setSettleQuickOpen((open) => !open)}
            aria-expanded={settleQuickOpen}
            className="settle-ai-trigger motion-v2-ghost-btn flex w-full items-center gap-2 px-4 py-3 text-left"
          >
            <ChevronRight size={14} strokeWidth={2.2} className={`qi-chevron settle-ai-chevron${settleQuickOpen ? ' is-open' : ''}`} />
            <span className="settle-ai-title">General Quick Settle</span>
            <span className="settle-ai-beta-badge ml-1">LAB · AI</span>
            <span className="settle-ai-subtitle ml-1">大模型自然语言快捷结算</span>
          </button>

          <div className={`qi-collapse${settleQuickOpen ? ' is-open' : ''}`} inert={settleQuickOpen ? undefined : ''}>
            <div className="qi-collapse-inner">
              <div className="settle-ai-body space-y-2 px-4 pb-4">
                <textarea
                  value={settleQuickText}
                  onChange={(event) => {
                    settleQuickAbortRef.current?.abort()
                    setSettleQuickText(event.target.value)
                    if (settleQuickResult || settleQuickPhase === 'loading') {
                      setSettleQuickResult(null)
                      setSettleQuickPhase('idle')
                      setSettleQuickMeta(null)
                    }
                  }}
                  maxLength={AI_SETTLE_MAX_TEXT_LENGTH}
                  readOnly={settleQuickHasResult}
                  rows={settleQuickHasResult ? Math.min(14, 3 + settleQuickResolvedCount * 3) : 3}
                  placeholder={'示例：1. 皇马2-1皇社，命中，收入98.80，AJR 0.68，REP 0.2\n2. 巴萨3-3皇马，未中，收入0，备注：红牌改变了走势'}
                  aria-label={settleQuickHasResult ? '解析后的结构化结算数据' : '自然语言结算描述'}
                  className={`settle-ai-textarea input-glow w-full resize-none rounded-xl border px-3 py-2 text-sm focus:outline-none${settleQuickHasResult ? ' is-structured' : ''}`}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {!settleQuickHasResult && (
                    <button
                      type="button"
                      onClick={handleSettleQuickParse}
                      disabled={!settleQuickText.trim() || settleQuickPhase === 'loading'}
                      aria-busy={settleQuickPhase === 'loading'}
                      className="settle-ai-parse-btn"
                    >
                      {settleQuickPhase === 'loading'
                        ? <Loader2 size={13} className="qi-ai-spinner" aria-hidden="true" />
                        : <Sparkles size={13} aria-hidden="true" />}
                      <span>{settleQuickPhase === 'loading' ? '正在匹配…' : (isPreviewMode() ? '解析并填入' : 'AI 解析并填入')}</span>
                    </button>
                  )}
                  {settleQuickHasResult && (
                    <>
                      <button type="button" onClick={handleSettleQuickArchive} className="settle-ai-archive-btn">
                        <Archive size={13} aria-hidden="true" />
                        <span>一键结算{settleQuickResolvedCount > 1 ? ` · ${settleQuickResolvedCount} 笔` : ''}</span>
                      </button>
                      <button type="button" onClick={() => resetSettleQuick({ restoreSource: true })} className="qi-reinput-btn">
                        <RotateCcw size={12} aria-hidden="true" />
                        重新输入
                      </button>
                    </>
                  )}
                  {settleQuickText.trim() && !settleQuickHasResult && settleQuickPhase !== 'loading' && (
                    <button type="button" onClick={() => resetSettleQuick()} className="px-3 py-1.5 text-xs text-stone-500 transition-colors hover:text-stone-700">
                      清空
                    </button>
                  )}
                  <span className="settle-ai-privacy">
                    <ShieldCheck size={11} aria-hidden="true" />
                    {settleQuickHasResult ? '已填入对应记录 · 结算前仍会完整校验' : '只填表，不会自动结算'}
                  </span>
                </div>

                {settleQuickResult && (
                  <div className={`settle-ai-result is-${settleQuickPhase}`} role="status" aria-live="polite">
                    <div className="qi-ai-result-heading">
                      <span className="settle-ai-result-orb" aria-hidden="true"><Sparkles size={11} /></span>
                      <span>
                        {settleQuickPhase === 'ai' && 'DeepSeek 已完成结算匹配'}
                        {settleQuickPhase === 'fallback' && '已切换至本地基础解析'}
                        {settleQuickPhase === 'local' && '本地结算解析完成'}
                      </span>
                      {settleQuickPhase === 'ai' && settleQuickMeta?.model && <span className="qi-ai-model">{settleQuickMeta.model}</span>}
                    </div>
                    <p className="settle-ai-result-summary">
                      已匹配 {settleQuickResolvedCount} 笔待结算记录
                      {settleQuickPhase === 'ai' && settleQuickMeta?.totalTokens > 0 ? ` · ${settleQuickMeta.totalTokens} tokens` : ''}
                    </p>
                    {(settleQuickResult.diagnostics || []).map((diagnostic, index) => (
                      <p key={index} className={`settle-ai-diagnostic is-${diagnostic.level || 'info'}`}>{diagnostic.message}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingCombos.length > 0 && (
        <div className="mb-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="text-xs text-stone-500">已勾选 {selectedCount}/{pendingCombos.length}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              placeholder="批量 AJR"
              value={batchRating}
              onChange={(event) => setBatchRating(sanitizeDecimalInputText(event.target.value, { maxDecimals: 2 }))}
              className="w-24 sm:w-28 px-2 py-1.5 rounded-lg border border-stone-200 text-xs text-right"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder={`批量 ${labels.rep.short}`}
              value={batchRep}
              onChange={(event) => setBatchRep(sanitizeDecimalInputText(event.target.value, { maxDecimals: 2 }))}
              className="w-24 sm:w-28 px-2 py-1.5 rounded-lg border border-stone-200 text-xs text-right"
            />
            <button onClick={applyBatchFill} className="motion-v2-ghost-btn px-3 py-1.5 text-xs rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors">
              填充空值
            </button>
            <button onClick={toggleSelectAll} className="motion-v2-ghost-btn px-3 py-1.5 text-xs rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors">
              {selectedCount === pendingCombos.length ? '取消全选' : '全选'}
            </button>
            <button onClick={(event) => handleBatchSettlement(event)} className="motion-v2-ghost-btn px-3 py-1.5 text-xs rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors">
              批量结算已选
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {pendingCombos.map((combo) => (
          <div key={combo.id} className="motion-v2-surface glow-card bg-white rounded-2xl border border-stone-100 overflow-hidden">
            <div
              onClick={() => setExpandedCombo(expandedCombo === combo.id ? null : combo.id)}
              className="motion-v2-row px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-stone-50/50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    combo.matches.length === 1 ? 'bg-amber-100' : combo.matches.length === 2 ? 'bg-sky-100' : 'bg-violet-100'
                  }`}
                >
                  <span
                    className={`text-sm font-bold ${
                      combo.matches.length === 1 ? 'text-amber-600' : combo.matches.length === 2 ? 'text-sky-600' : 'text-violet-600'
                    }`}
                  >
                    {combo.matches.length}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-stone-800">{getComboLabel(combo.matches.length)}</p>
                  <p className="text-sm text-stone-500">
                    综合 Odds <span className="font-bold text-violet-600">{combo.totalOdds}</span> · 投资{' '}
                    <span className="font-bold text-amber-600">{combo.totalInputs} rmb</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    toggleComboSelection(combo.id)
                  }}
                  className={`custom-checkbox ${selectedComboIds[combo.id] ? 'checked' : ''}`}
                  aria-label={selectedComboIds[combo.id] ? '取消勾选待结算记录' : '勾选待结算记录'}
                  aria-pressed={Boolean(selectedComboIds[combo.id])}
                />
                <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">待结算</span>
                {expandedCombo === combo.id ? <ChevronUp size={16} className="text-stone-400" /> : <ChevronDown size={16} className="text-stone-400" />}
                <button
                  type="button"
                  onClick={(event) => handleDeletePending(combo, event)}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-stone-100/80 text-stone-500 hover:bg-rose-100 hover:text-rose-600 active:scale-95 transition-all"
                  title="删除待结算记录"
                  aria-label="删除待结算记录"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div
              className={`qi-collapse${expandedCombo === combo.id ? ' is-open' : ''}${
                peekUnfurlComboId === combo.id ? ' is-peek-unfurl' : ''
              }${peekDawnComboId === combo.id ? ' is-peek-dawn' : ''}`}
              inert={expandedCombo === combo.id ? undefined : ''}
            >
              <div className="qi-collapse-inner">
              <div className="relative p-6 border-t border-stone-100 space-y-6">
                {combo.matches.map((match, matchIdx) => {
                  const matchAutoFillSnapshot = historyAutoFillSnapshots[combo.id]?.[matchIdx]
                  const showAutoFillTag = matchAutoFillSnapshot?.status === 'applied'
                  const matchAiKey = getMatchAiKey(combo.id, matchIdx)
                  const matchAiState = matchAiStates[matchAiKey] || { text: '', phase: 'idle', result: null, diagnostics: [] }
                  const matchAiHasResult = Boolean(matchAiState.result)
                  return (
                  <div key={`${combo.id}-${matchIdx}`} className={`motion-v2-match-card ${matchIdx > 0 ? 'pt-6 border-t border-stone-100' : ''}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="font-semibold text-stone-800">{match.match}</p>
                        {showAutoFillTag && (
                          <div className="history-float-panel history-float-enter px-1.5 py-0.5 rounded-md">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-medium text-sky-600">已自动填充</span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  revertHistoryAutoFillMatch(combo.id, matchIdx)
                                }}
                                className="history-float-item rounded-md border border-sky-200/70 bg-sky-100/70 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 hover:bg-sky-100/90 transition-colors"
                              >
                                撤回
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-stone-400">
                        Odds <span className="font-bold italic text-violet-600">{match.odds}</span>
                      </span>
                    </div>

                    <div className="mb-4 p-3 bg-amber-50 rounded-xl border border-amber-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-amber-600 font-medium">我的预测</span>
                          <span className="text-sm font-semibold text-stone-800">{match.entry}</span>
                        </div>
                        {match.preNote && <span className="text-xs text-stone-400">赛前备注: {match.preNote}</span>}
                      </div>
                    </div>

                    <div className={`settle-match-ai-card mb-4${matchAiHasResult ? ' is-resolved' : ''}`}>
                      <div className="settle-match-ai-heading">
                        <span className="settle-match-ai-orb" aria-hidden="true"><Sparkles size={10} /></span>
                        <span className="settle-match-ai-title">AI 快捷结算</span>
                        <span className="settle-match-ai-caption">随口写，自动填本场</span>
                        {matchAiState.phase === 'ai' && matchAiState.meta?.totalTokens > 0 && (
                          <span className="settle-match-ai-tokens">{matchAiState.meta.totalTokens} tokens</span>
                        )}
                      </div>
                      <div className="settle-match-ai-row">
                        <textarea
                          rows={1}
                          maxLength={AI_SETTLE_MAX_TEXT_LENGTH}
                          readOnly={matchAiHasResult}
                          value={matchAiState.text}
                          onChange={(event) => updateMatchAiText(combo.id, matchIdx, event.target.value)}
                          onKeyDown={(event) => {
                            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !matchAiHasResult) {
                              event.preventDefault()
                              handleMatchAiParse(combo, matchIdx)
                            }
                          }}
                          placeholder="例如：没中，AJR 0.4 / no 0.4 / 0.4"
                          aria-label={`${match.match} AI 快捷结算`}
                          className={`settle-match-ai-input${matchAiHasResult ? ' is-structured' : ''}`}
                        />
                        {!matchAiHasResult ? (
                          <button
                            type="button"
                            onClick={() => handleMatchAiParse(combo, matchIdx)}
                            disabled={!matchAiState.text.trim() || matchAiState.phase === 'loading'}
                            className="settle-match-ai-button"
                          >
                            {matchAiState.phase === 'loading'
                              ? <Loader2 size={12} className="qi-ai-spinner" aria-hidden="true" />
                              : <Sparkles size={12} aria-hidden="true" />}
                            <span>{matchAiState.phase === 'loading' ? '理解中…' : '理解并填入'}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => resetMatchAi(combo.id, matchIdx, { restoreSource: true })}
                            className="settle-match-ai-reset"
                          >
                            <RotateCcw size={11} aria-hidden="true" />
                            重输
                          </button>
                        )}
                      </div>
                      {matchAiState.phase === 'error' && (
                        <p className="settle-match-ai-message is-error">
                          {matchAiState.diagnostics?.[0]?.message || '没有理解到可填入的信息，请换一种说法。'}
                        </p>
                      )}
                      {matchAiHasResult && (
                        <p className="settle-match-ai-message">已写入下方字段，最终仍由「确认结算」统一保存。</p>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                      <div>
                        <label className="text-xs text-stone-400 mb-1.5 block">Results 实际结果</label>
                        <input
                          type="text"
                          placeholder="比分或结果..."
                          value={forms[combo.id]?.matches[matchIdx]?.results || ''}
                          onChange={(event) => updateMatchResult(combo, matchIdx, event.target.value)}
                          className="input-glow w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-stone-400 mb-1.5 block">是否命中</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateMatchField(combo.id, matchIdx, 'isCorrect', true)}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-medium btn-hover flex items-center justify-center gap-1 ${
                              forms[combo.id]?.matches[matchIdx]?.isCorrect === true
                                ? 'bg-emerald-500 text-white'
                                : 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200'
                            }`}
                          >
                            <Check size={14} /> 中
                          </button>
                          <button
                            onClick={() => updateMatchField(combo.id, matchIdx, 'isCorrect', false)}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-medium btn-hover flex items-center justify-center gap-1 ${
                              forms[combo.id]?.matches[matchIdx]?.isCorrect === false
                                ? 'bg-rose-500 text-white'
                                : 'bg-stone-100 text-stone-500 border border-stone-200 hover:bg-stone-200'
                            }`}
                          >
                            <X size={14} /> 未中
                          </button>
                        </div>
                      </div>
                      <div className="relative group">
                        <label className="text-xs text-stone-400 mb-1.5 block">
                          Actual Judgmental Rating
                          <span className="ml-1 text-stone-300 cursor-help" title="赛后复盘评分">?</span>
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0~0.8"
                          value={forms[combo.id]?.matches[matchIdx]?.matchRating ?? ''}
                          onChange={(event) => updateMatchField(combo.id, matchIdx, 'matchRating', event.target.value)}
                          className="input-glow w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm"
                        />
                        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-56 p-2 bg-stone-800 text-white text-[10px] rounded-lg shadow-lg">
                          <p className="font-medium mb-1">赛后复盘评分 (0-0.8)</p>
                          <p>0.64-0.8: 判断极准，过程结果完美匹配</p>
                          <p>0.48-0.64: 判断正确，略有偏差</p>
                          <p>0.32-0.48: 判断一般，有明显失误</p>
                          <p>0.16-0.32: 判断较差，结果靠运气</p>
                          <p>&lt;0.16: 完全误判</p>
                        </div>
                      </div>
                      <div className="relative group">
                        <label className="text-xs text-stone-400 mb-1.5 block">
                          {labels.rep.long}
                          <span className="ml-1 text-stone-300 cursor-help" title={labels.rep.long}>?</span>
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0~1.8"
                          value={forms[combo.id]?.matches[matchIdx]?.matchRep ?? ''}
                          onChange={(event) => updateMatchField(combo.id, matchIdx, 'matchRep', event.target.value)}
                          className="input-glow w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm"
                        />
                        <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover:block w-64 p-2 bg-stone-800 text-white text-[10px] rounded-lg shadow-lg">
                          <p className="font-medium mb-1">{labels.rep.long} (0-1.8)</p>
                          <p className="text-stone-300 mb-1">0: 没有随机事件</p>
                          <p className="text-stone-300 mb-1">0.2-0.8: 有随机事件但未影响结果</p>
                          <p className="text-amber-300 font-medium mt-1">以下为影响结果的随机事件:</p>
                          <p>1.2: 刻意制造的混乱 / 世界波 / 3+绝佳机会missed</p>
                          <p>1.4: 偶然出现的混乱 / 蒙了一脚</p>
                          <p>1.6: 点球、红牌 / 神仙球</p>
                          <p>1.8: 极其偶然，unpredictable</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="text-xs text-stone-400 mb-1.5 block">赛后备注（复盘心得）</label>
                      <textarea
                        rows={2}
                        placeholder="选填..."
                        value={forms[combo.id]?.matches[matchIdx]?.postNote || ''}
                        onChange={(event) => updateMatchField(combo.id, matchIdx, 'postNote', event.target.value)}
                        onKeyDown={(event) => {
                          const current = forms[combo.id]?.matches[matchIdx]?.postNote || ''
                          handleNoteShortcut(event, current, (next) => updateMatchField(combo.id, matchIdx, 'postNote', next))
                        }}
                        className="input-glow w-full px-3 py-2.5 rounded-xl border border-stone-200 text-sm resize-y min-h-16"
                      />
                      <p className="mt-1 text-[10px] text-stone-400">快捷键：Cmd/Ctrl+B 粗体 · Cmd/Ctrl+I 斜体 · Cmd/Ctrl+Shift+R 红色 · Cmd/Ctrl+Shift+B 蓝色</p>
                    </div>
                  </div>
                )})}

                <div className="pt-4 border-t border-stone-200">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <label className="text-xs text-stone-400 mb-1.5 block">Revenue 实际收益</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={forms[combo.id]?.revenues ?? ''}
                          onChange={(event) => updateRevenue(combo.id, event.target.value)}
                          className="input-glow w-32 px-3 py-2.5 rounded-xl border border-stone-200 text-sm font-medium"
                        />
                        <span className="text-sm text-stone-500">rmb</span>
                        <span className="text-xs text-stone-400 ml-2">（按赔率比例分摊至各场）</span>
                      </div>
                    </div>
                    <button onClick={(event) => confirmSettlement(combo, event)} className="btn-primary btn-hover">
                      确认结算
                    </button>
                  </div>
                </div>
              </div>
              </div>
            </div>
          </div>
        ))}

        {pendingCombos.length === 0 && (
          <div className="glow-card bg-white rounded-2xl border border-stone-100 p-10 text-center text-stone-500">
            暂无待结算投资，去「新建投资」录一笔再回来吧。
          </div>
        )}
      </div>
      <WaxSealStampOverlay burst={waxSealBurst} onDone={handleWaxSealStampDone} />
    </div>
  )
}
