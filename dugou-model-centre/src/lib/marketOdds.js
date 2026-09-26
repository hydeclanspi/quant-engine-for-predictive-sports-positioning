// 机构市场定价 · 官方竞彩赔率（中国体育彩票 webapi）
//
// 页面 m.sporttery.cn 的 HTML 是空壳，数据全在这个接口里：
//   GET .../gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=had,hhhad
// 该接口返回 Access-Control-Allow-Origin: *，浏览器可以直接抓。
// 注意：网络出口被 WAF（TencentEdgeOne）拦截时（例如挂了代理）会拿到 567 拦截页，
// 调用方必须降级到手工录入，不能把抓取失败当成"没有市场价"。

import { deVigProportional } from './readQuality'

export const OFFICIAL_ODDS_ENDPOINT =
  'https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c&poolCode=crs,had,hhhad'

const parseOdds = (value) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 1 ? parsed : Number.NaN
}

// 升降标记：-1 降赔 / 0 不变 / 1 升赔
const parseMovement = (flag) => {
  const value = Number(flag)
  if (value === 1) return 'up'
  if (value === -1) return 'down'
  return 'flat'
}

const text = (value) => String(value ?? '').trim()

/** 把官方接口返回体规范成扁平场次列表；只保留有完整胜平负赔率的场次。 */
export const normalizeOfficialOdds = (payload) => {
  const value = payload?.value
  if (!value || !Array.isArray(value.matchInfoList)) {
    return { ok: false, reason: 'unexpected_payload', lastUpdateTime: null, matches: [] }
  }

  const matches = []
  value.matchInfoList.forEach((group) => {
    ;(Array.isArray(group?.subMatchList) ? group.subMatchList : []).forEach((match) => {
      const had = {
        home: parseOdds(match?.had?.h),
        draw: parseOdds(match?.had?.d),
        away: parseOdds(match?.had?.a),
      }
      if (![had.home, had.draw, had.away].every((odds) => Number.isFinite(odds))) return

      const hhadOdds = {
        home: parseOdds(match?.hhad?.h),
        draw: parseOdds(match?.hhad?.d),
        away: parseOdds(match?.hhad?.a),
      }
      const goalLine = Number.parseFloat(match?.hhad?.goalLine)
      const hhad = [hhadOdds.home, hhadOdds.draw, hhadOdds.away].every((odds) => Number.isFinite(odds))
        && Number.isFinite(goalLine)
        ? { ...hhadOdds, goalLine }
        : null

      const pools = Array.isArray(match?.poolList) ? match.poolList : []
      const hadPool = pools.find((pool) => pool?.poolCode === 'HAD') || null

      // 比分盘：s{主}{客} 为单格赔率（01 = 1 球），s1sh/s1sd/s1sa 为胜/平/负「其他」打包项。
      const scores = []
      let other = null
      const crs = match?.crs
      if (crs && typeof crs === 'object') {
        Object.entries(crs).forEach(([key, value]) => {
          const cell = /^s(\d{2})s(\d{2})$/.exec(key)
          if (!cell) return
          const odds = parseOdds(value)
          if (!Number.isFinite(odds)) return
          scores.push({
            home: Number.parseInt(cell[1], 10),
            away: Number.parseInt(cell[2], 10),
            odds,
            movement: parseMovement(crs[`${key}f`]),
          })
        })
        const otherOdds = { win: parseOdds(crs.s1sh), draw: parseOdds(crs.s1sd), away: parseOdds(crs.s1sa) }
        if ([otherOdds.win, otherOdds.draw, otherOdds.away].every((odds) => Number.isFinite(odds))) {
          other = {
            ...otherOdds,
            movement: {
              win: parseMovement(crs.s1shf),
              draw: parseMovement(crs.s1sdf),
              away: parseMovement(crs.s1saf),
            },
          }
        }
      }

      matches.push({
        matchId: text(match?.matchId),
        matchNum: text(match?.matchNumStr),
        businessDate: text(group?.businessDate || match?.businessDate),
        kickoff: `${text(match?.matchDate)} ${text(match?.matchTime)}`.trim(),
        league: text(match?.leagueAbbName || match?.leagueAllName),
        home: text(match?.homeTeamAbbName || match?.homeTeamAllName),
        away: text(match?.awayTeamAbbName || match?.awayTeamAllName),
        homeRank: text(match?.homeRank),
        awayRank: text(match?.awayRank),
        had,
        movement: {
          home: parseMovement(match?.had?.hf),
          draw: parseMovement(match?.had?.df),
          away: parseMovement(match?.had?.af),
        },
        hadUpdatedAt: `${text(match?.had?.updateDate)} ${text(match?.had?.updateTime)}`.trim(),
        hhad,
        scores,
        other,
        crsUpdatedAt: `${text(crs?.updateDate)} ${text(crs?.updateTime)}`.trim(),
        selling: Number(match?.sellStatus) === 1 && hadPool?.poolStatus === 'Selling',
        single: Number(hadPool?.single) === 1,
        allUp: Number(hadPool?.allUp) === 1,
        hot: Number(match?.isHot) === 1,
      })
    })
  })

  if (matches.length === 0) return { ok: false, reason: 'no_sellable_matches', lastUpdateTime: null, matches: [] }
  return { ok: true, lastUpdateTime: text(value.lastUpdateTime), matches }
}

/** 取一场比赛，转成 fitMarketLambdas 的输入（1X2 必需；有让球盘就一并作为约束）。 */
export const marketOddsForFit = (match) => {
  if (!match?.had) return null
  const handicaps = match.hhad
    ? [{ line: match.hhad.goalLine, win: match.hhad.home, draw: match.hhad.draw, lose: match.hhad.away }]
    : []
  return { oneXTwo: { home: match.had.home, draw: match.had.draw, away: match.had.away }, handicaps }
}

/**
 * 市场比分分布：单格赔率 + 胜/平/负「其他」三个打包项构成完整划分，
 * 按比例去水后即为市场对每个比分的定价（「其他」代表未列出的比分）。
 * 比分盘抽水通常很高（30% 量级），这是简化去水口径，用于"我和市场差多少"的定性研判。
 */
export const marketScorelineProbabilities = (match) => {
  const cells = Array.isArray(match?.scores) ? match.scores : []
  const other = match?.other
  const options = [
    ...cells.map((cell) => ({ type: 'cell', home: cell.home, away: cell.away, odds: cell.odds })),
    ...(other
      ? [
          { type: 'other', side: 'win', odds: other.win },
          { type: 'other', side: 'draw', odds: other.draw },
          { type: 'other', side: 'away', odds: other.away },
        ]
      : []),
  ]
  if (cells.length < 10 || !other) {
    return { ok: false, reason: 'insufficient_scoreline_quotes', cells: [], other: null, overround: Number.NaN }
  }
  const devig = deVigProportional(options.map((option) => option.odds))
  if (!devig.ok) return { ok: false, reason: 'invalid_scoreline_odds', cells: [], other: null, overround: Number.NaN }

  const fairCells = []
  const fairOther = { win: Number.NaN, draw: Number.NaN, away: Number.NaN }
  options.forEach((option, index) => {
    const probability = devig.fair[index]
    if (option.type === 'cell') fairCells.push({ home: option.home, away: option.away, probability })
    else fairOther[option.side] = probability
  })

  return {
    ok: true,
    overround: devig.overround,
    samples: options.length,
    cells: fairCells,
    other: fairOther,
    updatedAt: match?.crsUpdatedAt || '',
  }
}

/**
 * 机构给这条腿开的赔率（原样、含抽水，就是下单时看到的那个数）。
 * 投前自动回填赔率用：1X2 取胜平负池，比分取比分盘单格；其它盘口本轮不回填。
 */
export const marketOddsForEntry = (match, entry) => {
  if (!match || !entry) return null
  const detail = entry.parse_detail || {}
  if (entry.market_type === 'result') {
    if (!match.had) return null
    const odds =
      detail.outcome === 'win' ? match.had.home
        : detail.outcome === 'draw' ? match.had.draw
          : detail.outcome === 'lose' ? match.had.away
            : Number.NaN
    return Number.isFinite(odds) && odds > 1 ? { odds, source: 'had' } : null
  }
  if (entry.market_type === 'score') {
    const home = Number(detail.home)
    const away = Number(detail.away)
    if (!Number.isFinite(home) || !Number.isFinite(away)) return null
    const cell = (Array.isArray(match.scores) ? match.scores : [])
      .find((row) => row.home === home && row.away === away)
    return cell && Number.isFinite(cell.odds) && cell.odds > 1 ? { odds: cell.odds, source: 'crs' } : null
  }
  return null
}

export const fetchOfficialMarketOdds = async ({ fetchImpl, timeoutMs = 12000 } = {}) => {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) return { ok: false, reason: 'fetch_unavailable', matches: [] }
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    const response = await doFetch(OFFICIAL_ODDS_ENDPOINT, {
      headers: { Accept: 'application/json, text/plain, */*' },
      signal: controller?.signal,
    })
    if (!response?.ok) return { ok: false, reason: `http_${response?.status ?? 'error'}`, matches: [] }
    const payload = await response.json()
    return normalizeOfficialOdds(payload)
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'network_error'
    return { ok: false, reason, matches: [] }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
