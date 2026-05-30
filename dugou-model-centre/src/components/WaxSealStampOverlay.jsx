import { useEffect } from 'react'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

const getViewportFallback = () => ({
  x: typeof window !== 'undefined' ? Math.round(window.innerWidth * 0.5) : 0,
  y: typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.32) : 0,
})

export const getWaxSealStampPoint = (target) => {
  if (typeof window === 'undefined' || !target || typeof target.getBoundingClientRect !== 'function') {
    return getViewportFallback()
  }
  const rect = target.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  return {
    x: clamp(Math.round(x), 72, window.innerWidth - 72),
    y: clamp(Math.round(y), 90, window.innerHeight - 90),
  }
}

export default function WaxSealStampOverlay({ burst, onDone }) {
  const isWin = burst?.tone === 'win'
  // A win runs a touch longer so the spark ring + rising profit figure can
  // resolve before the layer unmounts.
  const ttl = isWin ? 1680 : 980

  useEffect(() => {
    if (!burst?.active) return undefined
    const timer = window.setTimeout(() => {
      onDone?.()
    }, ttl)
    return () => window.clearTimeout(timer)
  }, [burst?.active, burst?.token, onDone, ttl])

  if (!burst?.active) return null

  const style = {
    left: `${burst.x}px`,
    top: `${burst.y}px`,
  }
  const showProfit = isWin && Number.isFinite(burst.profit) && burst.profit > 0

  return (
    <div className="wax-seal-burst-layer" aria-hidden="true">
      <div key={burst.token} className={`wax-seal-burst-anchor${isWin ? ' is-win' : ''}`} style={style}>
        <div className="wax-seal-burst-ripple wax-seal-burst-ripple-1" />
        <div className="wax-seal-burst-ripple wax-seal-burst-ripple-2" />
        <div className="wax-seal-burst-impact-glow" />
        <div className="wax-seal-burst-shadow" />
        <div className="wax-seal-burst-seal">
          <div className="wax-seal-burst-ring-outer" />
          <div className="wax-seal-burst-ring-inner" />
          <span className="wax-seal-burst-hd">HD</span>
          <div className="wax-seal-burst-divider" />
          <span className="wax-seal-burst-cs">CS</span>
        </div>
        {isWin && (
          <div className="wax-seal-burst-sparks">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="wax-seal-burst-spark" style={{ '--spark-i': i }} />
            ))}
          </div>
        )}
        {showProfit && (
          <span className="wax-seal-burst-profit">+¥{Math.round(burst.profit)}</span>
        )}
      </div>
    </div>
  )
}
