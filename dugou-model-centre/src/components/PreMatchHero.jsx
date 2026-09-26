// 投前 · 两队 PK：主队（暖玫瑰）／客队（冷天蓝）两块 hero 面板，
// 下面各自留着「我在这支队上的过往」——投前登记、投后复盘、预测与结果，最新在前。
// 记录区即使空着也占位（卡片是液态玻璃，空白本身也是版面的一部分）。

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

const RecordRow = ({ row }) => {
  const chip = resultChip(row)
  const predicted = row.predictedScore ? `${row.predictedScore.home}-${row.predictedScore.away}` : ''
  const actual = row.actualScore ? `${row.actualScore.home}-${row.actualScore.away}` : ''
  const note = plainNote(row.note)
  const postNote = plainNote(row.postNote)

  return (
    <li className="pre-record">
      <div className="pre-record-head">
        <span className="pre-record-date">{row.dateLabel}</span>
        <span className="pre-record-match">
          <span className={`pre-record-venue is-${row.venue}`}>{row.venue === 'home' ? '主' : '客'}</span>
          对 {row.opponent || '--'}
        </span>
        <span className={`pre-record-chip ${chip.className}`}>{chip.text}</span>
      </div>
      <p className="pre-record-line">
        <span className="pre-record-entries">{row.entryText || '未记录 Entry'}</span>
        <span className="pre-record-odds">odds {row.oddsLabel}</span>
        {predicted && <span className="pre-record-pred">预测 {predicted}</span>}
      </p>
      {(row.resultText || actual) && (
        <p className="pre-record-line">
          <span className="pre-record-actual">结果 {row.resultText || actual}</span>
        </p>
      )}
      {note && (
        <p className="pre-record-note">
          <em>投前</em>
          <span>{note}</span>
        </p>
      )}
      {postNote && (
        <p className="pre-record-note is-post">
          <em>投后</em>
          <span>{postNote}</span>
        </p>
      )}
    </li>
  )
}

const SidePanel = ({ side, team, onTeamChange, onTeamFocus, onTeamBlur, suggestions, onPickSuggestion, hint, records, active }) => (
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

    <div className="pre-hero-records" data-testid={`pre-hero-records-${side}`}>
      {records.length > 0 ? (
        <ul className="pre-record-list">
          {records.map((row) => (
            <RecordRow key={row.id} row={row} />
          ))}
        </ul>
      ) : (
        <p className="pre-hero-empty">
          {team ? '这支队还没有历史记录' : '填上队名，这里会出现我在这支队上的过往'}
        </p>
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
  records = { home: [], away: [] },
}) {
  return (
    <div className="pre-hero" data-testid="pre-match-hero">
      <SidePanel
        side="home"
        team={homeTeam}
        onTeamChange={onTeamChange}
        onTeamFocus={onTeamFocus}
        onTeamBlur={onTeamBlur}
        suggestions={suggestions.home}
        onPickSuggestion={onPickSuggestion}
        hint={hintFor(homeTeam)}
        records={records.home}
        active={activeSide === 'home'}
      />
      <div className="pre-hero-vs" aria-hidden="true">
        <span>VS</span>
      </div>
      <SidePanel
        side="away"
        team={awayTeam}
        onTeamChange={onTeamChange}
        onTeamFocus={onTeamFocus}
        onTeamBlur={onTeamBlur}
        suggestions={suggestions.away}
        onPickSuggestion={onPickSuggestion}
        hint={hintFor(awayTeam)}
        records={records.away}
        active={activeSide === 'away'}
      />
    </div>
  )
}
