/**
 * KellyModeCard — one Mode's recommended Kelly divisor, as a refined
 * risk/reward mini-card (replaces the old flat 三宫格文字盒子).
 *
 * Each card carries a colored identity dot, a hero 建议分母 number, the ROI it
 * earned, and a banded 回撤「风险计」bar — width ∝ that mode's max drawdown
 * relative to the busiest one in the set, tinted green / amber / rose by
 * severity so the six strategies read as a comparable spread at a glance
 * (short green = steady, long rose = wild). MC run-count stays visible so the
 * low-sample caveat (e.g. MC 2) is never hidden.
 *
 * Honest by construction: nothing here is invented — divisor / roi / drawdown /
 * runs come straight from the Monte-Carlo backtest; the bar is just a scaled
 * view of the real drawdown. Hover gives a gentle lift; that's the only motion.
 */

// Multicolor identity, cycled by position — 灵气多彩 without inventing meaning.
const ACCENTS = [
  { dot: '#10b981', soft: 'rgba(16, 185, 129, 0.16)' }, // emerald
  { dot: '#6366f1', soft: 'rgba(99, 102, 241, 0.16)' }, // indigo
  { dot: '#f59e0b', soft: 'rgba(245, 158, 11, 0.16)' }, // amber
  { dot: '#8b5cf6', soft: 'rgba(139, 92, 246, 0.16)' }, // violet
  { dot: '#0ea5e9', soft: 'rgba(14, 165, 233, 0.16)' }, // sky
  { dot: '#f43f5e', soft: 'rgba(244, 63, 94, 0.16)' }, // rose
]

const riskColorOf = (dd) => (dd <= 8 ? '#10b981' : dd <= 12 ? '#f59e0b' : '#f43f5e')

export default function KellyModeCard({ label, best, accentIndex = 0, maxDrawdown = 1, onApply }) {
  const accent = ACCENTS[accentIndex % ACCENTS.length]
  const roi = Number(best?.roi)
  const dd = Number(best?.maxDrawdown)
  const hasRoi = best && Number.isFinite(roi)
  const hasDd = best && Number.isFinite(dd)
  const up = roi >= 0
  const fillPct = hasDd ? Math.min(Math.max((dd / (maxDrawdown || 1)) * 100, 6), 100) : 0

  return (
    <div
      className="kelly-mode-card"
      style={{ '--kelly-accent': accent.dot, '--kelly-accent-soft': accent.soft }}
    >
      <div className="kelly-mode-head">
        <span className="kelly-mode-name">
          <span className="kelly-mode-dot" aria-hidden="true" />
          {label}
        </span>
        <button className="kelly-mode-apply" onClick={onApply} disabled={!best}>
          应用
        </button>
      </div>

      <div className="kelly-mode-body">
        <span className="kelly-mode-divisor">
          <span className="kelly-mode-divisor-val">{best?.divisor ?? '--'}</span>
          <span className="kelly-mode-divisor-label">建议分母</span>
        </span>
        <span className={`kelly-mode-roi${up ? ' is-up' : ' is-down'}`}>
          <span className="kelly-mode-roi-val">
            {hasRoi ? `${up ? '+' : ''}${roi.toFixed(1)}%` : '--'}
          </span>
          <span className="kelly-mode-roi-label">ROI</span>
        </span>
      </div>

      <div className="kelly-mode-risk">
        <span className="kelly-mode-risk-track">
          <span
            className="kelly-mode-risk-fill"
            style={{ width: `${fillPct}%`, background: riskColorOf(dd) }}
          />
        </span>
        <span className="kelly-mode-risk-meta">
          <span>回撤 {hasDd ? `-${dd.toFixed(1)}%` : '--'}</span>
          <span className="kelly-mode-risk-mc">MC {best?.runs || 0}</span>
        </span>
      </div>
    </div>
  )
}
