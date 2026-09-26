import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// 投前 · 两队 PK + 两队过往记录。
// 队名是焦点（主队暖玫瑰 / 客队冷天蓝，淡色玻璃），下面整块记录区不分栏线，
// 靠左右两半的背景色区分（左淡红 = 主队，右淡蓝 = 客队）。

const plainNote = (value) =>
  String(value ?? '')
    .replace(/\[\/?red\]|\[\/?blue\]/g, '')
    .replace(/\*\*/g, '')
    .replace(/(^|\s)\*([^*]+)\*(\s|$)/g, '$1$2$3')
    .replace(/\s+/g, ' ')
    .trim()

const resultChip = (row) => {
  if (row.isCorrect === true) return { text: '中', className: 'is-hit' }
  if (row.isCorrect === false) return { text: '未中', className: 'is-miss' }
  return { text: row.settled ? '已结算' : '待赛', className: 'is-pending' }
}

// 一条记录就是一行：[日期][主/客][对 对手][我的 Entry] odds X [结果 X] …… [中/没中]
// 投前/投后备注放在下面。完全相同的记录（同 Entry、同赔率、同结果、同备注）折成一条，
// 用 History 页同款的小圆钮 chevron 展开，看得到下面还压着几条。
const RecordRow = ({ row, foldCount = 0, foldOpen = false, onToggleFold = null, child = false, remarks = null }) => {
  const chip = resultChip(row)
  const predicted = row.predictedScore ? `${row.predictedScore.home}-${row.predictedScore.away}` : ''
  const actual = row.actualScore ? `${row.actualScore.home}-${row.actualScore.away}` : ''
  const note = remarks ? remarks.note : plainNote(row.note)
  const postNote = remarks ? remarks.postNote : plainNote(row.postNote)

  return (
    <li className={`pre-record${child ? ' is-child' : ''}`}>
      <div className="pre-record-main">
        <span className="pre-record-date">{row.dateLabel}</span>
        <span className={`pre-record-venue is-${row.venue}`}>{row.venue === 'home' ? '主' : '客'}</span>
        <span className="pre-record-opponent">对 {row.opponent || '--'}</span>
        {!child && (
          <>
            <span className="pre-record-entries">{row.entryText || '未记录 Entry'}</span>
            <span className="pre-record-odds">odds {row.oddsLabel}</span>
            {(row.resultText || actual) && (
              <span className="pre-record-actual">结果 {row.resultText || actual}</span>
            )}
            {predicted && <span className="pre-record-pred">预测 {predicted}</span>}
          </>
        )}
        {foldCount > 0 && (
          <button
            type="button"
            onClick={onToggleFold}
            aria-expanded={foldOpen}
            aria-label={foldOpen ? '收起相同记录' : `展开另外 ${foldCount} 条相同记录`}
            data-testid="pre-record-fold"
            className="pre-record-fold group"
          >
            <span className="pre-record-fold-count">×{foldCount + 1}</span>
            <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border border-stone-200 text-stone-400 transition-colors group-hover:text-stone-600">
              {foldOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </span>
          </button>
        )}
        <span className={`pre-record-chip ${chip.className}`}>{chip.text}</span>
      </div>
      {!child && note && (
        <p className="pre-record-note">
          <em>投前</em>
          <span>{note}</span>
        </p>
      )}
      {!child && postNote && (
        <p className="pre-record-note is-post">
          <em>投后</em>
          <span>{postNote}</span>
        </p>
      )}
    </li>
  )
}

const TeamPanel = ({ side, team, onTeamChange, onTeamFocus, onTeamBlur, suggestions, onPickSuggestion, hint, active }) => (
  <div className={`pre-hero-side pre-hero-side--${side}${active ? ' is-active' : ''}`}>
    <div className="pre-hero-head">
      <span className="pre-hero-chip">{side === 'home' ? '主队' : '客队'}</span>
      <span className="pre-hero-hint">{team ? hint : '输入球队名或缩写'}</span>
    </div>

    <div className="pre-hero-input-wrap">
      <input
        type="text"
        value={team}
        onChange={(event) => onTeamChange(side, event.target.value)}
        onFocus={() => onTeamFocus(side)}
        onBlur={() => setTimeout(() => onTeamBlur(side), 120)}
        placeholder={side === 'home' ? '主队' : '客队'}
        aria-label={side === 'home' ? '主队' : '客队'}
        className="pre-hero-input"
        data-testid={`pre-hero-input-${side}`}
      />
      {suggestions.length > 0 && (
        <div className="pre-hero-suggest" role="listbox">
          {suggestions.map((profile) => (
            <button
              key={`${side}-${profile.teamId}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPickSuggestion(side, profile.teamName)}
              className="pre-hero-suggest-item"
            >
              <span className="pre-hero-suggest-name">{profile.teamName}</span>
              <span className="pre-hero-suggest-meta">{profile.totalSamples} 场 · REP {profile.avgRep.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  </div>
)

export default function PreMatchHero({
  homeTeam = '',
  awayTeam = '',
  onTeamChange = () => {},
  onTeamFocus = () => {},
  onTeamBlur = () => {},
  onPickSuggestion = () => {},
  activeSide = null,
  suggestions = { home: [], away: [] },
  hintFor = () => null,
}) {
  return (
    <div className="pre-hero" data-testid="pre-match-hero">
      <TeamPanel
        side="home"
        team={homeTeam}
        onTeamChange={onTeamChange}
        onTeamFocus={onTeamFocus}
        onTeamBlur={onTeamBlur}
        suggestions={suggestions.home}
        onPickSuggestion={onPickSuggestion}
        hint={hintFor(homeTeam)}
        active={activeSide === 'home'}
      />
      <div className="pre-hero-vs" aria-hidden="true">
        <span>VS</span>
      </div>
      <TeamPanel
        side="away"
        team={awayTeam}
        onTeamChange={onTeamChange}
        onTeamFocus={onTeamFocus}
        onTeamBlur={onTeamBlur}
        suggestions={suggestions.away}
        onPickSuggestion={onPickSuggestion}
        hint={hintFor(awayTeam)}
        active={activeSide === 'away'}
      />
    </div>
  )
}

/**
 * 两队的过往记录：一整块，左半边淡红（主队）、右半边淡蓝（客队），
 * 中间没有分隔线——颜色本身就是分隔。
 */
// 「同一注」的判据：Entry、赔率、结果、中没中、预测比分。
const betSignature = (row) => [
  row.entryText,
  row.oddsLabel,
  row.resultText,
  row.isCorrect === null ? '' : String(row.isCorrect),
  row.predictedScore ? `${row.predictedScore.home}-${row.predictedScore.away}` : '',
].join('|')

// 备注的合并规矩：两边一模一样 → 并；有一边没写 → 也并；两边都写了但不一样 → 不并。
const remarksCompatible = (left, right) => {
  const pairs = [
    [left.note, right.note],
    [left.postNote, right.postNote],
  ]
  return pairs.every(([a, b]) => !a || !b || a === b)
}

const groupRecords = (rows) => {
  const groups = []
  ;(Array.isArray(rows) ? rows : []).forEach((row) => {
    const signature = betSignature(row)
    const note = plainNote(row.note)
    const postNote = plainNote(row.postNote)
    // 什么都没记的散条不折叠
    if (signature.replace(/\|/g, '').length === 0) {
      groups.push({ lead: row, rest: [], signature, note, postNote })
      return
    }
    const target = groups.find((group) => group.signature === signature && remarksCompatible(group, { note, postNote }))
    if (target) {
      target.rest.push(row)
      // 组里谁写了备注就露出来，别因为折叠把话吞了
      if (!target.note) target.note = note
      if (!target.postNote) target.postNote = postNote
      return
    }
    groups.push({ lead: row, rest: [], signature, note, postNote })
  })
  return groups
}

export function PreMatchRecords({ homeTeam = '', awayTeam = '', records = { home: [], away: [] } }) {
  const [foldOpen, setFoldOpen] = useState({})
  const sides = [
    { side: 'home', team: homeTeam, groups: groupRecords(records.home) },
    { side: 'away', team: awayTeam, groups: groupRecords(records.away) },
  ].map((side) => ({
    ...side,
    total: side.groups.reduce((count, group) => count + 1 + group.rest.length, 0),
  }))
  const toggleFold = (key) => setFoldOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  return (
    <div className="pre-dossier" data-testid="pre-match-records">
      {sides.map(({ side, team, groups, total }) => (
        <div key={side} className={`pre-dossier-side pre-dossier-side--${side}`} data-testid={`pre-dossier-${side}`}>
          <div className="pre-dossier-head">
            <span className="pre-dossier-team">{team || (side === 'home' ? '主队' : '客队')}</span>
            <span className="pre-dossier-count">
              {total > 0 ? `${total} 条过往` : '暂无记录'}
            </span>
          </div>
          <div className="pre-dossier-scroll">
            {groups.length > 0 ? (
              <ul className="pre-record-list">
                {groups.map(({ lead, rest, note, postNote }) => {
                  const key = `${side}-${lead.id}`
                  return (
                    <Fragment key={key}>
                      <RecordRow
                        row={lead}
                        remarks={{ note, postNote }}
                        foldCount={rest.length}
                        foldOpen={Boolean(foldOpen[key])}
                        onToggleFold={() => toggleFold(key)}
                      />
                      {Boolean(foldOpen[key]) && rest.map((row) => (
                        <RecordRow key={`${key}-${row.id}`} row={row} child />
                      ))}
                    </Fragment>
                  )
                })}
              </ul>
            ) : (
              <p className="pre-hero-empty">
                {team ? '这支队还没有历史记录' : '填上队名，这里会出现我在这支队上的过往'}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
