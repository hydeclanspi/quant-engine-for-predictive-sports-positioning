import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Loader2, Minus, Plus, RefreshCw } from 'lucide-react'
import {
  DEFAULT_LAMBDA_PRIOR,
  applyTeamBias,
  deriveMarketProbabilities,
  deriveMarketProbabilitiesForEntries,
  deriveScoreDistribution,
  fitMarketLambdas,
  pointForecastToLambda,
  probabilityForEntry,
} from '../lib/readQuality'
import { fetchOfficialMarketOdds, marketScorelineProbabilities } from '../lib/marketOdds'
import PreMatchCloud from './PreMatchCloud'

const MAX_GOALS = 8
const DEFAULT_POINT = { home: 2, away: 1 }

const OFFICIAL_ERROR_TEXT = {
  http_567: '官方接口拦截了本次请求（网络出口可能挂了代理），请手动填入',
  network_error: '网络不可达（可能是代理或断网），请手动填入',
  timeout: '拉取超时，请重试或手动填入',
  no_sellable_matches: '当前没有在售场次',
  unexpected_payload: '官方返回结构异常，请手动填入',
  fetch_unavailable: '当前环境不支持抓取，请手动填入',
}

const pct = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--')
const signedPp = (value) => (Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp` : '--')
const parseOdds = (value) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 1 ? parsed : Number.NaN
}
const movementMark = (movement) => (movement === 'down' ? '↓' : movement === 'up' ? '↑' : '')

const GoalStepper = ({ label, value, onChange, testId }) => (
  <div className="flex items-center gap-2" data-testid={testId}>
    <span className="w-10 text-xs text-stone-400">{label}</span>
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
      className="w-12 rounded-lg border border-stone-200 bg-white/80 px-1.5 py-1 text-xs text-stone-700 tabular-nums focus:border-emerald-400 focus:outline-none"
    />
  </label>
)

/**
 * 投前研判 · 比分网格（默认折叠）。
 * 我的观点：登记比分 → 与联赛先验混合 → 泊松铺成 9×9 网格 → 按盘口加总。
 * 机构市场：可手工填 1X2/大小球，也可一键拉取官方竞彩赔率（含比分盘）；
 *   比分盘单格 + 胜/平/负「其他」构成完整划分，去水后即为市场对比分的直接定价。
 * detectedPoint：右侧 Entry 里写了比分时自动展开并跟随计算。
 * 纯展示：不写入草稿、不影响生产概率。
 */
export default function PreMatchGridView({
  detectedPoint = null,
  biasModel = null,
  homeTeam = '',
  awayTeam = '',
  targetMatchIndex = 0,
  matchEntries = [],
  onOverrideChange = null,
}) {
  const initialDetected =
    Number.isFinite(detectedPoint?.home) && Number.isFinite(detectedPoint?.away) ? detectedPoint : null
  const [point, setPoint] = useState(() =>
    initialDetected ? { home: initialDetected.home, away: initialDetected.away } : DEFAULT_POINT)
  const [collapsed, setCollapsed] = useState(() => !initialDetected)
  const [gridSource, setGridSource] = useState('mine')
  const [marketOdds, setMarketOdds] = useState({ home: '', draw: '', away: '', over: '', under: '' })
  const [official, setOfficial] = useState({ status: 'idle', matches: [], error: '', pickedId: '', lastUpdateTime: '' })
  const [insist, setInsist] = useState(false)

  const detectedHome = detectedPoint?.home ?? null
  const detectedAway = detectedPoint?.away ?? null
  useEffect(() => {
    if (!Number.isFinite(detectedHome) || !Number.isFinite(detectedAway)) return
    setPoint({ home: detectedHome, away: detectedAway })
    setCollapsed(false)
  }, [detectedHome, detectedAway])

  const following = Number.isFinite(detectedHome) && point.home === detectedHome && point.away === detectedAway

  // 投前修正：我的登记 → 按「我在这支队上的历史偏差」修正成 expected actual。
  // 默认用修正后；「我坚持」时用原始输入。修正本身只做展示与这场仓位的输入，
  // 不写回任何草稿，也不影响其它任何计算。
  const correction = useMemo(
    () => applyTeamBias(point, { homeTeam, awayTeam, biasModel }),
    [point, homeTeam, awayTeam, biasModel],
  )
  const correctedPoint = useMemo(() => ({ home: correction.home, away: correction.away }), [correction])
  const effectivePoint = insist ? point : correctedPoint
  const lambda = useMemo(() => pointForecastToLambda(effectivePoint), [effectivePoint])
  const cells = useMemo(() => deriveScoreDistribution(lambda.home, lambda.away, MAX_GOALS), [lambda])
  const markets = useMemo(() => deriveMarketProbabilitiesForEntries(lambda.home, lambda.away, matchEntries, { maxGoals: MAX_GOALS }), [lambda, matchEntries])

  // 把这场 Entry 的概率回传给页面（供这场的仓位计算用）。
  const entryProbability = useMemo(() => {
    const first = Array.isArray(matchEntries) ? matchEntries[0] : null
    return first ? probabilityForEntry(first, { markets, cells }) : Number.NaN
  }, [markets, cells, matchEntries])
  const overrideRef = useRef(null)
  useEffect(() => {
    if (typeof onOverrideChange !== 'function') return
    const payload = {
      matchIndex: targetMatchIndex,
      probability: entryProbability,
      insist,
      point,
      correctedPoint,
      homeBias: correction.homeBias,
      awayBias: correction.awayBias,
    }
    const signature = JSON.stringify(payload)
    if (overrideRef.current === signature) return
    overrideRef.current = signature
    onOverrideChange(payload)
  }, [onOverrideChange, entryProbability, insist, point, correctedPoint, targetMatchIndex, correction])

  const pickedMatch = useMemo(
    () => official.matches.find((match) => match.matchId === official.pickedId) || null,
    [official.matches, official.pickedId],
  )
  const marketProbs = useMemo(
    () => (pickedMatch ? marketScorelineProbabilities(pickedMatch) : null),
    [pickedMatch],
  )

  const marketInput = useMemo(() => {
    const oneXTwo = { home: parseOdds(marketOdds.home), draw: parseOdds(marketOdds.draw), away: parseOdds(marketOdds.away) }
    const hasOneXTwo = [oneXTwo.home, oneXTwo.draw, oneXTwo.away].every((value) => Number.isFinite(value))
    const over = parseOdds(marketOdds.over)
    const under = parseOdds(marketOdds.under)
    const totals = Number.isFinite(over) && Number.isFinite(under) ? [{ line: 2.5, over, under }] : []
    const handicaps = pickedMatch?.hhad
      ? [{ line: pickedMatch.hhad.goalLine, win: pickedMatch.hhad.home, draw: pickedMatch.hhad.draw, lose: pickedMatch.hhad.away }]
      : []
    if (!hasOneXTwo && totals.length === 0 && handicaps.length === 0) return null
    return { oneXTwo: hasOneXTwo ? oneXTwo : undefined, totals, handicaps }
  }, [marketOdds, pickedMatch])

  const marketFit = useMemo(() => (marketInput ? fitMarketLambdas(marketInput, { maxGoals: MAX_GOALS }) : null), [marketInput])
  const marketReady = Boolean(marketFit?.ready)
  const marketMarkets = useMemo(
    () => (marketReady ? deriveMarketProbabilities(marketFit.homeLambda, marketFit.awayLambda, { maxGoals: MAX_GOALS }) : null),
    [marketFit, marketReady],
  )

  // 市场网格：有比分盘就用市场的真实单格定价；否则退回"1X2 倒算的泊松分布"。
  const marketCells = useMemo(() => {
    if (marketProbs?.ok) return marketProbs.cells.map((cell) => ({ home: cell.home, away: cell.away, p: cell.probability }))
    if (marketReady) return deriveScoreDistribution(marketFit.homeLambda, marketFit.awayLambda, MAX_GOALS)
    return []
  }, [marketFit, marketProbs, marketReady])
  const marketGridReady = marketProbs?.ok || marketReady

  const activeCells = gridSource === 'market' && marketGridReady ? marketCells : cells
  const maxP = useMemo(() => activeCells.reduce((max, cell) => Math.max(max, cell.p), 0), [activeCells])
  const showMarketGrid = gridSource === 'market' && marketGridReady

  // 盘口级对照（1X2 / 大小球）
  const marketLevelRows = useMemo(() => {
    if (!marketMarkets) return []
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
  }, [marketInput, marketMarkets, markets])

  // 比分级对照：只用市场给了报价的单格，按差值绝对值排序取前 6
  const cellRows = useMemo(() => {
    if (!marketProbs?.ok) return []
    const mineMap = new Map(cells.map((cell) => [`${cell.home}-${cell.away}`, cell.p]))
    return marketProbs.cells
      .map((cell) => {
        const mine = mineMap.get(`${cell.home}-${cell.away}`)
        return { label: `${cell.home}-${cell.away}`, mine: mine ?? Number.NaN, market: cell.probability, delta: (mine ?? Number.NaN) - cell.probability }
      })
      .filter((row) => Number.isFinite(row.mine))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 6)
  }, [cells, marketProbs])

  const overUnder = markets.totals.find((row) => row.line === 2.5) || markets.totals[0]
  const handicap = markets.handicaps.find((row) => row.line === -1) || markets.handicaps[0]

  const hasCorrection =
    Math.abs(correction.homeBias?.bias || 0) > 0.005 || Math.abs(correction.awayBias?.bias || 0) > 0.005
  const biasLine = useMemo(() => {
    const fmt = (team, venue, bias) => {
      if (!bias || bias.n === 0 || Math.abs(bias.bias) < 0.01) return null
      const dir = bias.bias > 0 ? '低估' : '高估'
      const amount = Math.abs(bias.bias).toFixed(2)
      // 全局兜底：没有该队样本（或没填队名）时用全局偏差，明说，不装作"这队没有偏差"。
      if (bias.basis === 'global') {
        return `${team || '这队'}：暂无它的样本，按全局偏差修正（${dir} ${amount} 球，可靠度 ${(bias.reliability * 100).toFixed(0)}%）`
      }
      return `${team}：你惯常${dir} ${amount} 球（按${venue === 'home' ? '主场' : '客场'}历史 n=${bias.n}，可靠度 ${(bias.reliability * 100).toFixed(0)}%）`
    }
    const lines = [fmt(homeTeam, 'home', correction.homeBias), fmt(awayTeam, 'away', correction.awayBias)].filter(Boolean)
    return lines.length
      ? lines.join('；')
      : '这支球队还没有你的历史登记样本，暂不做偏差修正——打多了之后才会按你的记录来校。'
  }, [homeTeam, awayTeam, correction])

  const loadOfficialOdds = async () => {
    setOfficial((prev) => ({ ...prev, status: 'loading', error: '' }))
    const result = await fetchOfficialMarketOdds()
    if (!result.ok) {
      setOfficial({
        status: 'error',
        matches: [],
        error: OFFICIAL_ERROR_TEXT[result.reason] || `拉取失败（${result.reason}）`,
        pickedId: '',
        lastUpdateTime: '',
      })
      return
    }
    setOfficial({ status: 'ready', matches: result.matches, error: '', pickedId: '', lastUpdateTime: result.lastUpdateTime })
  }

  const pickOfficialMatch = (matchId) => {
    const match = official.matches.find((row) => row.matchId === matchId)
    if (!match) {
      setOfficial((prev) => ({ ...prev, pickedId: '' }))
      return
    }
    setOfficial((prev) => ({ ...prev, pickedId: match.matchId }))
    setMarketOdds((prev) => ({
      ...prev,
      home: String(match.had.home),
      draw: String(match.had.draw),
      away: String(match.had.away),
    }))
  }

  const groupedMatches = useMemo(() => {
    const groups = new Map()
    official.matches.forEach((match) => {
      const key = match.businessDate || '未标日期'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(match)
    })
    return [...groups.entries()]
  }, [official.matches])

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

          <div className="mt-2.5 rounded-xl border border-stone-200 bg-white/70 px-3 py-2" data-testid="pre-grid-correction">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <p className="text-[11px] text-stone-600">
                登记 <span className="font-medium tabular-nums">{point.home}-{point.away}</span>
                {!insist && hasCorrection && (
                  <>
                    {' → 修正后 '}
                    <span className="font-medium tabular-nums text-emerald-700">
                      {correctedPoint.home.toFixed(2)}-{correctedPoint.away.toFixed(2)}
                    </span>
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => setInsist((prev) => !prev)}
                aria-pressed={insist}
                data-testid="pre-grid-insist-toggle"
                className={`rounded-lg border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  insist ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-stone-200 bg-white text-stone-500 hover:border-emerald-300'
                }`}
              >
                {insist ? '我坚持（按原始输入）' : '用修正后（默认）'}
              </button>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-stone-400">{biasLine}</p>
          </div>

          <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2" data-testid="pre-grid-market-channel">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-[11px] font-medium text-stone-500">机构市场定价</span>
              <button
                type="button"
                onClick={loadOfficialOdds}
                disabled={official.status === 'loading'}
                data-testid="pre-grid-official-fetch"
                className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white/80 px-2 py-1 text-[11px] text-stone-600 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-60"
              >
                {official.status === 'loading'
                  ? <Loader2 size={11} className="animate-spin" />
                  : <RefreshCw size={11} />}
                官方赔率
              </button>
              {official.status === 'ready' && (
                <select
                  value={official.pickedId}
                  onChange={(event) => pickOfficialMatch(event.target.value)}
                  data-testid="pre-grid-official-select"
                  className="max-w-[220px] rounded-lg border border-stone-200 bg-white/80 px-1.5 py-1 text-[11px] text-stone-600 focus:border-emerald-400 focus:outline-none"
                >
                  <option value="">选择场次…</option>
                  {groupedMatches.map(([date, rows]) => (
                    <optgroup key={date} label={date}>
                      {rows.map((match) => (
                        <option key={match.matchId} value={match.matchId}>
                          {match.matchNum} {match.league} {match.home}vs{match.away} {match.had.home}/{match.had.draw}/{match.had.away}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
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
                onClick={() => {
                  setMarketOdds({ home: '', draw: '', away: '', over: '', under: '' })
                  setOfficial((prev) => ({ ...prev, pickedId: '' }))
                }}
                className="ml-auto text-[11px] text-stone-400 hover:text-stone-600"
              >
                清空
              </button>
            </div>

            <p className="mt-1.5 text-[10px] leading-relaxed text-stone-400">
              {official.error
                ? official.error
                : marketProbs?.ok
                  ? `官方比分盘 ${marketProbs.samples} 个报价 · 抽水 ${(marketProbs.overround * 100).toFixed(1)}% · 更新 ${marketProbs.updatedAt || official.lastUpdateTime}；未列出的比分在「胜/平/负其他」里`
                  : marketReady
                    ? `已按赔率倒算市场进球分布：主 λ ${marketFit.homeLambda} · 客 λ ${marketFit.awayLambda} · 拟合误差 ${marketFit.sse}${marketFit.notes?.length ? ` · ${marketFit.notes.join('；')}` : ''}`
                    : official.status === 'ready'
                      ? official.lastUpdateTime ? `官方赔率已就绪（${official.lastUpdateTime}），选一场即可` : '官方赔率已就绪，选一场即可'
                      : '点「官方赔率」直接拉取竞彩赔率（含比分盘），或手工填入。'}
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
              onClick={() => marketGridReady && setGridSource('market')}
              disabled={!marketGridReady}
              className={`rounded-md px-2 py-0.5 text-[11px] ${showMarketGrid ? 'bg-stone-800 text-white' : marketGridReady ? 'text-stone-500 hover:text-stone-700' : 'text-stone-300'}`}
            >
              机构市场
            </button>
            <span className="ml-auto pr-1 text-[10px] text-stone-400">
              {showMarketGrid
                ? marketProbs?.ok ? '市场比分盘（空白 = 市场未报价）' : `市场 λ ${marketFit.homeLambda} / ${marketFit.awayLambda}`
                : '横向 = 客队进球'}
            </span>
          </div>

          <div className="mt-2">
            <PreMatchCloud
              cells={activeCells}
              registeredPoint={!showMarketGrid ? point : null}
              marketMode={showMarketGrid}
              maxGoals={MAX_GOALS}
            />
          </div>
          <p className="text-[10px] text-stone-400">
            ↑ 主队进球 · → 客队进球 · 灰度为该比分概率
            {showMarketGrid
              ? marketProbs?.ok ? ' · 当前为官方比分盘去水后的市场定价' : ' · 当前为机构赔率倒算的市场分布'
              : ' · 圆点是你登记的比分'}
          </p>

          <div className="mt-3 space-y-2.5">
            {cellRows.length > 0 && (
              <div>
                <p className="text-[11px] text-stone-400">比分对照 · 分歧最大的 6 个（市场未报价的格子不参与）</p>
                <table className="mt-1 w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-stone-400">
                      <th className="py-0.5 text-left font-normal">比分</th>
                      <th className="py-0.5 text-right font-normal">我</th>
                      <th className="py-0.5 text-right font-normal">市场</th>
                      <th className="py-0.5 text-right font-normal">差</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cellRows.map((row) => (
                      <tr key={row.label} className="border-t border-stone-100">
                        <td className="py-1 tabular-nums text-stone-600">{row.label}</td>
                        <td className="py-1 text-right tabular-nums text-stone-700">{pct(row.mine)}</td>
                        <td className="py-1 text-right tabular-nums text-stone-500">{pct(row.market)}</td>
                        <td className={`py-1 text-right font-medium tabular-nums ${row.delta >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{signedPp(row.delta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {marketProbs?.ok && (
              <p className="text-[10px] text-stone-400">
                市场「其他」：胜其他 <span className="tabular-nums">{pct(marketProbs.other.win)}</span> · 平其他{' '}
                <span className="tabular-nums">{pct(marketProbs.other.draw)}</span> · 负其他{' '}
                <span className="tabular-nums">{pct(marketProbs.other.away)}</span>
              </p>
            )}

            {marketLevelRows.length > 0 ? (
              <div>
                <p className="text-[11px] text-stone-400">盘口对照 · 我的观点 vs 机构市场</p>
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
                    {marketLevelRows.map((row) => (
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
                        <span className="font-semibold tabular-nums text-stone-800">{pct(row.value)}</span>
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
            {pickedMatch && (
              <p className="text-[10px] text-stone-400">
                已选 {pickedMatch.matchNum} {pickedMatch.league} {pickedMatch.home}vs{pickedMatch.away}
                {movementMark(pickedMatch.movement.home) || movementMark(pickedMatch.movement.away)
                  ? ` · 主${movementMark(pickedMatch.movement.home) || '—'} 客${movementMark(pickedMatch.movement.away) || '—'}`
                  : ''}
                {pickedMatch.hhad ? ` · 让球盘 ${pickedMatch.hhad.goalLine} 已并入倒算` : ' · 该场暂无让球盘'}
              </p>
            )}
            <div>
              <p className="text-[11px] text-stone-400">最可能比分{showMarketGrid ? '（市场）' : ''}</p>
              <p className="text-xs text-stone-600">
                {(showMarketGrid
                  ? [...marketCells].sort((a, b) => b.p - a.p).slice(0, 3).map((cell) => ({ score: `${cell.home}-${cell.away}`, p: cell.p }))
                  : markets.topScores.slice(0, 3)
                ).map((row) => `${row.score} ${pct(row.p)}`).join(' · ')}
              </p>
            </div>
            <p className="text-[10px] leading-relaxed text-stone-400">
              我的观点由登记比分推出（先验 主 {DEFAULT_LAMBDA_PRIOR.home} / 客 {DEFAULT_LAMBDA_PRIOR.away}）；市场侧来自官方竞彩赔率（比例去水，比分盘抽水约 30%+，属简化口径）。
              我的观点由登记比分按你在各球队的历史偏差修正（没有历史样本就不修）；机构市场来自官方竞彩赔率（比例去水，比分盘抽水约 30%+，属简化口径）。
              「我坚持」时按你的原始输入计算这场的仓位；否则按修正后算。
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
