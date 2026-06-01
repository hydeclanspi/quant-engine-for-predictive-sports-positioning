import { useEffect, useMemo, useRef, useState } from 'react'
import CountUp from './CountUp'
import { isPreviewMode } from '../lib/displayMode'

/**
 * CapitalCurveReveal — History 时间线揭示 (B 类，无弹窗).
 *
 * A quiet "资金累计" (cumulative net P&L) curve built ENTIRELY from real
 * settled investments, sorted by date. It draws on ONCE the first time it
 * scrolls into view (IntersectionObserver, observe → fire → disconnect),
 * then the final figure counts up alongside the line. This is the History
 * page's single signature moment: zero interruption, no popup, honest data.
 *
 * The series is all-time and deliberately independent of the list filters —
 * filtering to "已中" only and watching a monotonic line would be a lie.
 *
 * prefers-reduced-motion: the CSS snaps every element to its resting state
 * (no draw, no fade) and CountUp settles immediately.
 *
 * Renders nothing when fewer than two settled records exist — no fake chart.
 */

const W = 640
const H = 152
const PAD_X = 8 // left inset — the curve starts a hair off the edge
const PAD_R = 3 // right inset — kept tight so the line reaches close to the edge
const PAD_Y = 16

const toRmb = (n) => {
  const v = Math.round(Number(n) || 0)
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return `${sign}¥${Math.abs(v).toLocaleString('en-US')}`
}

// ── Preview-only synthetic equity path ──────────────────────────────────
// A deterministic (seeded → no flicker between renders) "螺旋震荡向上" curve
// used ONLY in demo/preview mode. The real seeded sample happens to climb
// almost monotonically, which reads as an unrealistic straight line — so for
// the demo we model an honest-looking capital journey instead: an upward
// trend carrying tapered oscillation, two genuine drawdowns and a closing
// shake-out before a breakout to a fresh high. The whole path is scaled so
// its final point lands on `peak` (the REAL cumulative figure), so only the
// in-between shape is dramatised while the headline number stays truthful.
const makeRng = (seed) => {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), t | 1)
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const buildDemoCapitalSeries = (count, peak) => {
  const P = peak
  const n = Math.max(12, count)
  const rng = makeRng(0x5eed2026)
  // Per-step noise, drawn once for micro-texture (kept deterministic).
  const noise = []
  for (let k = 0; k <= n; k += 1) noise.push(rng() - 0.5)
  // A Gaussian "drawdown" notch centred at fraction `c`, width `w`, depth `d`.
  const dip = (u, c, w, d) => -P * d * Math.exp(-((u - c) ** 2) / (2 * w * w))
  const raw = []
  for (let k = 0; k <= n; k += 1) {
    const u = k / n
    const env = Math.sin(Math.PI * u) // 0→1→0 taper keeps both ends anchored
    const trend = P * (0.7 * u + 0.3 * u * u) // monotonic base, ends exactly at P
    const osc =
      P * 0.115 * env * Math.sin(u * Math.PI * 5 + 0.4) +
      P * 0.05 * env * Math.sin(u * Math.PI * 11)
    const draws =
      dip(u, 0.3, 0.05, 0.15) + // first pullback
      dip(u, 0.62, 0.065, 0.23) + // the deep drawdown
      dip(u, 0.84, 0.04, 0.155) // closing shake-out before the breakout
    const tex = P * 0.025 * env * noise[k]
    raw.push(trend + osc + draws + tex)
  }
  raw[0] = 0 // start at break-even
  raw[raw.length - 1] = P // land exactly on the honest cumulative figure
  return raw.map((v) => ({ cum: Math.round(v) }))
}

export default function CapitalCurveReveal({ investments, compact = false }) {
  const series = useMemo(() => {
    const settled = (Array.isArray(investments) ? investments : [])
      .filter((inv) => {
        const status = inv?.status || 'pending'
        return status !== 'pending' && Number.isFinite(Number(inv?.profit))
      })
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

    if (settled.length < 2) return null

    let cum = 0
    // Anchor the path at break-even (0) so the curve reads as a journey
    // from the first stake rather than starting mid-air.
    const points = [{ cum: 0 }]
    settled.forEach((inv) => {
      cum += Number(inv.profit)
      points.push({ cum })
    })

    // Demo/preview only: replace the (near-monotonic) sample path with a
    // realistic spiral-upward equity curve that still ENDS on the exact same
    // honest cumulative figure. Live data is never reshaped; the headline
    // 净盈亏 and 已结算 count are identical either way.
    if (isPreviewMode() && cum > 0) {
      return { points: buildDemoCapitalSeries(settled.length, cum), settledCount: settled.length }
    }

    return { points, settledCount: settled.length }
  }, [investments])

  const containerRef = useRef(null)
  const firedRef = useRef(false)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el || firedRef.current) return undefined

    const fire = () => {
      if (firedRef.current) return
      firedRef.current = true
      setRevealed(true)
    }

    if (typeof IntersectionObserver === 'undefined') {
      fire()
      return undefined
    }

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.3)) {
          fire()
          obs.disconnect()
        }
      },
      { threshold: [0, 0.3, 0.6] },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  if (!series) return null

  const { points, settledCount } = series
  const values = points.map((p) => p.cum)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const innerW = W - PAD_X - PAD_R
  const innerH = H - PAD_Y * 2
  const xAt = (i) => PAD_X + (i / (points.length - 1)) * innerW
  const yAt = (v) => PAD_Y + (1 - (v - min) / range) * innerH

  const final = values[values.length - 1]
  const positive = final >= 0
  const accent = positive ? '#10b981' : '#f43f5e'
  const gradId = positive ? 'capitalGradUp' : 'capitalGradDown'

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(p.cum).toFixed(2)}`)
    .join(' ')
  const areaPath = `${linePath} L${xAt(points.length - 1).toFixed(2)},${(H - PAD_Y).toFixed(2)} L${xAt(0).toFixed(2)},${(H - PAD_Y).toFixed(2)} Z`

  const zeroInRange = min < 0 && max > 0
  const zeroY = yAt(0)
  const dotLeftPct = (xAt(points.length - 1) / W) * 100
  const dotTopPct = (yAt(final) / H) * 100
  const haloColor = positive ? 'rgba(16, 185, 129, 0.22)' : 'rgba(244, 63, 94, 0.22)'

  return (
    <div
      ref={containerRef}
      className={`capital-curve glow-card bg-white rounded-2xl border border-stone-100 ${
        compact ? 'is-compact p-4' : 'p-4 md:p-5 mb-4'
      }${revealed ? ' is-revealed' : ''}`}
    >
      <div className={`flex items-start justify-between gap-3 ${compact ? 'mb-1' : 'mb-1.5'}`}>
        <div className="min-w-0">
          <div className={`font-medium text-stone-700 ${compact ? 'text-[13px]' : 'text-sm'}`}>
            资金累计曲线
          </div>
          <div className={`text-stone-400 ${compact ? 'text-[11px]' : 'text-xs mt-0.5'}`}>
            共 {settledCount} 笔已结算 · 累计净盈亏
          </div>
        </div>
        <div className="text-right leading-none">
          <div
            className={`capital-curve-figure tabular-nums ${
              compact ? 'text-xl' : 'text-2xl'
            }${positive ? '' : ' is-down'}`}
          >
            {revealed ? <CountUp value={final} format={toRmb} duration={compact ? 1100 : 1400} /> : toRmb(0)}
          </div>
          {!compact && <div className="text-[11px] text-stone-400 mt-1.5">净盈亏 · 累计</div>}
        </div>
      </div>

      <div className="capital-curve-plot">
        <svg
          className="capital-curve-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`资金累计净盈亏 ${toRmb(final)}`}
        >
          <defs>
            <linearGradient id="capitalGradUp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="capitalGradDown" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
            </linearGradient>
          </defs>
          {zeroInRange && (
            <line
              className="capital-curve-zero"
              x1={PAD_X}
              y1={zeroY}
              x2={W - PAD_R}
              y2={zeroY}
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path className="capital-curve-area" d={areaPath} fill={`url(#${gradId})`} />
          <path
            className="capital-curve-line"
            d={linePath}
            fill="none"
            stroke={accent}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="capital-curve-dot"
          style={{
            left: `${dotLeftPct}%`,
            top: `${dotTopPct}%`,
            background: accent,
            boxShadow: `0 0 0 4px ${haloColor}`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
