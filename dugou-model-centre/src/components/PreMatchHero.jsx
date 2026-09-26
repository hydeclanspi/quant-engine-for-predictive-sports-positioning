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
        {(row.resultText || actual) && <span className="pre-record-actual">结果 {row.resultText || actual}</span>}
      </p>
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
export function PreMatchRecords({ homeTeam = '', awayTeam = '', records = { home: [], away: [] } }) {
  const sides = [
    { side: 'home', team: homeTeam, rows: records.home || [] },
    { side: 'away', team: awayTeam, rows: records.away || [] },
  ]
  return (
    <div className="pre-dossier" data-testid="pre-match-records">
      {sides.map(({ side, team, rows }) => (
        <div key={side} className={`pre-dossier-side pre-dossier-side--${side}`} data-testid={`pre-dossier-${side}`}>
          <div className="pre-dossier-head">
            <span className="pre-dossier-team">{team || (side === 'home' ? '主队' : '客队')}</span>
            <span className="pre-dossier-count">
              {rows.length > 0 ? `${rows.length} 条过往` : '暂无记录'}
            </span>
          </div>
          <div className="pre-dossier-scroll">
            {rows.length > 0 ? (
              <ul className="pre-record-list">
                {rows.map((row) => (
                  <RecordRow key={`${side}-${row.id}`} row={row} />
                ))}
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
