import { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import {
  DEFAULT_LAMBDA_PRIOR,
  deriveMarketProbabilities,
  deriveScoreDistribution,
  pointForecastToLambda,
} from '../lib/readQuality'

const MAX_GOALS = 8
const GOALS = Array.from({ length: MAX_GOALS + 1 }, (_, i) => i)
const DEFAULT_POINT = { home: 2, away: 1 }

const pct = (value) => `${(value * 100).toFixed(1)}%`

const GoalStepper = ({ label, value, onChange, testId }) => (
  <div className="flex items-center gap-2" data-testid={testId}>
    <span className="text-xs text-stone-400 w-12">{label}</span>
    <div className="inline-flex items-center gap-1 rounded-xl border border-stone-200 bg-white/80 px-1 py-0.5">
      <button
        type="button"
        aria-label={`${label} 减一`}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="rounded-lg p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-40"
        disabled={value <= 0}
      >
        <Minus size={12} strokeWidth={2.4} />
      </button>
      <span className="w-6 text-center text-sm font-semibold text-stone-800 tabular-nums">{value}</span>
      <button
        type="button"
        aria-label={`${label} 加一`}
        onClick={() => onChange(Math.min(MAX_GOALS, value + 1))}
        className="rounded-lg p-1 text-stone-500 hover:bg-stone-100 disabled:opacity-40"
        disabled={value >= MAX_GOALS}
      >
        <Plus size={12} strokeWidth={2.4} />
      </button>
    </div>
  </div>
)

/**
 * 投前研判 · 比分网格。
 * 纯展示：把一个登记比分映射成进球分布，铺成 (MAX_GOALS+1)² 的比分网格，
 * 再按盘口加总出胜平负 / 大小球 / 让球概率。不写入草稿、不影响生产概率。
 * θ（个人进球偏差）需要结算样本支撑，接入放在下一轮。
 */
export default function PreMatchGridView() {
  const [point, setPoint] = useState(DEFAULT_POINT)

  const lambda = useMemo(() => pointForecastToLambda(point), [point])
  const cells = useMemo(() => deriveScoreDistribution(lambda.home, lambda.away, MAX_GOALS), [lambda])
  const markets = useMemo(() => deriveMarketProbabilities(lambda.home, lambda.away, { maxGoals: MAX_GOALS }), [lambda])

  const cellMap = useMemo(() => {
    const map = new Map()
    cells.forEach((cell) => map.set(`${cell.home}-${cell.away}`, cell.p))
    return map
  }, [cells])
  const maxP = useMemo(() => cells.reduce((max, cell) => Math.max(max, cell.p), 0), [cells])

  const overUnder = markets.totals.find((row) => row.line === 2.5) || markets.totals[0]
  const handicap = markets.handicaps.find((row) => row.line === -1) || markets.handicaps[0]

  const cellStyle = (probability) => {
    const ratio = maxP > 0 ? probability / maxP : 0
    const alpha = 0.06 + ratio * 0.82
    return {
      backgroundColor: `rgba(217, 119, 6, ${alpha.toFixed(3)})`,
      color: alpha > 0.55 ? '#fffbeb' : '#44403c',
    }
  }

  return (
    <section className="border-b border-stone-100 px-6 py-5" data-testid="pre-match-grid">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-800">投前研判 · 比分网格</h3>
          <p className="mt-0.5 text-xs text-stone-400">
            登记一个比分观点，看它在每个盘口上值多少 · 联赛先验混合 {(1 - 0.7).toFixed(1)}／{(0.7).toFixed(1)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <GoalStepper label="主队" value={point.home} onChange={(next) => setPoint((prev) => ({ ...prev, home: next }))} testId="pre-grid-home-stepper" />
          <GoalStepper label="客队" value={point.away} onChange={(next) => setPoint((prev) => ({ ...prev, away: next }))} testId="pre-grid-away-stepper" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-stone-400">
            <span className="w-8" />
            <span>客队进球 →</span>
          </div>
          <div className="flex">
            <div className="mr-1 flex flex-col justify-end gap-[2px] pb-[18px] text-[10px] leading-none text-stone-400">
              {GOALS.map((home) => (
                <span key={home} className="flex h-6 items-center justify-end pr-1 tabular-nums">{home}</span>
              ))}
            </div>
            <div>
              <div className="mb-1 grid grid-cols-9 gap-[2px] pl-0 text-[10px] text-stone-400">
                {GOALS.map((away) => (
                  <span key={away} className="w-6 text-center tabular-nums">{away}</span>
                ))}
              </div>
              <div className="grid grid-cols-9 gap-[2px]" role="grid" aria-label="比分概率网格">
                {GOALS.map((home) =>
                  GOALS.map((away) => {
                    const probability = cellMap.get(`${home}-${away}`) ?? 0
                    const isRegistered = home === point.home && away === point.away
                    return (
                      <div
                        key={`${home}-${away}`}
                        role="gridcell"
                        title={`${home}-${away} · ${pct(probability)}`}
                        data-testid={`pre-grid-cell-${home}-${away}`}
                        style={cellStyle(probability)}
                        className={`flex h-6 w-6 items-center justify-center rounded-[5px] text-[9px] tabular-nums ${
                          isRegistered ? 'ring-2 ring-stone-800 ring-offset-1' : ''
                        }`}
                      >
                        {probability >= 0.03 ? Math.round(probability * 100) : ''}
                      </div>
                    )
                  }),
                )}
              </div>
            </div>
          </div>
          <p className="mt-1 text-[10px] text-stone-400">↑ 主队进球 · 数字为该比分概率（%）· 深框是你登记的比分</p>
        </div>

        <div className="min-w-[240px] space-y-3">
          <div>
            <p className="text-[11px] text-stone-400">这个观点等价于</p>
            <div className="mt-1 grid grid-cols-3 gap-1.5 text-xs">
              {[
                { label: '主胜', value: markets.oneXTwo.home },
                { label: '平', value: markets.oneXTwo.draw },
                { label: '客胜', value: markets.oneXTwo.away },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-stone-200 bg-white/70 px-2 py-1.5 text-center">
                  <span className="block text-[10px] text-stone-400">{row.label}</span>
                  <span className="font-semibold text-stone-800 tabular-nums">{pct(row.value)}</span>
                </div>
              ))}
            </div>
          </div>
          {overUnder && (
            <div className="text-xs text-stone-600">
              大 {overUnder.line} <span className="font-semibold tabular-nums">{pct(overUnder.over)}</span>
              <span className="mx-1.5 text-stone-300">|</span>
              小 {overUnder.line} <span className="font-semibold tabular-nums">{pct(overUnder.under)}</span>
            </div>
          )}
          {handicap && (
            <div className="text-xs text-stone-600">
              让 {handicap.line}：主 <span className="font-semibold tabular-nums">{pct(handicap.win)}</span>
              <span className="mx-1.5 text-stone-300">|</span>
              走 <span className="font-semibold tabular-nums">{pct(handicap.push)}</span>
              <span className="mx-1.5 text-stone-300">|</span>
              客 <span className="font-semibold tabular-nums">{pct(handicap.lose)}</span>
            </div>
          )}
          <div>
            <p className="text-[11px] text-stone-400">最可能比分</p>
            <p className="text-xs text-stone-600">
              {markets.topScores.slice(0, 3).map((row) => `${row.score} ${pct(row.p)}`).join(' · ')}
            </p>
          </div>
          <p className="text-[10px] leading-relaxed text-stone-400">
            由登记比分推出的进球分布（先验 主 {DEFAULT_LAMBDA_PRIOR.home} / 客 {DEFAULT_LAMBDA_PRIOR.away}）；
            个人进球偏差 θ 需要结算样本，接入在下一轮。此面板只做研判，不写入草稿、不影响生产概率。
          </p>
        </div>
      </div>
    </section>
  )
}
