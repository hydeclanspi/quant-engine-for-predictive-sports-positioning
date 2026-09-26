import { useEffect, useMemo, useRef, useState } from 'react'

const CELL = 30
const PAD = 16

/**
 * 比分分布「云图」——把 (MAX_GOALS+1)² 的泊松概率当连续密度场来画：
 * 每个比分格是一团高斯云，概率越高云越黑越大，灰度驱动、软边界、无表格线。
 * 主队进球纵向向下、客队进球横向向右。悬停读某个比分。
 * 只在投前网格内部使用，不参与任何计算。
 */
export default function PreMatchCloud({ cells, registeredPoint = null, marketMode = false, maxGoals = 8 }) {
  const canvasRef = useRef(null)
  const [hover, setHover] = useState(null)
  const size = (maxGoals + 1) * CELL + PAD * 2
  const maxP = useMemo(() => (Array.isArray(cells) ? cells.reduce((max, cell) => Math.max(max, cell.p), 0) : 0), [cells])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    if (typeof ctx.filter === 'string') ctx.filter = 'blur(1.2px)'

    ;(Array.isArray(cells) ? cells : []).forEach((cell) => {
      if (!(cell.p > 0)) return
      const x = PAD + (cell.away + 0.5) * CELL
      const y = PAD + (cell.home + 0.5) * CELL
      const t = maxP > 0 ? cell.p / maxP : 0
      const intensity = Math.pow(t, 0.55)
      const radius = CELL * (1.25 + intensity * 1.4)
      const alpha = 0.05 + intensity * 0.5
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, `rgba(24, 24, 24, ${alpha.toFixed(3)})`)
      gradient.addColorStop(0.55, `rgba(24, 24, 24, ${(alpha * 0.45).toFixed(3)})`)
      gradient.addColorStop(1, 'rgba(24, 24, 24, 0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()
    })

    if (typeof ctx.filter === 'string') ctx.filter = 'none'
    if (registeredPoint) {
      const x = PAD + (registeredPoint.away + 0.5) * CELL
      const y = PAD + (registeredPoint.home + 0.5) * CELL
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.strokeStyle = marketMode ? '#475569' : '#065f46'
      ctx.lineWidth = 1.6
      ctx.stroke()
    }
  }, [cells, maxP, registeredPoint, marketMode, size])

  const handleMove = (event) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const away = Math.floor((event.clientX - rect.left - PAD) / CELL)
    const home = Math.floor((event.clientY - rect.top - PAD) / CELL)
    if (home >= 0 && home <= maxGoals && away >= 0 && away <= maxGoals) {
      const cell = cells?.find((row) => row.home === home && row.away === away)
      setHover({ home, away, p: cell?.p ?? 0 })
    } else {
      setHover(null)
    }
  }

  const axis = Array.from({ length: maxGoals + 1 }, (_, i) => i)

  return (
    <div className="inline-block select-none" data-testid="pre-match-cloud">
      <div className="flex">
        <div style={{ width: PAD + 6 }} />
        <div className="flex text-[10px] leading-none text-stone-400">
          {axis.map((away) => (
            <span key={away} className="text-center tabular-nums" style={{ width: CELL }}>{away}</span>
          ))}
        </div>
      </div>
      <div className="flex">
        <div className="flex flex-col justify-between py-2 pr-1 text-[10px] leading-none text-stone-400" style={{ width: PAD + 6, height: (maxGoals + 1) * CELL }}>
          {axis.map((home) => (
            <span key={home} className="tabular-nums">{home}</span>
          ))}
        </div>
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size, borderRadius: 14, display: 'block' }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        />
      </div>
      <p className="mt-1 h-4 text-[10px] text-stone-400">
        {hover ? `${hover.home}-${hover.away} · ${(hover.p * 100).toFixed(1)}%` : '越黑 = 概率越高 · 悬停读比分'}
      </p>
    </div>
  )
}
