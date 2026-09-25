import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Minus, Plus } from 'lucide-react'
import {
  DEFAULT_LAMBDA_PRIOR,
  deriveMarketProbabilities,
  deriveScoreDistribution,
  fitMarketLambdas,
  pointForecastToLambda,
} from '../lib/readQuality'

const MAX_GOALS = 8
const GOALS = Array.from({ length: MAX_GOALS + 1 }, (_, i) => i)
const DEFAULT_POINT = { home: 2, away: 1 }

const pct = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--')
const signedPp = (value) => (Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp` : '--')
const parseOdds = (value) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 1 ? parsed : Number.NaN
}

const GoalStepper = ({ label, value, onChange, testId }) => (
  <div className="flex items-center gap-2" data-testid={testId}>
    <span className="text-xs text-stone-400 w-10">{label}</span>
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
      <span className="w-5 text-center text-sm font-semibold text-stone-800 tabular-nums">{value}</span>
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

const OddsInput = ({ label, value, onChange, testId }) => (
  <label className="flex items-center gap-1 text-[11px] text-stone-400">
    <span className="whitespace-nowrap">{label}</span>
    <input
      type="text"
      inputMode="decimal"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="1.00"
      data-testid={testId}
      className="w-12 rounded-lg border border-stone-200 bg-white/80 px-1.5 py-1 text-xs text-stone-700 tabular-nums focus:outline-none focus:border-emerald-400"
    />
  </label>
)

/**
 * 投前研判 · 比分网格（默认折叠）。
 * 我的观点：登记比分 → 与联赛先验混合 → 泊松铺成 9×9 网格 → 按盘口加总。
 * 机构市场：录入 1X2（必需）/ 大小球（可选）赔率 → 比例去水 → 拟合市场进球分布，与本方观点逐盘口对照。
 * detectedPoint：右侧 Entry 里写了比分时（例如「2-1」）自动展开并跟随计算。
 * 纯展示：不写入草稿、不影响生产概率。θ（个人进球偏差）需要结算样本，接入在下一轮。
 */
export default function PreMatchGridView({ detectedPoint = null }) {
  const initialDetected =
    Number.isFinite(detectedPoint?.home) && Number.isFinite(detectedPoint?.away) ? detectedPoint : null
  const [point, setPoint] = useState(() =>
    initialDetected ? { home: initialDetected.home, away: initialDetected.away } : DEFAULT_POINT)
  const [collapsed, setCollapsed] = useState(() => !initialDetected)
  const [gridSource, setGridSource] = useState('mine')
  const [marketOdds, setMarketOdds] = useState({ home: '', draw: '', away: '', over: '', under: '' })

  const detectedHome = detectedPoint?.home ?? null
  const detectedAway = detectedPoint?.away ?? null
  useEffect(() => {
    if (!Number.isFinite(detectedHome) || !Number.isFinite(detectedAway)) return
    setPoint({ home: detectedHome, away: detectedAway })
    setCollapsed(false)
  }, [detectedHome, detectedAway])

  const following = Number.isFinite(detectedHome) && point.home === detectedHome && point.away === detectedAway
  const lambda = useMemo(() => pointForecastToLambda(point), [point])
  const cells = useMemo(() => deriveScoreDistribution(lambda.home, lambda.away, MAX_GOALS), [lambda])
  const markets = useMemo(() => deriveMarketProbabilities(lambda.home, lambda.away, { maxGoals: MAX_GOALS }), [lambda])

  const marketInput = useMemo(() => {
    const oneXTwo = { home: parseOdds(marketOdds.home), draw: parseOdds(marketOdds.draw), away: parseOdds(marketOdds.away) }
    const hasOneXTwo = [oneXTwo.home, oneXTwo.draw, oneXTwo.away].every((value) => Number.isFinite(value))
    const over = parseOdds(marketOdds.over)
    const under = parseOdds(marketOdds.under)
    const totals = Number.isFinite(over) && Number.isFinite(under) ? [{ line: 2.5, over, under }] : []
    if (!hasOneXTwo && totals.length === 0) return null
    return { oneXTwo: hasOneXTwo ? oneXTwo : undefined, totals }
  }, [marketOdds])

  const marketFit = useMemo(() => (marketInput ? fitMarketLambdas(marketInput, { maxGoals: MAX_GOALS }) : null), [marketInput])
  const marketReady = Boolean(marketFit?.ready)
  const marketMarkets = useMemo(
    () => (marketReady ? deriveMarketProbabilities(marketFit.homeLambda, marketFit.awayLambda, { maxGoals: MAX_GOALS }) : null),
    [marketFit, marketReady],
  )
  const marketCells = useMemo(
    () => (marketReady ? deriveScoreDistribution(marketFit.homeLambda, marketFit.awayLambda, MAX_GOALS) : []),
    [marketFit, marketReady],
  )

  const activeCells = gridSource === 'market' && marketReady ? marketCells : cells
  const cellMap = useMemo(() => {
    const map = new Map()
    activeCells.forEach((cell) => map.set(`${cell.home}-${cell.away}`, cell.p))
    return map
  }, [activeCells])
  const maxP = useMemo(() => activeCells.reduce((max, cell) => Math.max(max, cell.p), 0), [activeCells])
  const showMarketGrid = gridSource === 'market' && marketReady

  const comparison = useMemo(() => {
    if (!marketReady || !marketMarkets) return []
    const rows = [
      { label: '主胜', mine: markets.oneXTwo.home, market: marketMarkets.oneXTwo.home, quoted: Boolean(marketInput?.oneXTwo) },
      { label: '平', mine: markets.oneXTwo.draw, market: marketMarkets.oneXTwo.draw, quoted: Boolean(marketInput?.oneXTwo) },
      { label: '客胜', mine: markets.oneXTwo.away, market: marketMarkets.oneXTwo.away, quoted: Boolean(marketInput?.oneXTwo) },
    ]
    const myOu = markets.totals.find((row) => row.line === 2.5)
    const marketOu = marketMarkets.totals.find((row) => row.line === 2.5)
    if (myOu && marketOu) {
      const quoted = Boolean(marketInput?.totals?.length)
      rows.push({ label: '大 2.5', mine: myOu.over, market: marketOu.over, quoted })
      rows.push({ label: '小 2.5', mine: myOu.under, market: marketOu.under, quoted })
    }
    return rows.map((row) => ({ ...row, delta: row.mine - row.market }))
  }, [marketInput, marketMarkets, marketReady, markets])

  const overUnder = markets.totals.find((row) => row.line === 2.5) || markets.totals[0]
  const handicap = markets.handicaps.find((row) => row.line === -1) || markets.handicaps[0]

  const cellStyle = (probability) => {
    const ratio = maxP > 0 ? probability / maxP : 0
    const alpha = 0.10 + ratio * 0.82
    return {
      // 清新淡绿（emerald-400）：低概率几乎透明，高概率一眼可见
      backgroundColor: `rgba(52, 211, 153, ${alpha.toFixed(3)})`,
      color: alpha > 0.45 ? '#064e3b' : '#57534e',
    }
  }

  return (
    <section className="border-t border-stone-100 px-4 py-3" data-testid="pre-match-grid">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 text-left"
      >
        <ChevronRight size={13} strokeWidth={2.2} className={`shrink-0 text-stone-400 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        <span className="text-sm font-semibold text-stone-800">投前研判 · 比分网格</span>
        {collapsed && (
          <span className="truncate text-[11px] text-stone-400">
            登记 {point.home}-{point.away} · 主胜 {pct(markets.oneXTwo.home)}
          </span>
        )}
        {following && <span className="ml-auto shrink-0 text-[10px] text-emerald-600">跟随右侧比分</span>}
      </button>

      {!collapsed && (
        <div data-testid="pre-match-grid-body">
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GoalStepper label="主队" value={point.home} onChange={(next) => setPoint((prev) => ({ ...prev, home: next }))} testId="pre-grid-home-stepper" />
              <GoalStepper label="客队" value={point.away} onChange={(next) => setPoint((prev) => ({ ...prev, away: next }))} testId="pre-grid-away-stepper" />
            </div>
            <span className="text-[10px] text-stone-400">先验 {(1 - 0.7).toFixed(1)}／0.7 混合</span>
          </div>

          <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2" data-testid="pre-grid-market-channel">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-[11px] font-medium text-stone-500">机构市场定价</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-stone-400">1X2</span>
                <OddsInput label="主" value={marketOdds.home} onChange={(next) => setMarketOdds((prev) => ({ ...prev, home: next }))} testId="pre-grid-odds-home" />
                <OddsInput label="平" value={marketOdds.draw} onChange={(next) => setMarketOdds((prev) => ({ ...prev, draw: next }))} testId="pre-grid-odds-draw" />
                <OddsInput label="客" value={marketOdds.away} onChange={(next) => setMarketOdds((prev) => ({ ...prev, away: next }))} testId="pre-grid-odds-away" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-stone-400">大小 2.5</span>
                <OddsInput label="大" value={marketOdds.over} onChange={(next) => setMarketOdds((prev) => ({ ...prev, over: next }))} testId="pre-grid-odds-over" />
                <OddsInput label="小" value={marketOdds.under} onChange={(next) => setMarketOdds((prev) => ({ ...prev, under: next }))} testId="pre-grid-odds-under" />
              </div>
              <button
                type="button"
                onClick={() => setMarketOdds({ home: '', draw: '', away: '', over: '', under: '' })}
                className="ml-auto text-[11px] text-stone-400 hover:text-stone-600"
              >
                清空
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-relaxed text-stone-400">
              {marketReady
                ? `已倒算市场进球分布：主 λ ${marketFit.homeLambda} · 客 λ ${marketFit.awayLambda} · 拟合误差 ${marketFit.sse}${marketFit.notes?.length ? ` · ${marketFit.notes.join('；')}` : ''}`
                : marketInput
                  ? '1X2 三个赔率（或大小球两边）给全后自动倒算市场分布。'
                  : '可选：填入机构赔率即可与市场价逐盘口对照（只填 1X2 也能倒算）。'}
            </p>
          </div>

          <div className="mt-3 flex items-center gap-1 rounded-lg border border-stone-200 bg-white/80 p-0.5">
            <button
              type="button"
              onClick={() => setGridSource('mine')}
              className={`rounded-md px-2 py-0.5 text-[11px] ${!showMarketGrid ? 'bg-stone-800 text-white' : 'text-stone-500 hover:text-stone-700'}`}
            >
              我的观点
            </button>
            <button
              type="button"
              onClick={() => marketReady && setGridSource('market')}
              disabled={!marketReady}
              className={`rounded-md px-2 py-0.5 text-[11px] ${showMarketGrid ? 'bg-stone-800 text-white' : marketReady ? 'text-stone-500 hover:text-stone-700' : 'text-stone-300'}`}
            >
              机构市场
            </button>
            <span className="ml-auto pr-1 text-[10px] text-stone-400">
              {showMarketGrid ? `市场 λ ${marketFit.homeLambda} / ${marketFit.awayLambda}` : '横向 = 客队进球'}
            </span>
          </div>

          <div className="mt-2 flex">
            <div className="mr-1 flex flex-col justify-end gap-[2px] pb-[18px] text-[10px] leading-none text-stone-400">
              {GOALS.map((home) => (
                <span key={home} className="flex h-6 items-center justify-end pr-1 tabular-nums">{home}</span>
              ))}
            </div>
            <div>
              <div className="mb-1 grid grid-cols-9 gap-[2px] text-[10px] text-stone-400">
                {GOALS.map((away) => (
                  <span key={away} className="w-6 text-center tabular-nums">{away}</span>
                ))}
              </div>
              <div className="grid grid-cols-9 gap-[2px]" role="grid" aria-label="比分概率网格">
                {GOALS.map((home) =>
                  GOALS.map((away) => {
                    const probability = cellMap.get(`${home}-${away}`) ?? 0
                    const isRegistered = !showMarketGrid && home === point.home && away === point.away
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
          <p className="mt-1 text-[10px] text-stone-400">
            ↑ 主队进球 · 数字为该比分概率（%）{showMarketGrid ? ' · 当前为机构赔率倒算的市场分布' : ' · 深框是你登记的比分'}
          </p>

          <div className="mt-3 space-y-2.5">
            {comparison.length > 0 ? (
              <div>
                <p className="text-[11px] text-stone-400">我的观点 vs 机构市场</p>
                <table className="mt-1 w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-stone-400">
                      <th className="py-0.5 text-left font-normal">盘口</th>
                      <th className="py-0.5 text-right font-normal">我</th>
                      <th className="py-0.5 text-right font-normal">市场</th>
                      <th className="py-0.5 text-right font-normal">差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((row) => (
                      <tr key={row.label} className="border-t border-stone-100">
                        <td className="py-1 text-stone-600">
                          {row.label}
                          {!row.quoted && <span className="ml-1 text-[9px] text-stone-300">推算</span>}
                        </td>
                        <td className="py-1 text-right tabular-nums text-stone-700">{pct(row.mine)}</td>
                        <td className="py-1 text-right tabular-nums text-stone-500">{pct(row.market)}</td>
                        <td className={`py-1 text-right font-medium tabular-nums ${row.delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signedPp(row.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] text-stone-400">差 = 我的观点 − 市场；标「推算」的是市场分布的推算值，不是你录入的报价。</p>
              </div>
            ) : (
              <>
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
              </>
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
              <p className="text-[11px] text-stone-400">最可能比分{showMarketGrid ? '（市场）' : ''}</p>
              <p className="text-xs text-stone-600">
                {(showMarketGrid ? marketMarkets.topScores : markets.topScores).slice(0, 3).map((row) => `${row.score} ${pct(row.p)}`).join(' · ')}
              </p>
            </div>
            <p className="text-[10px] leading-relaxed text-stone-400">
              我的观点由登记比分推出（先验 主 {DEFAULT_LAMBDA_PRIOR.home} / 客 {DEFAULT_LAMBDA_PRIOR.away}）；机构市场由你录入的赔率去水倒算，两者共用同一套泊松引擎。
              个人进球偏差 θ 需要结算样本，接入在下一轮。此面板只做研判，不写入草稿、不影响生产概率。
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
