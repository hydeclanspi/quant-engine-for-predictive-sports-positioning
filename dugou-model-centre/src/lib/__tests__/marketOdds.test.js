import { describe, expect, it, vi } from 'vitest'
import {
  OFFICIAL_ODDS_ENDPOINT,
  fetchOfficialMarketOdds,
  marketOddsForEntry,
  marketOddsForFit,
  marketScorelineProbabilities,
  normalizeOfficialOdds,
} from '../marketOdds'

// 夹具取自官方接口真实响应（2026-09-25 19:15 快照），只裁剪了本模块不读的字段；
// 第二场的让球盘是注入的（当时让球盘尚未开售），字段结构与线上一致。
const payload = {
  "dataFrom": "",
  "emptyFlag": false,
  "errorCode": "0",
  "errorMessage": "处理成功",
  "success": true,
  "value": {
    "matchInfoList": [
      {
        "businessDate": "2026-09-25",
        "weekday": "周五",
        "matchCount": 2,
        "matchNumDate": "周五",
        "subMatchList": [
          {
            "matchId": 2041689,
            "matchNumStr": "周五006",
            "matchDate": "2026-09-26",
            "matchTime": "00:00:00",
            "leagueAbbName": "欧国联",
            "homeTeamAbbName": "格鲁吉亚",
            "awayTeamAbbName": "北爱尔兰",
            "homeRank": "[Group 23]",
            "awayRank": "[Group 24]",
            "had": {
              "a": "4.85",
              "af": "1",
              "d": "3.35",
              "df": "0",
              "goalLine": "",
              "goalLineValue": "",
              "h": "1.60",
              "hf": "-1",
              "updateDate": "2026-09-25",
              "updateTime": "19:15:05"
            },
            "hhad": {},
            "poolList": [
              {
                "poolCode": "HAD",
                "poolStatus": "Selling",
                "single": 0,
                "allUp": 1
              }
            ],
            "sellStatus": 1,
            "isHot": 0
          },
          {
            "matchId": 2041691,
            "matchNumStr": "周五008",
            "matchDate": "2026-09-26",
            "matchTime": "02:45:00",
            "leagueAbbName": "欧国联",
            "homeTeamAbbName": "意大利",
            "awayTeamAbbName": "比利时",
            "homeRank": "[Group 12]",
            "awayRank": "[Group 13]",
            "had": {
              "a": "3.06",
              "af": "0",
              "d": "3.30",
              "df": "0",
              "goalLine": "",
              "goalLineValue": "",
              "h": "2.00",
              "hf": "0",
              "updateDate": "2026-09-25",
              "updateTime": "18:17:02"
            },
            "hhad": {
              "h": "4.15",
              "d": "3.75",
              "a": "1.61",
              "goalLine": "-1",
              "hf": "0",
              "df": "0",
              "af": "0"
            },
            "poolList": [
              {
                "poolCode": "HAD",
                "poolStatus": "Selling",
                "single": 1,
                "allUp": 1
              }
            ],
            "sellStatus": 1,
            "isHot": 0
          }
        ]
      }
    ],
    "totalCount": 2,
    "lastUpdateTime": "2026-09-25 19:15:05"
  }
}

describe('官方竞彩赔率通道', () => {
  it('规范化真实响应：场次、赔率、升降标记、让球盘与售卖属性', () => {
    const result = normalizeOfficialOdds(payload)
    expect(result.ok).toBe(true)
    expect(result.lastUpdateTime).toBe('2026-09-25 19:15:05')
    expect(result.matches).toHaveLength(2)

    const first = result.matches[0]
    expect(first).toMatchObject({
      matchNum: '周五006',
      league: '欧国联',
      home: '格鲁吉亚',
      away: '北爱尔兰',
      selling: true,
      single: false,
      allUp: true,
    })
    expect(first.had).toEqual({ home: 1.6, draw: 3.35, away: 4.85 })
    expect(first.movement).toEqual({ home: 'down', draw: 'flat', away: 'up' })
    expect(first.hhad).toBeNull()

    const second = result.matches[1]
    expect(second.hhad).toEqual({ home: 4.15, draw: 3.75, away: 1.61, goalLine: -1 })
    expect(second.single).toBe(true)
  })

  it('把一场比赛映射成倒算输入：1X2 必需，让球盘有则并入', () => {
    const { matches } = normalizeOfficialOdds(payload)
    expect(marketOddsForFit(matches[0])).toEqual({
      oneXTwo: { home: 1.6, draw: 3.35, away: 4.85 },
      handicaps: [],
    })
    expect(marketOddsForFit(matches[1]).handicaps).toEqual([
      { line: -1, win: 4.15, draw: 3.75, lose: 1.61 },
    ])
    expect(marketOddsForFit(null)).toBeNull()
  })

  it('异常响应体明确不可用，不猜测', () => {
    expect(normalizeOfficialOdds({}).ok).toBe(false)
    expect(normalizeOfficialOdds({ value: {} }).reason).toBe('unexpected_payload')
    const noOdds = { value: { matchInfoList: [{ subMatchList: [{ matchNumStr: '周五001' }] }], lastUpdateTime: 'x' } }
    expect(normalizeOfficialOdds(noOdds).reason).toBe('no_sellable_matches')
  })

  it('抓取失败按原因分类：WAF 拦截、网络错误、超时', async () => {
    expect(OFFICIAL_ODDS_ENDPOINT).toContain('/gateway/uniform/football/getMatchCalculatorV1.qry')

    const blocked = await fetchOfficialMarketOdds({
      fetchImpl: async () => ({ ok: false, status: 567, json: async () => ({}) }),
    })
    expect(blocked).toMatchObject({ ok: false, reason: 'http_567' })

    const broken = await fetchOfficialMarketOdds({
      fetchImpl: async () => { throw new Error('network down') },
    })
    expect(broken.reason).toBe('network_error')

    const timeout = await fetchOfficialMarketOdds({
      timeoutMs: 5,
      fetchImpl: (url, init) => new Promise((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }),
    })
    expect(timeout.reason).toBe('timeout')

    const good = await fetchOfficialMarketOdds({
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
    })
    expect(good.ok).toBe(true)
    expect(good.matches).toHaveLength(2)
  })
})

describe('官方比分盘（crs）解析与去水', () => {
  // 夹具形状取自真实响应；这里只保留少量单格以控制体量，键名与线上一致。
  const crsMatch = {
    matchId: '2041689',
    matchNumStr: '周五006',
    businessDate: '2026-09-25',
    leagueAbbName: '欧国联',
    homeTeamAbbName: '主队',
    awayTeamAbbName: '客队',
    had: { h: '1.60', d: '3.35', a: '4.85', hf: '-1', df: '0', af: '1' },
    hhad: {},
    crs: {
      s00s00: '10.00', s00s00f: '0',
      s01s00: '6.25', s01s00f: '-1',
      s01s01: '6.25', s01s01f: '-1',
      s02s00: '7.50', s02s00f: '-1',
      s02s01: '6.75', s02s01f: '0',
      s03s01: '14.00', s03s01f: '0',
      s00s01: '12.00', s00s01f: '1',
      s00s02: '27.00', s00s02f: '1',
      s01s02: '14.00', s01s02f: '1',
      s02s02: '17.00', s02s02f: '1',
      s1sh: '75.00', s1shf: '0',
      s1sd: '450.0', s1sdf: '0',
      s1sa: '250.0', s1saf: '0',
      updateDate: '2026-09-25', updateTime: '19:17:04',
    },
    poolList: [{ poolCode: 'HAD', poolStatus: 'Selling', single: 0, allUp: 1 }],
    sellStatus: 1,
    isHot: 0,
  }
  const payload = { value: { matchInfoList: [{ businessDate: '2026-09-25', subMatchList: [crsMatch] }], lastUpdateTime: '2026-09-25 19:26:18' } }

  it('解析单格赔率与胜/平/负「其他」打包项', () => {
    const { matches } = normalizeOfficialOdds(payload)
    const match = matches[0]
    expect(match.scores).toHaveLength(10)
    expect(match.scores.find((cell) => cell.home === 1 && cell.away === 0)).toEqual({
      home: 1, away: 0, odds: 6.25, movement: 'down',
    })
    expect(match.other).toMatchObject({ win: 75, draw: 450, away: 250 })
  })

  it('去水后单格 + 其他构成完整划分，抽水按总和减一计', () => {
    const { matches } = normalizeOfficialOdds(payload)
    const probs = marketScorelineProbabilities(matches[0])
    expect(probs.ok).toBe(true)
    expect(probs.cells).toHaveLength(10)
    const total = probs.cells.reduce((sum, cell) => sum + cell.probability, 0)
      + probs.other.win + probs.other.draw + probs.other.away
    expect(total).toBeCloseTo(1, 6)
    // 赔率越低 → 概率越高
    const oneNil = probs.cells.find((cell) => cell.home === 1 && cell.away === 0)
    const threeOne = probs.cells.find((cell) => cell.home === 3 && cell.away === 1)
    expect(oneNil.probability).toBeGreaterThan(threeOne.probability)
    // 抽水口径 = 隐含概率之和 − 1（此处为部分报价，故数值小于真盘口的 30%+）
    const impliedSum = [1 / 6.25, 1 / 6.25, 1 / 7.5, 1 / 6.75, 1 / 10, 1 / 14, 1 / 27, 1 / 14, 1 / 17, 1 / 12, 1 / 75, 1 / 450, 1 / 250]
      .reduce((sum, value) => sum + value, 0)
    expect(probs.overround).toBeCloseTo(impliedSum - 1, 3)
  })

  it('比分盘不完整时明确不可用，不伪造分布', () => {
    const thin = { ...crsMatch, crs: { s01s00: '6.25', s1sh: '75', s1sd: '450', s1sa: '250' } }
    const { matches } = normalizeOfficialOdds({ value: { matchInfoList: [{ subMatchList: [thin] }] } })
    expect(marketScorelineProbabilities(matches[0]).ok).toBe(false)
    expect(marketScorelineProbabilities(matches[0]).reason).toBe('insufficient_scoreline_quotes')
  })
})

describe('机构赔率自动回填（marketOddsForEntry）', () => {
  const fixture = {
    had: { home: 2.58, draw: 2.8, away: 2.6 },
    scores: [
      { home: 2, away: 1, odds: 8.5 },
      { home: 1, away: 1, odds: 6.2 },
    ],
    hhad: { home: 1.9, draw: 3.1, lose: 3.6, goalLine: -1 },
  }

  it('1X2 腿给对应那个结果的原样赔率', () => {
    expect(marketOddsForEntry(fixture, { market_type: 'result', parse_detail: { outcome: 'win' } })).toEqual({ odds: 2.58, source: 'had' })
    expect(marketOddsForEntry(fixture, { market_type: 'result', parse_detail: { outcome: 'draw' } })).toEqual({ odds: 2.8, source: 'had' })
    expect(marketOddsForEntry(fixture, { market_type: 'result', parse_detail: { outcome: 'lose' } })).toEqual({ odds: 2.6, source: 'had' })
  })

  it('比分腿只在比分盘真的报了那一格时才回填', () => {
    expect(marketOddsForEntry(fixture, { market_type: 'score', parse_detail: { home: 2, away: 1 } })).toEqual({ odds: 8.5, source: 'crs' })
    expect(marketOddsForEntry(fixture, { market_type: 'score', parse_detail: { home: 5, away: 0 } })).toBe(null)
  })

  it('其它盘口与缺数据的情况一律不回填（宁可不填，不瞎填）', () => {
    expect(marketOddsForEntry(fixture, { market_type: 'total', parse_detail: { line: 2.5, direction: 'over' } })).toBe(null)
    expect(marketOddsForEntry(null, { market_type: 'result', parse_detail: { outcome: 'win' } })).toBe(null)
    expect(marketOddsForEntry({ scores: [] }, { market_type: 'score', parse_detail: { home: 2, away: 1 } })).toBe(null)
  })
})
