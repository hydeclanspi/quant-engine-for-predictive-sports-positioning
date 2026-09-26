import { describe, expect, it } from 'vitest'
import {
  CELL_MODE_FACTORS,
  buildOpinionMatchProfile,
  cycleCellMode,
  defaultSigmaForWindow,
  defaultWindowForGoals,
  expectedGoals,
  jointScoreCells,
  legOutcomeForCell,
  matchOfficialFixture,
  shiftWeights,
  teamNamesMatch,
  weightsFromSlider,
} from '../preMatchOpinion'

const sum = (list) => list.reduce((acc, value) => acc + value, 0)

describe('投前进球分布（区间 + 浓度）', () => {
  it('区间默认 = 登记比分 ±1 球，正态落在区间内、区间外为零', () => {
    expect(defaultWindowForGoals(2)).toEqual([1, 3])
    expect(defaultWindowForGoals(0)).toEqual([0, 1])
    expect(defaultWindowForGoals(6)).toEqual([5, 6])
    expect(defaultSigmaForWindow(1, 3)).toBe(1)

    const weights = weightsFromSlider({ lo: 1, hi: 3 })
    expect(weights).toHaveLength(7)
    expect(sum(weights)).toBeCloseTo(1, 10)
    expect(weights[0]).toBe(0)
    expect(weights[4]).toBe(0)
    // 峰在中点 2 球
    expect(weights[2]).toBeGreaterThan(weights[1])
    expect(weights[1]).toBeCloseTo(weights[3], 10)
  })

  it('点格子：加权抬高该格浓度，压低清掉它，第三下回到默认', () => {
    const base = weightsFromSlider({ lo: 1, hi: 3 })
    const boosted = weightsFromSlider({ lo: 1, hi: 3, modes: { 1: 'boost' } })
    expect(boosted[1]).toBeGreaterThan(base[1])
    expect(sum(boosted)).toBeCloseTo(1, 10)

    const zeroed = weightsFromSlider({ lo: 1, hi: 3, modes: { 2: 'zero' } })
    expect(zeroed[2]).toBeLessThan(base[2] * 0.1)
    expect(sum(zeroed)).toBeCloseTo(1, 10)

    // 区间外的格子默认是 0，但手动点过就能拿到权重（手动覆盖区间）
    expect(base[5]).toBe(0)
    const boostedOutside = weightsFromSlider({ lo: 1, hi: 3, modes: { 5: 'boost' } })
    expect(boostedOutside[5]).toBeGreaterThan(0)
    expect(sum(boostedOutside)).toBeCloseTo(1, 10)
    expect(CELL_MODE_FACTORS.boost).toBeGreaterThan(CELL_MODE_FACTORS.auto)
  })

  it('浓度循环：默认 → 加权 → 压低 → 默认', () => {
    expect(cycleCellMode('auto')).toBe('boost')
    expect(cycleCellMode('boost')).toBe('zero')
    expect(cycleCellMode('zero')).toBe('auto')
  })

  it('θ 修正 = 整条分布平移，保住形状、不丢质量', () => {
    const weights = weightsFromSlider({ lo: 1, hi: 3 })
    const before = expectedGoals(weights)
    const shifted = shiftWeights(weights, 0.5)
    expect(sum(shifted)).toBeCloseTo(1, 10)
    expect(expectedGoals(shifted)).toBeCloseTo(before + 0.5, 6)

    const down = shiftWeights(weights, -1)
    expect(expectedGoals(down)).toBeCloseTo(before - 1, 6)

    // 原始分布不被就地修改
    expect(expectedGoals(weights)).toBeCloseTo(before, 10)
  })

  it('两侧分布 → 联合比分分布，和仍为 1', () => {
    const home = weightsFromSlider({ lo: 1, hi: 3 })
    const away = weightsFromSlider({ lo: 0, hi: 2 })
    const cells = jointScoreCells(home, away)
    expect(sum(cells.map((cell) => cell.p))).toBeCloseTo(1, 10)
    const cell = cells.find((row) => row.home === 2 && row.away === 1)
    expect(cell.p).toBeCloseTo(home[2] * away[1], 10)
    // 区间外的组合不出现在分布里
    expect(cells.some((row) => row.home > 3 || row.away > 2)).toBe(false)
  })
})

describe('机构场次对位（队名匹配）', () => {
  it('队名：全等 / 简称 / 队名库别名都算同一支队', () => {
    expect(teamNamesMatch('阿森纳', '阿森纳')).toBe(true)
    expect(teamNamesMatch('阿森纳', '阿森纳队')).toBe(true)
    expect(teamNamesMatch('阿森纳', 'Arsenal')).toBe(true)
    expect(teamNamesMatch('阿森纳', '切尔西')).toBe(false)
    expect(teamNamesMatch('', '阿森纳')).toBe(false)
  })

  it('主场 / 客队都对位；主客对调也算命中并标记 swapped', () => {
    const matches = [
      { matchId: 'A', home: '阿森纳', away: '埃弗顿', selling: true },
      { matchId: 'B', home: '曼联', away: '曼城', selling: true },
    ]
    const straight = matchOfficialFixture(matches, '阿森纳', '埃弗顿')
    expect(straight.match.matchId).toBe('A')
    expect(straight.swapped).toBe(false)

    const swapped = matchOfficialFixture(matches, '埃弗顿', '阿森纳')
    expect(swapped.match.matchId).toBe('A')
    expect(swapped.swapped).toBe(true)

    expect(matchOfficialFixture(matches, '利物浦', '热刺')).toBe(null)
  })

  it('同一对球队多场时优先在售场次，其余作为备选返回', () => {
    const matches = [
      { matchId: 'OLD', home: '阿森纳', away: '埃弗顿', selling: false },
      { matchId: 'NEW', home: '阿森纳', away: '埃弗顿', selling: true },
    ]
    const result = matchOfficialFixture(matches, '阿森纳', '埃弗顿')
    expect(result.match.matchId).toBe('NEW')
    expect(result.alternatives.map((row) => row.matchId)).toEqual(['OLD'])
  })
})

describe('同场多腿：每条腿在我的分布里中不中', () => {
  const grid = () => {
    const home = weightsFromSlider({ lo: 1, hi: 3 })
    const away = weightsFromSlider({ lo: 0, hi: 2 })
    return jointScoreCells(home, away)
  }
  const resultEntry = { name: '主胜', odds: 2, market_type: 'result', parse_detail: { outcome: 'win' } }
  const scoreEntry = { name: '2-1', odds: 8.5, market_type: 'score', parse_detail: { home: 2, away: 1 } }

  it('结果腿：命中率 = 我的分布里主胜那部分', () => {
    const profile = buildOpinionMatchProfile({ entries: [resultEntry], cells: grid() })
    expect(profile.supported).toBe(true)
    expect(profile.hitProbability).toBeCloseTo(0.6772, 3)
    expect(profile.states.find((state) => state.gross === 2).probability).toBeCloseTo(0.6772, 3)
    expect(profile.states.find((state) => state.isMiss).probability).toBeCloseTo(0.3228, 3)
  })

  it('结果 + 比分一起下：union = 主胜，比分中时两腿都收', () => {
    const profile = buildOpinionMatchProfile({ entries: [resultEntry, scoreEntry], cells: grid() })
    expect(profile.supported).toBe(true)
    // 2-1 是主胜的子集，所以"至少中一条"就是主胜
    expect(profile.hitProbability).toBeCloseTo(0.6772, 3)
    const both = profile.states.find((state) => state.id === 'leg_0+leg_1')
    expect(both.probability).toBeCloseTo(0.2042, 3)
    // 每条腿各占一半权重 → 两腿都中：0.5×2.0 + 0.5×8.5
    expect(both.gross).toBeCloseTo(5.25, 6)
    const onlyResult = profile.states.find((state) => state.id === 'leg_0')
    expect(onlyResult.probability).toBeCloseTo(0.4730, 3)
    expect(onlyResult.gross).toBeCloseTo(1, 6)
  })

  it('整数让球/大小球线的走盘算退款，不算全输', () => {
    const pushEntry = { name: '大2', odds: 1.95, market_type: 'total', parse_detail: { line: 2, direction: 'over' } }
    expect(legOutcomeForCell(pushEntry, 2, 0)).toBe('push')
    expect(legOutcomeForCell(pushEntry, 3, 0)).toBe('hit')
    expect(legOutcomeForCell(pushEntry, 1, 0)).toBe('miss')

    const profile = buildOpinionMatchProfile({ entries: [pushEntry], cells: grid() })
    expect(profile.supported).toBe(true)
    expect(profile.hasPush).toBe(true)
    const pushState = profile.states.find((state) => state.id.startsWith('push_'))
    expect(pushState.probability).toBeGreaterThan(0)
    expect(pushState.gross).toBeCloseTo(1, 6)
  })

  it('判不了的盘口（半全场等）整体放弃覆盖，交给生产管线', () => {
    const weird = { name: '半全场 主/主', odds: 3.1, market_type: 'half_full', parse_detail: { home: 'win', away: 'win' } }
    expect(legOutcomeForCell(weird, 2, 1)).toBe('unsupported')
    expect(buildOpinionMatchProfile({ entries: [weird], cells: grid() }).supported).toBe(false)
    expect(buildOpinionMatchProfile({ entries: [resultEntry], cells: [] }).supported).toBe(false)
  })

  it('每条腿带上自己的 odds（可空）时也能算：空赔率只影响赔付，不影响命中率', () => {
    const noOdds = { name: '2-1', odds: undefined, market_type: 'score', parse_detail: { home: 2, away: 1 } }
    const profile = buildOpinionMatchProfile({ entries: [noOdds], cells: grid() })
    expect(profile.supported).toBe(true)
    expect(profile.hitProbability).toBeCloseTo(0.2042, 3)
    expect(profile.states.find((state) => !state.isMiss).gross).toBeCloseTo(0, 6)
  })
})
