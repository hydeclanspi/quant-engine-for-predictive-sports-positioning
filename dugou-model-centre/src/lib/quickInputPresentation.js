const ratio = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? (number / 100).toFixed(2) : '0.50'
}

const displayText = (value, fallback = '待补充') => {
  const text = String(value ?? '').trim()
  return text || fallback
}

/** Human-readable structured receipt shown inside the original Quick Input box. */
export const formatStructuredQuickInput = (result) => {
  const matches = Array.isArray(result?.matches) ? result.matches.slice(0, 5) : []
  if (matches.length === 0) return ''

  const header = matches.length > 1 ? `${matches.length} 场串关` : '单场'
  const lines = [`解析完成 · ${header}`]
  if (result?.comboName) lines.push(`标题｜${displayText(result.comboName)}`)
  if (Number(result?.actualInput) > 0) lines.push(`投入｜¥${Number(result.actualInput)}`)

  matches.forEach((match, index) => {
    const entries = (Array.isArray(match?.entries) ? match.entries : [])
      .filter((entry) => entry?.name || entry?.odds)
      .map((entry) => `${displayText(entry?.name)}${entry?.odds ? ` @ ${entry.odds}` : ' @ 待补充'}`)
      .join('；') || '待补充'
    lines.push('')
    lines.push(`${index + 1}｜${displayText(match?.homeTeam)} vs ${displayText(match?.awayTeam)}`)
    lines.push(`投注｜${entries}`)
    lines.push(`Conf ${ratio(match?.conf)} · Mode ${displayText(match?.mode, '常规')}`)
    lines.push(`TYS ${displayText(match?.tys_home, 'M')}/${displayText(match?.tys_away, 'M')} · FID ${displayText(match?.fid, '0.4')} · FSE ${ratio(match?.fse_home)}/${ratio(match?.fse_away)}`)
    if (String(match?.note || '').trim()) lines.push(`备注｜${String(match.note).trim().slice(0, 120)}`)
  })

  return lines.join('\n')
}
