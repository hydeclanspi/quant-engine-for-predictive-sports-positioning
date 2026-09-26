import { CELL_MODE_LABELS, SCORE_GOAL_MAX, SCORE_GOAL_VALUES, expectedGoals } from '../lib/preMatchOpinion'

const percent = (value) => `${Math.round((Number.isFinite(value) ? value : 0) * 100)}%`

/**
 * 一侧的「我认为它会进几球」控件：
 * 上面一排是每个进球数的浓度（默认按区间正态分布，点一下加权 / 再点压低 / 第三下还原），
 * 下面一条滑轨的两个端点定义区间，拖动即可改。
 */
export default function PreScoreSlider({
  label,
  tone = 'home',
  weights = [],
  value,
  onChange,
  disabled = false,
  testId = 'pre-score-slider',
}) {
  const lo = Number.isFinite(value?.lo) ? value.lo : 0
  const hi = Number.isFinite(value?.hi) ? value.hi : 0
  const modes = value?.modes || {}
  const maxWeight = Math.max(...(weights.length ? weights : [0]), 1e-6)
  const mean = expectedGoals(weights)
  const spanLeft = `${(Math.min(lo, hi) / SCORE_GOAL_MAX) * 100}%`
  const spanRight = `${(1 - Math.max(lo, hi) / SCORE_GOAL_MAX) * 100}%`

  const moveLo = (next) => onChange({ ...value, lo: Math.min(next, hi), hi })
  const moveHi = (next) => onChange({ ...value, lo, hi: Math.max(next, lo) })
  const cycleCell = (goals) => {
    const current = modes[goals] || 'auto'
    const next = current === 'auto' ? 'boost' : current === 'boost' ? 'zero' : 'auto'
    onChange({ ...value, modes: { ...modes, [goals]: next } })
  }

  return (
    <div className={`pre-slider pre-slider--${tone}${disabled ? ' is-disabled' : ''}`} data-testid={testId}>
      <div className="pre-slider-head">
        <span className="pre-slider-name">{label}</span>
        <span className="pre-slider-range">
          区间 {Math.min(lo, hi)}–{Math.max(lo, hi)} 球
        </span>
        <span className="pre-slider-mean">期望 {mean.toFixed(2)}</span>
      </div>

      <div className="pre-slider-cells">
        {SCORE_GOAL_VALUES.map((goals) => {
          const mode = modes[goals] || 'auto'
          const weight = weights[goals] || 0
          return (
            <button
              key={goals}
              type="button"
              disabled={disabled}
              onClick={() => cycleCell(goals)}
              data-testid={`${testId}-cell-${goals}`}
              data-cell-mode={mode}
              title={`${goals} 球 · ${percent(weight)}（${CELL_MODE_LABELS[mode]}）· 点一下切换浓度`}
              className={`pre-cell pre-cell--${mode}${goals >= Math.min(lo, hi) && goals <= Math.max(lo, hi) ? ' is-in-window' : ''}`}
            >
              <span className="pre-cell-bar" style={{ height: `${Math.max(5, (weight / maxWeight) * 100)}%` }} />
              <span className="pre-cell-num">{goals}</span>
            </button>
          )
        })}
      </div>

      <div className="pre-slider-track">
        <span className="pre-track-rail" />
        <span className="pre-track-span" style={{ left: spanLeft, right: spanRight }} />
        <input
          type="range"
          className="pre-range pre-range--lo"
          min={0}
          max={SCORE_GOAL_MAX}
          step={1}
          value={lo}
          disabled={disabled}
          onChange={(event) => moveLo(Number.parseInt(event.target.value, 10))}
          aria-label={`${label} 进球区间下限`}
          data-testid={`${testId}-lower`}
        />
        <input
          type="range"
          className="pre-range pre-range--hi"
          min={0}
          max={SCORE_GOAL_MAX}
          step={1}
          value={hi}
          disabled={disabled}
          onChange={(event) => moveHi(Number.parseInt(event.target.value, 10))}
          aria-label={`${label} 进球区间上限`}
          data-testid={`${testId}-upper`}
        />
      </div>

      <div className="pre-slider-scale">
        {SCORE_GOAL_VALUES.map((goals) => (
          <span key={goals}>{goals}</span>
        ))}
      </div>
    </div>
  )
}
