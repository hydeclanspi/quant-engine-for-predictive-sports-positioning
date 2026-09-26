import { useEffect, useMemo, useRef, useState } from 'react'

const CELL = 30
const PAD = 16

// 幻彩：柔和的粉彩色带（淡天蓝 → 薄荷 → 淡紫 → 樱粉 → 蜜桃），
// 色相沿着对角线走、再叠一点逐格涟漪，叠加用 multiply 让云与云交叠处自然加深。
// 概率只控制「浓度」（透明度/大小），不往黑里压——所以云永远是淡的。
const PALETTE = [
  [206, 230, 255],
  [214, 240, 234],
  [229, 224, 255],
  [255, 224, 239],
  [255, 232, 214],
]
const DEEP_TINT = [138, 160, 224]

const paletteAt = (t, intensity) => {
  const scaled = Math.max(0, Math.min(0.9999, t)) * (PALETTE.length - 1)
  const index = Math.floor(scaled)
  const frac = scaled - index
  const from = PALETTE[index]
  const to = PALETTE[Math.min(PALETTE.length - 1, index + 1)]
  const amount = 0.22 * intensity
  return from.map((value, channel) => {
    const mixed = value + (to[channel] - value) * frac
    return Math.round(mixed + (DEEP_TINT[channel] - mixed) * amount)
  })
}

const rgba = (rgb, alpha) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(3)})`

/**
 * 机构分布 → 等值线（marching squares）。
 * field 是 n×n 的标量场，返回该 level 下的线段列表 [{x1,y1,x2,y2}]。
 * 纯函数，单独可测；画布上再决定线型（机构用虚线）。
 */
export const buildContourSegments = (field, level, size) => {
  const n = Array.isArray(field) ? field.length : 0
  if (n < 2 || !Number.isFinite(level)) return []
  const step = size / (n - 1)
  const segments = []
  const at = (i, j) => field[j][i]
  const lerp = (a, b) => (b - a === 0 ? 0.5 : (level - a) / (b - a))

  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const v00 = at(i, j)
      const v10 = at(i + 1, j)
      const v01 = at(i, j + 1)
      const v11 = at(i + 1, j + 1)
      const code = (v00 > level ? 1 : 0) | (v10 > level ? 2 : 0) | (v11 > level ? 4 : 0) | (v01 > level ? 8 : 0)
      if (code === 0 || code === 15) continue
      const x0 = i * step
      const y0 = j * step
      const x1 = x0 + step
      const y1 = y0 + step
      const top = { x: x0 + lerp(v00, v10) * step, y: y0 }
      const right = { x: x1, y: y0 + lerp(v10, v11) * step }
      const bottom = { x: x0 + lerp(v01, v11) * step, y: y1 }
      const left = { x: x0, y: y0 + lerp(v00, v01) * step }
      const push = (a, b) => segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y })
      switch (code) {
        case 1: case 14: push(left, top); break
        case 2: case 13: push(top, right); break
        case 3: case 12: push(left, right); break
        case 4: case 11: push(right, bottom); break
        case 5: push(left, top); push(right, bottom); break
        case 6: case 9: push(top, bottom); break
        case 7: case 8: push(left, bottom); break
        case 10: push(left, bottom); push(top, right); break
        default: break
      }
    }
  }
  return segments
}

/**
 * 比分分布「云图」——(MAX_GOALS+1)² 的比分概率当连续密度场来画：
 * 每个比分格是一团高斯云，概率越高云越浓越大，软边界、无表格线。
 * 主队进球纵向向下、客队进球横向向右。机构分布用虚线等值线叠在同一张图上。
 * 只做展示，不参与任何计算。
 */
export default function PreMatchCloud({
  cells,
  marketCells = [],
  registeredPoint = null,
  maxGoals = 8,
}) {
  const canvasRef = useRef(null)
  const [hover, setHover] = useState(null)
  const size = (maxGoals + 1) * CELL + PAD * 2
  const maxP = useMemo(() => (Array.isArray(cells) ? cells.reduce((max, cell) => Math.max(max, cell.p), 0) : 0), [cells])
  const marketList = useMemo(
    () => (Array.isArray(marketCells) ? marketCells.filter((cell) => cell.p > 0) : []),
    [marketCells],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    ctx.globalCompositeOperation = 'multiply'
    if (typeof ctx.filter === 'string') ctx.filter = 'blur(1.7px)'

    const diagonal = maxGoals * 2 || 1
    const list = Array.isArray(cells) ? cells : []

    // 先铺一层更宽更淡的底云，再落主云：叠出来的边缘才像云，不像圆点。
    ;[2.1, 1].forEach((pass, passIndex) => {
      const isGlow = passIndex === 0
      list.forEach((cell) => {
        if (!(cell.p > 0)) return
        const x = PAD + (cell.away + 0.5) * CELL
        const y = PAD + (cell.home + 0.5) * CELL
        const t = maxP > 0 ? cell.p / maxP : 0
        const intensity = Math.pow(t, 0.4)
        const radius = CELL * (1.15 + intensity * 1.3) * pass
        const alpha = isGlow ? 0.03 + intensity * 0.07 : 0.09 + intensity * 0.23
        const position = (cell.home + cell.away) / diagonal
        const ripple = (((cell.home * 2 + cell.away * 3) % 5) / 4) * 0.42
        const color = paletteAt(Math.min(1, 0.1 + position * 0.55 + ripple), intensity)

        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, rgba(color, alpha))
        gradient.addColorStop(0.6, rgba(color, alpha * 0.42))
        gradient.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      })
    })

    ctx.globalCompositeOperation = 'source-over'
    if (typeof ctx.filter === 'string') ctx.filter = 'none'

    // 机构：虚线等值线（① 机构）。只在有市场报价时画。
    if (marketList.length > 0) {
      const N = 64
      const step = size / (N - 1)
      const sigma = CELL * 0.95
      const field = []
      for (let j = 0; j < N; j += 1) {
        const row = []
        for (let i = 0; i < N; i += 1) {
          const x = i * step
          const y = j * step
          let value = 0
          marketList.forEach((cell) => {
            const cx = PAD + (cell.away + 0.5) * CELL
            const cy = PAD + (cell.home + 0.5) * CELL
            const d2 = (x - cx) ** 2 + (y - cy) ** 2
            value += cell.p * Math.exp(-d2 / (2 * sigma * sigma))
          })
          row.push(value)
        }
        field.push(row)
      }
      const peak = field.reduce((max, row) => Math.max(max, ...row), 0)
      if (peak > 0) {
        ctx.save()
        ctx.setLineDash([4.5, 4])
        ctx.lineWidth = 1.1
        ;[0.24, 0.46, 0.7].forEach((ratio, levelIndex) => {
          ctx.globalAlpha = 0.8 - levelIndex * 0.16
          ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)'
          buildContourSegments(field, ratio * peak, size).forEach((segment) => {
            ctx.beginPath()
            ctx.moveTo(segment.x1, segment.y1)
            ctx.lineTo(segment.x2, segment.y2)
            ctx.stroke()
          })
        })
        ctx.restore()
      }
    }

    if (registeredPoint) {
      const x = PAD + (registeredPoint.away + 0.5) * CELL
      const y = PAD + (registeredPoint.home + 0.5) * CELL
      ctx.beginPath()
      ctx.arc(x, y, 5.4, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)'
      ctx.lineWidth = 2.6
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, 4.4, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(15, 118, 110, 0.78)'
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
  }, [cells, marketList, maxP, registeredPoint, size, maxGoals])

  const handleMove = (event) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const away = Math.floor((event.clientX - rect.left - PAD) / CELL)
    const home = Math.floor((event.clientY - rect.top - PAD) / CELL)
    if (home >= 0 && home <= maxGoals && away >= 0 && away <= maxGoals) {
      const mine = cells?.find((row) => row.home === home && row.away === away)?.p ?? 0
      const market = marketList.find((row) => row.home === home && row.away === away)?.p ?? null
      setHover({ home, away, mine, market })
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
          style={{ width: size, height: size, borderRadius: 16, display: 'block' }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        />
      </div>
      <p className="mt-1 h-4 text-[11px] text-stone-500">
        {hover
          ? `${hover.home}-${hover.away} · 我 ${(hover.mine * 100).toFixed(1)}%${hover.market === null ? '' : ` · 机构 ${(hover.market * 100).toFixed(1)}%`}`
          : '颜色越浓 = 我给的比分概率越高 · 悬停读某一格'}
      </p>
    </div>
  )
}
