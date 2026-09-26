import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import PreMatchCloud from './PreMatchCloud'
import PreScoreSlider from './PreScoreSlider'
import { fetchOfficialMarketOdds, marketOddsForEntry, marketOddsForFit, marketScorelineProbabilities } from '../lib/marketOdds'
import {
  applyTeamBias,
  deriveMarketProbabilities,
  deriveScoreDistribution,
  fitMarketLambdas,
  marketProbabilitiesFromCells,
  probabilityForEntry,
} from '../lib/readQuality'
import {
  SCORE_GOAL_MAX,
  buildOpinionMatchProfile,
  defaultWindowForGoals,
  expectedGoals,
  jointScoreCells,
  matchOfficialFixture,
  shiftWeights,
  topScoreRows,
  weightsFromSlider,
} from '../lib/preMatchOpinion'

const MAX_GOALS = SCORE_GOAL_MAX

const OFFICIAL_ERROR_TEXT = {
  fetch_unavailable: '当前环境不支持自动拉取，请手工填写市场赔率。',
  timeout: '拉取超时（可能是网络出口被挡），请重试或手工填写。',
  network_error: '网络错误拉不到官方赔率，请重试或手工填写（挂代理时会被拦截）。',
  http_567: '被官方风控拦截（常见于挂了代理），请关掉代理再试或手工填写。',
  no_sellable_matches: '官方暂时没有在售场次。',
  unexpected_payload: '官方返回格式变了，请手工填写。',
}

const pct = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '--')
const signedPp = (value) => (Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}pp` : '--')
const parseOdds = (value) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 1 ? parsed : Number.NaN
}

// 官方赔率一份数据全页共用：5 分钟内不重复拉，多个场次共用同一个请求。
const OFFICIAL_CACHE_TTL_MS = 5 * 60 * 1000
let officialCache = { at: 0, payload: null, promise: null }

const loadOfficialOdds = ({ force = false } = {}) => {
  const now = Date.now()
  if (!force && officialCache.payload && now - officialCache.at < OFFICIAL_CACHE_TTL_MS) {
    return Promise.resolve(officialCache.payload)
  }
  if (!force && officialCache.promise) return officialCache.promise
  const promise = fetchOfficialMarketOdds()
    .then((result) => {
      officialCache = result?.ok
        ? { at: Date.now(), payload: result, promise: null }
        : { at: officialCache.at, payload: officialCache.payload, promise: null }
      return result
    })
    .catch(() => {
      officialCache = { at: officialCache.at, payload: officialCache.payload, promise: null }
      return { ok: false, reason: 'network_error', matches: [] }
    })
  officialCache.promise = promise
  return promise
}

const sliderDefaultsFor = (goals) => {
  const [lo, hi] = defaultWindowForGoals(goals)
  return { lo, hi, modes: {} }
}

const emptyManual = { home: '', draw: '', away: '', over: '', under: '' }

/**
 * 投前研究板：Entries 里写了比分就展开。
 * 上面两条滑轨表达「我认为它会进几球」，下面自动对位机构场次并出云图；
 * 回传的 probability 是「这条 Entry 在我的分布里的概率」，供这场的仓位计算用。
 */
export default function PreMatchBoard({
  matchIndex = 0,
  homeTeam = '',
  awayTeam = '',
  entries = [],
  detectedScore = null,
  biasModel = null,
  onOpinionChange = null,
}) {
  const active = Boolean(detectedScore && Number.isFinite(detectedScore.home) && Number.isFinite(detectedScore.away))
  const scoreSignature = active ? `${detectedScore.home}-${detectedScore.away}` : ''
  const teamSignature = `${homeTeam}::${awayTeam}`

  const [sliders, setSliders] = useState(() => ({
    home: sliderDefaultsFor(detectedScore?.home ?? 2),
    away: sliderDefaultsFor(detectedScore?.away ?? 1),
  }))
  const [insist, setInsist] = useState(false)
  const [pickedId, setPickedId] = useState('')
  const [manual, setManual] = useState(emptyManual)
  const [market, setMarket] = useState({ status: 'idle', matches: [], error: '', lastUpdateTime: '' })

  // 登记的比分一变（或换了比赛），区间回到默认：自己 ±1 球。
  useEffect(() => {
    if (!active) return
    setSliders({
      home: sliderDefaultsFor(detectedScore.home),
      away: sliderDefaultsFor(detectedScore.away),
    })
    setInsist(false)
  }, [active, scoreSignature]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPickedId('')
  }, [teamSignature])

  // 填了比分 + 两支队名 → 自动拉一次官方赔率（全页共用缓存）。
  // 用 ref 当闸门：effect 会因为 status 变化重跑，绝不能在重跑时把在途请求的结果丢掉。
  const marketFetchRef = useRef('idle')
  useEffect(() => {
    if (!active || !homeTeam.trim() || !awayTeam.trim()) return
    if (marketFetchRef.current !== 'idle') return
    marketFetchRef.current = 'loading'
    setMarket((prev) => ({ ...prev, status: 'loading', error: '' }))
    loadOfficialOdds().then((result) => {
      marketFetchRef.current = 'done'
      if (!result?.ok) {
        setMarket({ status: 'error', matches: [], error: result?.reason || 'network_error', lastUpdateTime: '' })
        return
      }
      setMarket({ status: 'ready', matches: result.matches, error: '', lastUpdateTime: result.lastUpdateTime || '' })
    })
  }, [active, awayTeam, homeTeam])

  const reloadOfficial = (force) => {
    marketFetchRef.current = 'loading'
    setMarket((prev) => ({ ...prev, status: 'loading', error: '' }))
    loadOfficialOdds({ force }).then((result) => {
      marketFetchRef.current = 'done'
      if (!result?.ok) {
        setMarket({ status: 'error', matches: [], error: result?.reason || 'network_error', lastUpdateTime: '' })
        return
      }
      setMarket({ status: 'ready', matches: result.matches, error: '', lastUpdateTime: result.lastUpdateTime || '' })
    })
  }

  // ── 我的分布：区间 + 浓度 → 每侧进球分布 → θ 修正 → 联合比分分布 ──
  const registeredWeights = useMemo(
    () => ({
      home: weightsFromSlider(sliders.home),
      away: weightsFromSlider(sliders.away),
    }),
    [sliders],
  )

  const correction = useMemo(
    () => (active ? applyTeamBias(detectedScore, { homeTeam, awayTeam, biasModel }) : null),
    [active, biasModel, awayTeam, detectedScore, homeTeam],
  )

  const effectiveWeights = useMemo(() => {
    if (!active) return registeredWeights
    const homeDelta = insist ? 0 : correction.home - detectedScore.home
    const awayDelta = insist ? 0 : correction.away - detectedScore.away
    return {
      home: shiftWeights(registeredWeights.home, homeDelta),
      away: shiftWeights(registeredWeights.away, awayDelta),
    }
  }, [active, correction, detectedScore, insist, registeredWeights])

  const cells = useMemo(
    () => jointScoreCells(effectiveWeights.home, effectiveWeights.away),
    [effectiveWeights],
  )

  const entryLines = useMemo(() => {
    const totalLines = [...new Set(
      entries
        .filter((entry) => entry?.market_type === 'total' && Number.isFinite(Number(entry?.parse_detail?.line)))
        .map((entry) => Number(entry.parse_detail.line)),
    )]
    const handicapLines = [...new Set(
      entries
        .filter((entry) => entry?.market_type === 'handicap' && Number.isFinite(Number(entry?.parse_detail?.line)))
        .map((entry) => Number(entry.parse_detail.line)),
    )]
    return { totalLines, handicapLines }
  }, [entries])

  const myMarkets = useMemo(
    () => marketProbabilitiesFromCells(cells, {
      maxGoals: MAX_GOALS,
      ...(entryLines.totalLines.length ? { totalLines: entryLines.totalLines } : {}),
      ...(entryLines.handicapLines.length ? { handicapLines: entryLines.handicapLines } : {}),
    }),
    [cells, entryLines],
  )

  const firstEntry = Array.isArray(entries) && entries.length > 0 ? entries[0] : null
  const myEntryProbability = useMemo(
    () => (firstEntry ? probabilityForEntry(firstEntry, { markets: myMarkets, cells }) : Number.NaN),
    [cells, firstEntry, myMarkets],
  )

  // ── 机构市场：自动按队名对位（主客对调也算命中）──
  const autoMatch = useMemo(
    () => (active ? matchOfficialFixture(market.matches, homeTeam, awayTeam) : null),
    [active, awayTeam, homeTeam, market.matches],
  )
  const fixture = useMemo(() => {
    if (!active || market.status !== 'ready') return null
    if (pickedId) return market.matches.find((row) => row.matchId === pickedId) || null
    return autoMatch?.match || null
  }, [active, autoMatch, market.matches, market.status, pickedId])
  const swapped = !pickedId && Boolean(autoMatch?.swapped)

  const marketScoreProbs = useMemo(
    () => (fixture ? marketScorelineProbabilities(fixture) : null),
    [fixture],
  )

  const marketInput = useMemo(() => {
    const manualOneXTwo = {
      home: parseOdds(manual.home),
      draw: parseOdds(manual.draw),
      away: parseOdds(manual.away),
    }
    const manualComplete = [manualOneXTwo.home, manualOneXTwo.draw, manualOneXTwo.away].every(Number.isFinite)
    const fixtureInput = fixture ? marketOddsForFit(fixture) : null
    const oneXTwo = manualComplete ? manualOneXTwo : fixtureInput?.oneXTwo
    const over = parseOdds(manual.over)
    const under = parseOdds(manual.under)
    const totals = Number.isFinite(over) && Number.isFinite(under) ? [{ line: 2.5, over, under }] : []
    const handicaps = fixtureInput?.handicaps || []
    if (!oneXTwo && totals.length === 0 && handicaps.length === 0) return null
    return { oneXTwo, totals, handicaps }
  }, [fixture, manual])

  const marketFit = useMemo(
    () => (marketInput ? fitMarketLambdas(marketInput, { maxGoals: MAX_GOALS }) : null),
    [marketInput],
  )
  const marketReady = Boolean(marketFit?.ready)
  const marketMarkets = useMemo(
    () => (marketReady
      ? deriveMarketProbabilities(marketFit.homeLambda, marketFit.awayLambda, {
        maxGoals: MAX_GOALS,
        ...(entryLines.totalLines.length ? { totalLines: entryLines.totalLines } : {}),
        ...(entryLines.handicapLines.length ? { handicapLines: entryLines.handicapLines } : {}),
      })
      : null),
    [entryLines, marketFit, marketReady],
  )
  const marketCells = useMemo(() => {
    if (marketScoreProbs?.ok) return marketScoreProbs.cells.map((cell) => ({ home: cell.home, away: cell.away, p: cell.probability }))
    if (marketReady) return deriveScoreDistribution(marketFit.homeLambda, marketFit.awayLambda, MAX_GOALS)
    return []
  }, [marketFit, marketReady, marketScoreProbs])

  const marketEntryProbability = useMemo(() => {
    if (!firstEntry) return Number.NaN
    if (!marketMarkets) return Number.NaN
    return probabilityForEntry(firstEntry, { markets: marketMarkets, cells: marketCells })
  }, [firstEntry, marketCells, marketMarkets])

  const levelRows = useMemo(() => {
    if (!marketMarkets) return []
    return [
      { label: '主胜', mine: myMarkets.oneXTwo.home, market: marketMarkets.oneXTwo.home },
      { label: '平', mine: myMarkets.oneXTwo.draw, market: marketMarkets.oneXTwo.draw },
      { label: '客胜', mine: myMarkets.oneXTwo.away, market: marketMarkets.oneXTwo.away },
    ].map((row) => ({ ...row, delta: row.mine - row.market }))
  }, [marketMarkets, myMarkets])

  const topRows = useMemo(() => topScoreRows(cells, 3), [cells])
  const homeMean = expectedGoals(effectiveWeights.home)
  const awayMean = expectedGoals(effectiveWeights.away)
  const registeredMean = { home: expectedGoals(registeredWeights.home), away: expectedGoals(registeredWeights.away) }

  const hasCorrection = Boolean(
    correction
    && (Math.abs(correction.home - (detectedScore?.home ?? 0)) > 0.005
      || Math.abs(correction.away - (detectedScore?.away ?? 0)) > 0.005),
  )

  // 偏差行：只说事实（样本量、平均差、可靠度），没有样本就明说没有。
  const biasLine = useMemo(() => {
    if (!correction) return ''
    const rows = [
      { team: homeTeam, venue: 'home', bias: correction.homeBias },
      { team: awayTeam, venue: 'away', bias: correction.awayBias },
    ]
    return rows
      .map((row) => {
        if (!row.bias || row.bias.n === 0) return null
        if (row.bias.basis === 'global') {
          return `${row.team || '这队'}：暂无它的样本，按全局偏差 ${row.bias.bias >= 0 ? '+' : ''}${row.bias.bias.toFixed(2)} 球（可靠度 ${(row.bias.reliability * 100).toFixed(0)}%）`
        }
        const side = row.venue === 'home' ? '主场' : '客场'
        return `${row.team}：${side} n=${row.bias.n} · 平均差 ${row.bias.bias >= 0 ? '+' : ''}${row.bias.bias.toFixed(2)} 球（实际 − 登记）· 可靠度 ${(row.bias.reliability * 100).toFixed(0)}%`
      })
      .filter(Boolean)
      .join('；')
  }, [awayTeam, correction, homeTeam])

  // 这一场在「我的分布」下的仓位分布（同场多条腿也能算：主胜 + 2-1 之类）。
  // 判不了的腿（半全场、整数让球线）会返回 supported:false，页面自动退回生产管线。
  const opinionProfile = useMemo(
    () => buildOpinionMatchProfile({ entries, cells }),
    [cells, entries],
  )

  // 机构给这些腿开的赔率（原样含抽水），供页面自动回填空的 odds 框。
  const marketEntryOdds = useMemo(
    () => (Array.isArray(entries) ? entries.map((entry) => marketOddsForEntry(fixture, entry)?.odds ?? null) : []),
    [entries, fixture],
  )

  // 回传这场的观点：union 概率 + 仓位分布 + 机构赔率。
  const opinionRef = useRef(null)
  useEffect(() => {
    if (typeof onOpinionChange !== 'function') return
    const payload = active
      ? {
        matchIndex,
        active: true,
        probability: opinionProfile.supported ? opinionProfile.hitProbability : myEntryProbability,
        profile: opinionProfile.supported ? opinionProfile : null,
        marketEntryOdds,
        insist,
        registered: { home: detectedScore.home, away: detectedScore.away },
        homeMean,
        awayMean,
        topScores: topRows,
      }
      : { matchIndex, active: false, probability: Number.NaN, profile: null, marketEntryOdds: [] }
    const signature = JSON.stringify(payload)
    if (opinionRef.current === signature) return
    opinionRef.current = signature
    onOpinionChange(payload)
  }, [active, awayMean, detectedScore, homeMean, insist, marketEntryOdds, matchIndex, myEntryProbability, onOpinionChange, opinionProfile, topRows])

  if (!active) {
    return (
      <section className="pre-board is-idle" data-testid="pre-match-board-idle">
        <p className="pre-board-idle-text">
          在 Entries 里写下比分（例如 <span className="tabular-nums">2-1</span>），这里会自动展开「我认为它会进几球」、
          机构比分盘对位与比分云图。
        </p>
      </section>
    )
  }

  const marketReadyForCloud = Boolean(marketScoreProbs?.ok) || marketReady

  return (
    <section className="pre-board" data-testid="pre-match-board">
      <header className="pre-board-head">
        <span className="pre-board-title">我的进球分布</span>
        <span className="pre-board-sub">
          登记 {detectedScore.home}-{detectedScore.away} · 端点定区间，格子点浓度（加权 / 压低 / 还原）
        </span>
      </header>

      <div className="pre-board-sliders">
        <PreScoreSlider
          label="主队"
          tone="home"
          value={sliders.home}
          weights={effectiveWeights.home}
          onChange={(next) => setSliders((prev) => ({ ...prev, home: next }))}
          testId="pre-slider-home"
        />
        <PreScoreSlider
          label="客队"
          tone="away"
          value={sliders.away}
          weights={effectiveWeights.away}
          onChange={(next) => setSliders((prev) => ({ ...prev, away: next }))}
          testId="pre-slider-away"
        />
      </div>

      <div className="pre-board-correction" data-testid="pre-board-correction">
        <div className="pre-board-correction-top">
          <p className="pre-board-correction-text">
            分布中心 {registeredMean.home.toFixed(2)}-{registeredMean.away.toFixed(2)}
            {!insist && hasCorrection && (
              <>
                {' → '}
                <span className="pre-board-corrected tabular-nums">
                  {homeMean.toFixed(2)}-{awayMean.toFixed(2)}
                </span>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setInsist((prev) => !prev)}
            aria-pressed={insist}
            data-testid="pre-board-insist-toggle"
            className={`pre-board-insist${insist ? ' is-on' : ''}`}
          >
            {insist ? '我坚持（按原始输入）' : '用修正后（默认）'}
          </button>
        </div>
        <p className="pre-board-bias">
          {biasLine || '这支队还没有历史登记样本，本场不做偏差修正。'}
        </p>
      </div>

      <div className="pre-board-market" data-testid="pre-board-market">
        <div className="pre-board-market-top">
          <span className="pre-board-market-label">机构市场定价</span>
          {market.status === 'loading' && (
            <span className="pre-board-market-state"><Loader2 size={11} className="animate-spin" /> 正在拉取官方竞彩赔率…</span>
          )}
          {market.status === 'error' && (
            <span className="pre-board-market-state is-error">
              {OFFICIAL_ERROR_TEXT[market.error] || `拉取失败（${market.error}）`}
            </span>
          )}
          {market.status === 'ready' && fixture && (
            <span className="pre-board-market-state is-ok">
              已匹配 {fixture.matchNum} {fixture.league} {fixture.home} vs {fixture.away}
              {swapped ? ' · 主客对调匹配' : ''}
              {marketScoreProbs?.ok ? ` · 比分盘 ${marketScoreProbs.samples} 档 · 抽水 ${(marketScoreProbs.overround * 100).toFixed(1)}%` : ''}
            </span>
          )}
          {market.status === 'ready' && !fixture && (
            <span className="pre-board-market-state">没匹配到这两支队（可能还没开售）</span>
          )}
          <button
            type="button"
            onClick={() => reloadOfficial(true)}
            disabled={market.status === 'loading'}
            data-testid="pre-board-market-refresh"
            className="pre-board-market-refresh"
          >
            <RefreshCw size={11} /> {market.status === 'ready' ? '重拉' : '拉取'}
          </button>
        </div>

        {market.status === 'ready' && market.matches.length > 0 && (
          <select
            value={pickedId || fixture?.matchId || ''}
            onChange={(event) => setPickedId(event.target.value)}
            data-testid="pre-board-market-select"
            className="pre-board-market-select"
          >
            <option value="">自动匹配</option>
            {market.matches.map((row) => (
              <option key={row.matchId} value={row.matchId}>
                {row.matchNum} {row.league} {row.home}vs{row.away}
              </option>
            ))}
          </select>
        )}

        <details className="pre-board-manual">
          <summary>手工填写市场赔率</summary>
          <div className="pre-board-manual-grid">
            {[
              ['home', '主胜'],
              ['draw', '平'],
              ['away', '客胜'],
              ['over', '大 2.5'],
              ['under', '小 2.5'],
            ].map(([key, label]) => (
              <label key={key} className="pre-board-manual-field">
                <span>{label}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={manual[key]}
                  onChange={(event) => setManual((prev) => ({ ...prev, [key]: event.target.value }))}
                  placeholder="--"
                />
              </label>
            ))}
            <button type="button" className="pre-board-manual-clear" onClick={() => setManual(emptyManual)}>
              清空
            </button>
          </div>
        </details>

        <p className="pre-board-market-note">
          {market.status === 'error'
            ? '市场通道没接上时不影响我的分布与这场的仓位：只管我的分布就好。'
            : marketScoreProbs?.ok
              ? `官方比分盘（比例去水）· 更新 ${marketScoreProbs.updatedAt || market.lastUpdateTime || '--'}；未列出的比分在「胜/平/负其他」里`
              : marketReady
                ? `已按赔率倒算市场进球分布：主 λ ${marketFit.homeLambda} · 客 λ ${marketFit.awayLambda}`
                : '填了比分会自动拉官方赔率并按队名对位。'}
        </p>
      </div>

      <div className="pre-board-visual">
      <div className="pre-board-cloud">
        <PreMatchCloud
          cells={cells}
          marketCells={marketReadyForCloud ? marketCells : []}
          registeredPoint={{ home: detectedScore.home, away: detectedScore.away }}
          maxGoals={MAX_GOALS}
        />
        <p className="pre-board-cloud-legend">
          <span className="pre-board-legend-swatch is-mine">我的观点</span>
          {marketReadyForCloud
            ? (
              <>
                <span className="pre-board-legend-swatch is-market">① 机构</span>
                <span className="pre-board-legend-axis">↑ 主队进球 · → 客队进球</span>
              </>
            )
            : <span className="pre-board-legend-axis">↑ 主队进球 · → 客队进球</span>}
        </p>
      </div>

      <div className="pre-board-readout">
        <div className="pre-board-cards">
          {[
            { label: '主胜', value: myMarkets.oneXTwo.home },
            { label: '平', value: myMarkets.oneXTwo.draw },
            { label: '客胜', value: myMarkets.oneXTwo.away },
          ].map((row) => (
            <div key={row.label} className="pre-board-card">
              <span className="pre-board-card-label">{row.label}</span>
              <span className="pre-board-card-value tabular-nums">{pct(row.value)}</span>
            </div>
          ))}
          <div className="pre-board-card is-wide">
            <span className="pre-board-card-label">最可能比分</span>
            <span className="pre-board-card-value is-small tabular-nums">
              {topRows.map((row) => `${row.score} ${pct(row.p)}`).join(' · ')}
            </span>
          </div>
        </div>

        {firstEntry && (
          <p className="pre-board-entry-line" data-testid="pre-board-entry-line">
            这条 Entry（{firstEntry.name || '未命名'}）：我给 {pct(myEntryProbability)}
            {marketMarkets ? ` · 市场给 ${pct(marketEntryProbability)}` : ''}
            {marketMarkets && Number.isFinite(marketEntryProbability)
              ? ` · 差 ${signedPp(myEntryProbability - marketEntryProbability)}`
              : ''}
          </p>
        )}

        {levelRows.length > 0 && (
          <table className="pre-board-compare">
            <thead>
              <tr>
                <th>盘口</th>
                <th>我</th>
                <th>市场</th>
                <th>差</th>
              </tr>
            </thead>
            <tbody>
              {levelRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="tabular-nums">{pct(row.mine)}</td>
                  <td className="tabular-nums">{pct(row.market)}</td>
                  <td className={`tabular-nums ${row.delta >= 0 ? 'is-positive' : 'is-negative'}`}>{signedPp(row.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="pre-board-footnote">
          我的分布只来自我的区间与浓度（负数方向由历史平均差修正，「我坚持」时用原始输入），不掺市场赔率；
          市场侧只做对照。这场的仓位按我的分布算。
        </p>
      </div>
      </div>
    </section>
  )
}
