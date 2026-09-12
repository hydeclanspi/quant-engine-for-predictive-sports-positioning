/**
 * 战报周期派生层单元测试（lib/warReport.js）。
 *
 * 守住三件事：
 *   1. 周期边界与蓄水池（getReservoirState）口径严格一致 —— 两边看到同一条分界线；
 *   2. 结算时的「周期划拨」注资落在新周期而非被关掉的那个周期；
 *   3. 跨联赛串关按腿数均摊，不整笔归给某一个联赛。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { config: {}, investments: [], titles: [] }

vi.mock('../localData', () => ({
  getSystemConfig: () => state.config,
  getInvestments: () => state.investments,
  getCycleTitles: () => state.titles,
}))

const { getCyclePeriods, getWarReport, STAKE_BUCKETS, gradeForRoi, __testables } = await import('../warReport')

const iso = (value) => new Date(value).toISOString()

const makeInvestment = (id, createdAt, { inputs = 100, profit = null, status = 'pending', matches = [] } = {}) => ({
  id,
  created_at: iso(createdAt),
  inputs,
  profit,
  status,
  revenues: profit == null ? 0 : inputs + profit,
  combined_odds: 2.5,
  matches: matches.length > 0 ? matches : [{ home_team: '曼城', away_team: '阿森纳', entry_text: '胜', odds: 2.5, mode: '常规' }],
})

beforeEach(() => {
  state.config = { initialCapital: 600, capitalInjections: [], poolSettlements: [], cycleTitles: [] }
  state.investments = []
  state.titles = []
  __testables.bumpRevision() // 各用例之间不共享缓存
})

describe('周期划分', () => {
  it('N 次结算切出 N+1 个周期，最新的排在最前', () => {
    state.config.poolSettlements = [
      { id: 's1', created_at: iso('2026-03-01T00:00:00Z'), newCapital: 0 },
      { id: 's2', created_at: iso('2026-04-01T00:00:00Z'), newCapital: 0 },
    ]

    const { periods, currentId } = getCyclePeriods()

    expect(periods).toHaveLength(3)
    expect(periods.map((p) => p.ordinal)).toEqual([3, 2, 1])
    expect(periods[0].isOpen).toBe(true)
    expect(periods[0].id).toBe('cycle_s2')
    expect(currentId).toBe('cycle_s2')
    expect(periods[2].isGenesis).toBe(true)
    expect(periods[2].id).toBe('cycle_genesis')
  })

  it('尚无结算时只有一个进行中的创世周期', () => {
    const { periods } = getCyclePeriods()
    expect(periods).toHaveLength(1)
    expect(periods[0].isGenesis).toBe(true)
    expect(periods[0].isOpen).toBe(true)
  })

  it('左开右闭：结算当刻的投注归入被关掉的那个周期', () => {
    state.config.poolSettlements = [{ id: 's1', created_at: iso('2026-03-01T00:00:00Z'), newCapital: 0 }]
    state.investments = [
      makeInvestment('before', '2026-02-28T00:00:00Z', { profit: 10, status: 'win' }),
      makeInvestment('boundary', '2026-03-01T00:00:00Z', { profit: 20, status: 'win' }),
      makeInvestment('after', '2026-03-02T00:00:00Z', { profit: 30, status: 'win' }),
    ]

    const { periods } = getCyclePeriods()
    const [open, closed] = periods

    expect(closed.settledCount).toBe(2) // before + boundary
    expect(closed.profit).toBe(30)
    expect(open.settledCount).toBe(1) // after
    expect(open.profit).toBe(30)
  })
})

describe('本金口径 —— 与 getReservoirState 对齐', () => {
  it('创世周期本金 = initialCapital − 全部注资 + 本周期内注资', () => {
    state.config.initialCapital = 900 // 600 起始 + 后来注资 300
    state.config.capitalInjections = [{ id: 'i1', amount: 300, created_at: iso('2026-05-01T00:00:00Z') }]

    const { periods } = getCyclePeriods()

    // 原始本金 600，周期内又注资 300 → 900
    expect(periods[0].baseCapital).toBe(900)
    expect(periods[0].injected).toBe(300)
  })

  it('结算划拨（+1ms）落在新周期，不算进被关掉的周期', () => {
    const settleAt = new Date('2026-03-01T00:00:00Z').getTime()
    state.config.initialCapital = 600 + 250
    state.config.poolSettlements = [{ id: 's1', created_at: new Date(settleAt).toISOString(), newCapital: 250 }]
    state.config.capitalInjections = [
      { id: 'inj_linked', amount: 250, note: '周期结算划拨', created_at: new Date(settleAt + 1).toISOString() },
    ]

    const { periods } = getCyclePeriods()
    const [open, genesis] = periods

    expect(genesis.injected).toBe(0)
    expect(genesis.baseCapital).toBe(600) // 850 − 250 注资 = 600 原始本金
    expect(open.injected).toBe(250)
    expect(open.baseCapital).toBe(250)
    expect(open.allocation).toBe(250)
  })
})

describe('周期命名', () => {
  it('无自定义标题时只显示 S 序数', () => {
    const { periods } = getCyclePeriods()
    expect(periods[0].name).toBe('S1')
    expect(periods[0].title).toBe('')
    expect(periods[0].isCustomName).toBe(false)
  })

  it('标题台账按周期 id 生效，序数始终由界面追加', () => {
    state.config.poolSettlements = [{ id: 's1', created_at: iso('2026-03-01T00:00:00Z'), newCapital: 0 }]
    state.titles = [{ id: 'cycle_s1', title: '春季战役' }]

    const { periods } = getCyclePeriods()

    expect(periods[0].name).toBe('S2 春季战役')
    expect(periods[0].title).toBe('春季战役')
    expect(periods[0].isCustomName).toBe(true)
    expect(periods[1].name).toBe('S1') // 创世周期未命名
  })

  it('兼容旧数据里的 name 字段，但不把序数写入 title', () => {
    state.titles = [{ id: 'cycle_genesis', name: 'Hello World' }]

    const { periods } = getCyclePeriods()

    expect(periods[0].title).toBe('Hello World')
    expect(periods[0].name).toBe('S1 Hello World')
  })
})

describe('战报统计', () => {
  it('ROI 只按已结算口径算，待结算不污染分母', () => {
    state.investments = [
      makeInvestment('a', '2026-05-01T00:00:00Z', { inputs: 100, profit: 50, status: 'win' }),
      makeInvestment('b', '2026-05-02T00:00:00Z', { inputs: 100, profit: -100, status: 'lose' }),
      makeInvestment('c', '2026-05-03T00:00:00Z', { inputs: 500, status: 'pending' }),
    ]

    const report = getWarReport()

    expect(report.kpi.settledCount).toBe(2)
    expect(report.kpi.pendingCount).toBe(1)
    expect(report.kpi.totalInputs).toBe(200) // 待结算的 500 不计入
    expect(report.kpi.pendingInputs).toBe(500)
    expect(report.kpi.profit).toBe(-50)
    expect(report.kpi.roi).toBe(-25)
    expect(report.kpi.hitRate).toBe(50)
  })

  it('显式 pending 一票否决 —— profit 占位为 0 的待结算单不算进已结算样本', () => {
    state.investments = [
      makeInvestment('done', '2026-05-01T00:00:00Z', { inputs: 100, profit: 100, status: 'win' }),
      // 待结算页按 status 判定为「待结」，战报必须与之一致
      makeInvestment('waiting', '2026-05-02T00:00:00Z', { inputs: 50, profit: 0, status: 'pending' }),
    ]

    const report = getWarReport()

    expect(report.kpi.settledCount).toBe(1)
    expect(report.kpi.pendingCount).toBe(1)
    expect(report.kpi.totalInputs).toBe(100)
    expect(report.kpi.hitRate).toBe(100)
    expect(report.entries.find((row) => row.id === 'waiting').settled).toBe(false)
  })

  it('跨联赛串关按腿数均摊，不整笔归给某一个联赛', () => {
    state.investments = [
      makeInvestment('x', '2026-05-01T00:00:00Z', {
        inputs: 100,
        profit: 100,
        status: 'win',
        matches: [
          { home_team: '曼城', away_team: '阿森纳', entry_text: '胜', odds: 2, mode: '常规' }, // 英超
          { home_team: '拜仁慕尼黑', away_team: '多特蒙德', entry_text: '胜', odds: 2, mode: '常规' }, // 德甲
        ],
      }),
    ]

    const report = getWarReport()
    const byLeague = Object.fromEntries(report.leagues.map((row) => [row.key, row]))

    expect(report.leagues).toHaveLength(2)
    expect(byLeague['英超'].profit).toBe(50)
    expect(byLeague['英超'].inputs).toBe(50)
    expect(byLeague['德甲'].profit).toBe(50)
    // 均摊后各联赛 ROI 与整笔 ROI 一致
    expect(byLeague['英超'].roi).toBe(100)
  })

  it('注额档按 50 一级切分，边界值归入上一档的开区间', () => {
    expect(__testables.getStakeBucketKey(0)).toBe('0-50')
    expect(__testables.getStakeBucketKey(49.99)).toBe('0-50')
    expect(__testables.getStakeBucketKey(50)).toBe('50-100')
    expect(__testables.getStakeBucketKey(199)).toBe('150-200')
    expect(__testables.getStakeBucketKey(300)).toBe('300+')
    expect(__testables.getStakeBucketKey(99999)).toBe('300+')
    expect(STAKE_BUCKETS).toHaveLength(6)
  })

  it('注额档汇总各自独立成行，空档位保留为 0', () => {
    state.investments = [
      makeInvestment('s1', '2026-05-01T00:00:00Z', { inputs: 30, profit: 30, status: 'win' }),
      makeInvestment('s2', '2026-05-02T00:00:00Z', { inputs: 80, profit: -80, status: 'lose' }),
    ]

    const report = getWarReport()
    const byKey = Object.fromEntries(report.stakeBuckets.map((row) => [row.key, row]))

    expect(report.stakeBuckets).toHaveLength(6)
    expect(byKey['0-50'].roi).toBe(100)
    expect(byKey['50-100'].roi).toBe(-100)
    expect(byKey['100-150'].count).toBe(0)
    expect(byKey['100-150'].roi).toBe(0)
  })

  it('分自然周以周一为起点分组', () => {
    // 2026-05-04 是周一，2026-05-10 是周日 —— 同一周；05-11 进入下一周
    state.investments = [
      makeInvestment('w1', '2026-05-04T10:00:00Z', { inputs: 100, profit: 10, status: 'win' }),
      makeInvestment('w2', '2026-05-10T10:00:00Z', { inputs: 100, profit: 20, status: 'win' }),
      makeInvestment('w3', '2026-05-11T10:00:00Z', { inputs: 100, profit: -30, status: 'lose' }),
    ]

    const report = getWarReport()

    expect(report.weeks).toHaveLength(2)
    expect(report.weeks[0].profit).toBe(30)
    expect(report.weeks[1].profit).toBe(-30)
    // 正序：早的周在前
    expect(report.weeks[0].startTs).toBeLessThan(report.weeks[1].startTs)
  })

  it('逐笔流水带回结算界面填入的 results / is_correct', () => {
    state.investments = [
      makeInvestment('r1', '2026-05-01T00:00:00Z', {
        inputs: 100,
        profit: 150,
        status: 'win',
        matches: [
          { home_team: '曼城', away_team: '阿森纳', entry_text: '2-1', odds: 8, mode: '常规', results: '2-1', is_correct: true },
        ],
      }),
    ]

    const report = getWarReport()

    expect(report.entries).toHaveLength(1)
    expect(report.entries[0].matches[0].results).toBe('2-1')
    expect(report.entries[0].matches[0].isCorrect).toBe(true)
    expect(report.entries[0].settled).toBe(true)
    expect(report.entries[0].roi).toBe(150)
  })

  it('最大回撤按周期内净值峰谷计算', () => {
    state.investments = [
      makeInvestment('d1', '2026-05-01T00:00:00Z', { inputs: 100, profit: 100, status: 'win' }), // +100
      makeInvestment('d2', '2026-05-02T00:00:00Z', { inputs: 100, profit: -60, status: 'lose' }), // 峰 100 → 40
      makeInvestment('d3', '2026-05-03T00:00:00Z', { inputs: 100, profit: -20, status: 'lose' }), // → 20，回撤 80
    ]

    const report = getWarReport()
    expect(report.kpi.maxDrawdown).toBe(80)
    expect(report.kpi.worstLoseStreak).toBe(2)
    expect(report.kpi.bestWinStreak).toBe(1)
  })

  it('汇总收入、最大升幅与单笔 ROI 的均值/中位数', () => {
    state.investments = [
      makeInvestment('m1', '2026-05-01T00:00:00Z', { inputs: 100, profit: 50, status: 'win' }), // ROI 50%
      makeInvestment('m2', '2026-05-02T00:00:00Z', { inputs: 50, profit: -50, status: 'lose' }), // ROI -100%
      makeInvestment('m3', '2026-05-03T00:00:00Z', { inputs: 100, profit: 100, status: 'win' }), // ROI 100%
    ]

    const report = getWarReport()

    expect(report.kpi.totalRevenue).toBe(350)
    expect(report.kpi.maxRunup).toBe(100)
    expect(report.kpi.medianRoi).toBe(50)
    expect(report.kpi.medianWinningRoi).toBe(75)
    expect(report.kpi.averageRoi).toBe(16.67)
    expect(report.kpi.averageWinningRoi).toBe(75)
    expect(report.curve.filter((point) => point.kind === 'bet').map((point) => point.investmentNumber)).toEqual([1, 2, 3])
  })
})

describe('战绩评级', () => {
  it('按 ROI 落到 S/A/B/C/D 五档', () => {
    expect(gradeForRoi(45, 10).grade).toBe('S')
    expect(gradeForRoi(20, 10).grade).toBe('A')
    expect(gradeForRoi(8, 10).grade).toBe('B')
    expect(gradeForRoi(0, 10).grade).toBe('C')
    expect(gradeForRoi(-30, 10).grade).toBe('D')
  })

  it('尚无已结算样本时不给评级', () => {
    expect(gradeForRoi(0, 0).grade).toBe('—')
    expect(gradeForRoi(0, 0).title).toBe('未开战')
  })
})
