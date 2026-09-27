import { describe, expect, it } from 'vitest'
import { buildTeamHistory, findTeamHistory, flipRecordText } from '../teamHistory'

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
    // 客场视角：比分也翻过来（原 2-1 → 该队 1 球、对手 2 球）
    expect(away.predictedScore).toEqual({ home: 1, away: 2 })
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

describe('客场记录自动翻译（主队视角 → 该队视角）', () => {
  const awayMatch = [
    {
      id: 'inv_away',
      status: 'win',
      created_at: '2026-09-15T10:00:00.000Z',
      matches: [
        {
          id: 'm1',
          home_team: '桑德兰',
          away_team: '阿森纳',
          entries: [{ name: 'lose', odds: '1.38' }],
          entry_text: 'lose',
          results: '0-2',
          is_correct: true,
        },
        {
          id: 'm2',
          home_team: '曼城',
          away_team: '阿森纳',
          entries: [{ name: '-1 lose', odds: '2.10' }],
          entry_text: '-1 lose',
          results: '2-1',
          is_correct: false,
        },
        {
          id: 'm3',
          home_team: '曼城',
          away_team: '阿森纳',
          entries: [{ name: '2-1', odds: '8.5' }],
          entry_text: '2-1',
          results: '2-1',
          is_correct: true,
        },
      ],
    },
  ]

  it('挂主队名下照原样；挂客队名下翻过来', () => {
    const map = buildTeamHistory(awayMatch)
    const home = findTeamHistory(map, '桑德兰')[0]
    expect(home.entryText).toBe('lose')
    expect(home.resultText).toBe('0-2')
    expect(home.actualScore).toEqual({ home: 0, away: 2 })

    const away = findTeamHistory(map, '阿森纳')
    expect(away.map((row) => row.entryText)).toEqual(['win', '+1 win', '1-2'])
    expect(away[0].resultText).toBe('2-0')
    expect(away[0].actualScore).toEqual({ home: 2, away: 0 })
    // 中没中是我的判断，不跟着翻
    expect(away.map((row) => row.isCorrect)).toEqual([true, false, true])
  })

  it('翻译函数：胜负词、让球加减号、比分一起翻', () => {
    expect(flipRecordText('lose')).toBe('win')
    expect(flipRecordText('WIN')).toBe('lose')
    expect(flipRecordText('draw')).toBe('draw')
    expect(flipRecordText('-1 lose')).toBe('+1 win')
    expect(flipRecordText('+2 win')).toBe('-2 lose')
    expect(flipRecordText('0-2')).toBe('2-0')
    expect(flipRecordText('3-0/4-0')).toBe('0-3/0-4')
    expect(flipRecordText('大2.5')).toBe('大2.5')
    expect(flipRecordText('')).toBe('')
  })
})
