/**
 * ConfidenceRing — a compact radial progress gauge whose arc sweeps from
 * empty to `value` (0–1) on mount, then holds. Change `runKey` to replay
 * the sweep (it remounts the progress arc).
 *
 * The sweep is CSS-driven (@keyframes on stroke-dashoffset) rather than
 * rAF-driven, so it still resolves correctly in throttled/background tabs.
 * The center is a free `children` slot — drop a <CountUp> there to roll
 * the number up alongside the arc.
 *
 * prefers-reduced-motion: the arc renders at its final value with no
 * sweep (see .confidence-ring-progress in index.css).
 *
 * Props:
 *   value       0–1 fill fraction (clamped)
 *   size        outer px diameter (default 72)
 *   stroke      arc thickness in px (default 7)
 *   color       progress stroke color (default indigo)
 *   trackColor  background track color
 *   durationMs  sweep duration (default 1100)
 *   runKey      change to replay the sweep
 *   children    centered content (e.g. a CountUp)
 */
export default function ConfidenceRing({
  value = 0,
  size = 72,
  stroke = 7,
  color = '#4f46e5',
  trackColor = '#e7e5e4',
  durationMs = 1100,
  runKey = 0,
  children,
}) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const targetOffset = circumference * (1 - clamped)
  const center = size / 2

  return (
    <div className="confidence-ring" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="confidence-ring-svg"
        aria-hidden="true"
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <circle
          key={runKey}
          className="confidence-ring-progress"
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{
            strokeDasharray: `${circumference}px`,
            animationDuration: `${durationMs}ms`,
            '--ring-circumference': `${circumference}px`,
            '--ring-target': `${targetOffset}px`,
          }}
        />
      </svg>
      <div className="confidence-ring-center">{children}</div>
    </div>
  )
}
