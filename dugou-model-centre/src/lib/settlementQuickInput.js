const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '')
const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const evaluateEntry = (entryText, homeScore, awayScore) => {
  const entries = String(entryText || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
  if (entries.length === 0) return null
  const outcomes = entries.map((entry) => {
    const score = entry.match(/^(\d+)\s*(?:-|:|：)\s*(\d+)$/)
    if (score) return homeScore === Number(score[1]) && awayScore === Number(score[2])
    const handicap = entry.match(/^([+-]\d+(?:\.\d+)?)\s*(win|draw|lose)$/)
    const adjustedHome = handicap ? homeScore + Number(handicap[1]) : homeScore
    const outcome = handicap?.[2] || entry
    if (['win', '胜', '主胜', 'w'].includes(outcome)) return adjustedHome > awayScore
    if (['draw', '平', '平局', 'd'].includes(outcome)) return adjustedHome === awayScore
    if (['lose', 'loss', '负', '客胜', 'l'].includes(outcome)) return adjustedHome < awayScore
    return null
  })
  if (outcomes.some((outcome) => outcome === true)) return true
  if (outcomes.every((outcome) => outcome === false)) return false
  return null
}

const parseResultScore = (value) => {
  const result = String(value || '').match(/(?:^|[^\d.])(\d{1,2})\s*(?:-|:|：)\s*(\d{1,2})(?![\d.])/)
  return result ? { home: Number(result[1]), away: Number(result[2]) } : null
}

/** Infer a hit only when the saved prediction and actual score are deterministic. */
export const inferIsCorrectFromResult = (entryText, resultText) => {
  const score = parseResultScore(resultText)
  return score ? evaluateEntry(entryText, score.home, score.away) : null
}

const findScoreForMatch = (text, match) => {
  const home = escapeRegExp(match.homeTeam)
  const away = escapeRegExp(match.awayTeam)
  if (!home || !away) return null
  const compact = String(text || '').replace(/\s+/g, '')
  const patterns = [
    new RegExp(`${home}(\\d+)\\s*(?:-|:|：)\\s*(\\d+)${away}`, 'i'),
    new RegExp(`${home}(?:vs|v|VS)?${away}[^\\d]{0,8}(\\d+)\\s*(?:-|:|：)\\s*(\\d+)`, 'i'),
  ]
  for (const pattern of patterns) {
    const matchResult = compact.match(pattern)
    if (matchResult) return { home: Number(matchResult[1]), away: Number(matchResult[2]) }
  }
  return null
}

/** Browser-only fallback used in preview mode or when the provider is unavailable. */
export const parseSettlementLocally = (rawText, pendingCombos) => {
  const text = String(rawText || '').trim()
  const numbered = [...text.matchAll(/(?:^|\n)\s*(\d+)[.、]\s*([\s\S]*?)(?=(?:\n\s*\d+[.、])|$)/g)]
  const groups = numbered.length > 0
    ? numbered.map((match) => ({ ordinal: Number(match[1]), text: match[2].trim() }))
    : [{ ordinal: 1, text }]
  const warnings = []
  const settlements = groups.map((group) => {
    const combo = pendingCombos[group.ordinal - 1] || pendingCombos.find((candidate) =>
      candidate.matches.some((match) => group.text.includes(match.homeTeam) || group.text.includes(match.awayTeam)))
    if (!combo) {
      warnings.push(`第 ${group.ordinal} 组文本未匹配到待结算记录`)
      return { pendingId: '', reference: `第 ${group.ordinal} 笔`, revenues: null, matches: [] }
    }
    const revenueMatch = group.text.match(/(?:收入|收益|返还|返还金额|revenue)\s*[:：]?\s*(\d+(?:\.\d+)?)/i)
    const ratingMatch = group.text.match(/(?:ajr|rating)\s*[:：]?\s*(0(?:\.\d+)?)/i)
    const repMatch = group.text.match(/(?:rep)\s*[:：]?\s*(\d+(?:\.\d+)?)/i)
    const postNoteMatch = group.text.match(/(?:备注|复盘)\s*[:：]?\s*([^\n]+)/i)
    const matches = combo.matches.flatMap((match, matchIndex) => {
      const score = findScoreForMatch(group.text, match)
      if (!score) return []
      return [{
        matchIndex,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        results: `${score.home}-${score.away}`,
        isCorrect: evaluateEntry(match.entry, score.home, score.away),
        matchRating: ratingMatch ? Number(ratingMatch[1]) : null,
        matchRep: repMatch ? Number(repMatch[1]) : null,
        postNote: postNoteMatch?.[1]?.trim() || '',
      }]
    })
    if (matches.length === 0) warnings.push(`${combo.date} 未识别到明确比分`)
    if (!revenueMatch) warnings.push(`${combo.date} 未提供收入`)
    return {
      pendingId: combo.id,
      reference: combo.comboName || combo.date,
      revenues: revenueMatch ? Number(revenueMatch[1]) : null,
      matches,
    }
  })
  return {
    ok: true,
    confidence: warnings.length === 0 ? 0.72 : 0.48,
    settlements,
    warnings,
    diagnostics: warnings.map((message) => ({ level: 'warning', message })),
  }
}

const parseColloquialHit = (text) => {
  const normalized = String(text || '').trim().toLowerCase()
  // Negative phrases must win because “没中/不中” also contain the positive
  // character 中.
  if (/(?:没中|未中|不中|错了?|输了?|挂了?|寄了?|败了?|\bno\b|\bmiss(?:ed)?\b|\bwrong\b|\blos(?:e|t|s)\b)/i.test(normalized)) return false
  if (/(?:命中|中了?|对了?|拿下|收米|\byes\b|\bhit\b|\bwon\b|\bwin\b)/i.test(normalized)) return true
  return null
}

/**
 * Small deterministic safety net for the per-match AI box. DeepSeek remains
 * the primary parser; this only covers obvious offline/demo phrases and the
 * documented lone-number → AJR rule.
 */
export const parseSingleMatchSettlementLocally = (rawText, combo) => {
  const text = String(rawText || '').trim()
  const match = combo?.matches?.[0]
  if (!text || !combo?.id || !match) {
    return { ok: false, confidence: 0, settlements: [], warnings: ['缺少可解析的单场上下文'], diagnostics: [{ level: 'warning', message: '缺少可解析的单场上下文' }] }
  }

  const scoreMatch = parseResultScore(text)
  const ratingMatch = text.match(/(?:ajr|rating|评分)\s*[:：=]?\s*(0(?:\.\d+)?)/i)
  const repMatch = text.match(/(?:rep|随机(?:事件)?参数)\s*[:：=]?\s*(\d+(?:\.\d+)?)/i)
  const postNoteMatch = text.match(/(?:备注|复盘|note)\s*[:：=]?\s*([^\n]+)/i)
  const textWithoutScores = text.replace(/\d{1,2}\s*(?:-|:|：)\s*\d{1,2}/g, ' ')
  const bareNumbers = [...textWithoutScores.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)?)(?![\d.])/g)]
    .map((item) => Number(item[1]))
    .filter(Number.isFinite)

  const parsedRating = ratingMatch ? Number(ratingMatch[1]) : null
  const parsedRep = repMatch ? Number(repMatch[1]) : null
  let matchRating = parsedRating !== null && parsedRating >= 0 && parsedRating <= 0.8 ? parsedRating : null
  const matchRep = parsedRep !== null && parsedRep >= 0 && parsedRep <= 1.8 ? parsedRep : null
  if (matchRating === null && matchRep === null && bareNumbers.length === 1 && bareNumbers[0] >= 0 && bareNumbers[0] <= 0.8) {
    matchRating = bareNumbers[0]
  }
  const score = scoreMatch
  const explicitHit = parseColloquialHit(text)
  if (explicitHit === true && matchRating === null) matchRating = 0.8
  const normalizedRep = matchRating !== null && matchRep === null ? 0 : matchRep
  const isCorrect = explicitHit !== null
    ? explicitHit
    : score ? evaluateEntry(match.entry, score.home, score.away) : null
  const results = score
    ? `${score.home}-${score.away}`
    : explicitHit === true ? String(match.entry || '') : ''
  const postNote = postNoteMatch?.[1]?.trim() || ''
  const hasPayload = results || isCorrect !== null || matchRating !== null || normalizedRep !== null || postNote
  const warnings = []
  if (parsedRating !== null && matchRating === null) warnings.push('AJR 需在 0–0.8 之间')
  if (parsedRep !== null && matchRep === null) warnings.push('REP 需在 0–1.8 之间')
  if (!hasPayload) warnings.push('没有识别到可填入的结算信息')

  return {
    ok: true,
    confidence: hasPayload ? 0.72 : 0.2,
    settlements: [{
      pendingId: combo.id,
      reference: combo.comboName || combo.date || '',
      revenues: null,
      matches: [{
        matchIndex: 0,
        homeTeam: match.homeTeam || '',
        awayTeam: match.awayTeam || '',
        results,
        isCorrect,
        matchRating,
        matchRep: normalizedRep,
        postNote,
      }],
    }],
    warnings,
    diagnostics: warnings.map((message) => ({ level: 'warning', message })),
  }
}

const matchupScore = (parsedMatch, pendingMatch) => {
  const parsedHome = normalize(parsedMatch?.homeTeam)
  const parsedAway = normalize(parsedMatch?.awayTeam)
  const pendingHome = normalize(pendingMatch?.homeTeam)
  const pendingAway = normalize(pendingMatch?.awayTeam)
  if (parsedHome && parsedAway && parsedHome === pendingHome && parsedAway === pendingAway) return 6
  let score = 0
  if (parsedHome && (parsedHome === pendingHome || pendingHome.includes(parsedHome) || parsedHome.includes(pendingHome))) score += 2
  if (parsedAway && (parsedAway === pendingAway || pendingAway.includes(parsedAway) || parsedAway.includes(pendingAway))) score += 2
  return score
}

const findCombo = (row, pendingCombos, claimedIds) => {
  const byId = pendingCombos.find((combo) => combo.id === row.pendingId && !claimedIds.has(combo.id))
  const hasTeamIdentity = row.matches.some((match) => normalize(match.homeTeam) || normalize(match.awayTeam))
  const idMatchesTeams = !hasTeamIdentity || row.matches.some((parsedMatch) =>
    byId?.matches.some((pendingMatch) => matchupScore(parsedMatch, pendingMatch) > 0))
  if (byId && idMatchesTeams) return byId

  const reference = normalize(row.reference)
  const candidates = pendingCombos
    .filter((combo) => !claimedIds.has(combo.id))
    .map((combo) => {
      let score = 0
      if (reference) {
        if (normalize(combo.comboName) && reference.includes(normalize(combo.comboName))) score += 8
        if (normalize(combo.date) && reference.includes(normalize(combo.date))) score += 2
      }
      row.matches.forEach((parsedMatch) => {
        score += Math.max(0, ...combo.matches.map((pendingMatch) => matchupScore(parsedMatch, pendingMatch)))
      })
      return { combo, score }
    })
    .sort((a, b) => b.score - a.score)
  if (!candidates[0] || candidates[0].score <= 0) return null
  if (candidates[1]?.score === candidates[0].score) return null
  return candidates[0].combo
}

const findMatchIndex = (parsedMatch, combo, claimedIndices) => {
  const hasTeamIdentity = normalize(parsedMatch.homeTeam) || normalize(parsedMatch.awayTeam)
  if (
    Number.isInteger(parsedMatch.matchIndex) &&
    combo.matches[parsedMatch.matchIndex] &&
    !claimedIndices.has(parsedMatch.matchIndex) &&
    (!hasTeamIdentity || matchupScore(parsedMatch, combo.matches[parsedMatch.matchIndex]) > 0)
  ) return parsedMatch.matchIndex

  const candidates = combo.matches
    .map((match, index) => ({ index, score: claimedIndices.has(index) ? -1 : matchupScore(parsedMatch, match) }))
    .sort((a, b) => b.score - a.score)
  if (!candidates[0] || candidates[0].score <= 0) return null
  if (candidates[1]?.score === candidates[0].score) return null
  return candidates[0].index
}

export const resolveAiSettlementParse = (result, pendingCombos) => {
  const claimedIds = new Set()
  const resolved = []
  const diagnostics = [...(result?.diagnostics || [])]

  ;(result?.settlements || []).forEach((row, rowIndex) => {
    const combo = findCombo(row, pendingCombos, claimedIds)
    if (!combo) {
      diagnostics.push({ level: 'warning', message: `第 ${rowIndex + 1} 条结算未能唯一匹配待结算记录。` })
      return
    }
    claimedIds.add(combo.id)
    const claimedIndices = new Set()
    const matchPatches = []
    row.matches.forEach((parsedMatch) => {
      const matchIndex = findMatchIndex(parsedMatch, combo, claimedIndices)
      if (matchIndex === null) {
        diagnostics.push({ level: 'warning', message: `${combo.date} 的一场比赛未能唯一匹配。` })
        return
      }
      claimedIndices.add(matchIndex)
      const pendingMatch = combo.matches[matchIndex]
      const inferredHit = inferIsCorrectFromResult(pendingMatch?.entry, parsedMatch.results)
      matchPatches.push({
        ...parsedMatch,
        matchIndex,
        results: parsedMatch.results || (parsedMatch.isCorrect === true ? String(pendingMatch?.entry || '') : ''),
        isCorrect: parsedMatch.isCorrect === null || parsedMatch.isCorrect === undefined
          ? inferredHit
          : parsedMatch.isCorrect,
      })
    })
    resolved.push({
      comboId: combo.id,
      revenues: row.revenues,
      matchPatches,
      reference: row.reference,
    })
  })

  return { ...result, resolved, diagnostics }
}

export const formatStructuredSettlementInput = (result, pendingCombos) => {
  if (!result?.resolved?.length) return ''
  const comboMap = new Map(pendingCombos.map((combo) => [combo.id, combo]))
  const lines = [`解析完成 · 匹配 ${result.resolved.length} 笔待结算记录`]
  result.resolved.forEach((item, index) => {
    const combo = comboMap.get(item.comboId)
    lines.push('')
    lines.push(`${index + 1}｜${combo?.date || '--'} · ${combo?.comboName || (combo?.matches?.length > 1 ? `${combo.matches.length} 场串关` : '单场')}`)
    lines.push(`收入｜${item.revenues === null ? '待补充' : `¥${item.revenues}`}`)
    item.matchPatches.forEach((patch) => {
      const match = combo?.matches?.[patch.matchIndex]
      const hit = patch.isCorrect === true ? '命中' : patch.isCorrect === false ? '未中' : '待确认'
      lines.push(`${index + 1}.${patch.matchIndex + 1}｜${match?.homeTeam || patch.homeTeam || '-'} vs ${match?.awayTeam || patch.awayTeam || '-'} · ${patch.results || '赛果待补'} · ${hit}`)
      if (patch.matchRating !== null || patch.matchRep !== null) {
        lines.push(`AJR ${patch.matchRating ?? '待补'} · REP ${patch.matchRep ?? '待补'}`)
      }
      if (patch.postNote) lines.push(`备注｜${patch.postNote}`)
    })
  })
  return lines.join('\n')
}
