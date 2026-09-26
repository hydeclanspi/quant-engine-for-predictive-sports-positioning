import { describe, expect, it } from 'vitest'
import { buildTeamHistory, findTeamHistory } from '../teamHistory'

const investments = [
  {
    id: 'inv_old',
    status: 'win',
    created_at: '2026-09-10T10:00:00.000Z',
    matches: [
      {
        id: 'm1',
        home_team: '阿森纳',
        away_team: '埃弗顿',
        entries: [{ name: '主胜', odds: '1.80' }],
        note: '主队状态好',
        post_note: '前 30 分钟就解决',
        results: '2-1',
        is_correct: true,
        match_rating: '0.64',
        match_rep: '0.2',
      },
    ],
  },
  {
    id: 'inv_new',
    status: 'lose',
    created_at: '2026-09-20T10:00:00.000Z',
    matches: [
      {
        id: 'm2',
        home_team: '利物浦',
        away_team: '阿森纳',
        entry_text: '2-1',
        entries: [{ name: '2-1', odds: '8.50' }],
        note: '客队中卫缺阵',
        post_note: '比分差一个球',
        results: '1-1',
        is_correct: false,
      },
    ],
  },
  {
    id: 'inv_pending',
    status: 'pending',
    created_at: '2026-09-25T10:00:00.000Z',
    matches: [
      {
        id: 'm3',
        home_team: '阿森纳',
        away_team: '曼城',
        entries: [{ name: '大2.5', odds: '1.95' }],
        note: '待赛登记',
      },
    ],
  },
]

describe('队伍过往记录（投前 hero 用）', () => {
  it('按球队聚合、最新在前，主客/对手/备注/复盘/结果都带上', () => {
    const map = buildTeamHistory(investments)
    const arsenal = findTeamHistory(map, '阿森纳')
    expect(arsenal).toHaveLength(3)
    expect(arsenal.map((row) => row.id)).toEqual(['inv_pending:m3', 'inv_new:m2', 'inv_old:m1'])

    const latest = arsenal[0]
    expect(latest.dateLabel).toBe('26-09-25')
    expect(latest.venue).toBe('home')
    expect(latest.opponent).toBe('曼城')
    expect(latest.entryText).toBe('大2.5')
    expect(latest.note).toBe('待赛登记')
    expect(latest.settled).toBe(false)
    expect(latest.isCorrect).toBe(null)

    const away = arsenal[1]
    expect(away.venue).toBe('away')
    expect(away.opponent).toBe('利物浦')
    expect(away.predictedScore).toEqual({ home: 2, away: 1 })
    expect(away.actualScore).toEqual({ home: 1, away: 1 })
    expect(away.isCorrect).toBe(false)
    expect(away.postNote).toBe('比分差一个球')

    const everton = findTeamHistory(map, '埃弗顿')
    expect(everton).toHaveLength(1)
    expect(everton[0].venue).toBe('away')
    expect(everton[0].opponent).toBe('阿森纳')
    expect(everton[0].isCorrect).toBe(true)
  })

  it('取记录的兜底：简称 / 队名库里对得上的写法也能取到', () => {
    const map = buildTeamHistory(investments)
    expect(findTeamHistory(map, '阿森纳队').length).toBe(3)
    expect(findTeamHistory(map, '不存在的队')).toEqual([])
    expect(findTeamHistory(null, '阿森纳')).toEqual([])
  })

  it('归档的投资不进入记录', () => {
    const map = buildTeamHistory([{ ...investments[0], is_archived: true }])
    expect(findTeamHistory(map, '阿森纳')).toEqual([])
  })
})
