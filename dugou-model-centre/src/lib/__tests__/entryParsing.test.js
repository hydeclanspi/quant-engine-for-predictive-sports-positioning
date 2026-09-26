/**
 * 投注项语义解析 - 单元测试
 * Tests for entry-name normalization and market-type semantic parsing.
 *
 * entryParsing.js 把用户自由输入的投注项（"2-1" / "胜平" / "大2.5" …）
 * 归一化并分类到结构化盘口类型，是自然语言录入管线的关键一环。
 */

import {
  normalizeEntryName,
  parseEntrySemantic,
  normalizeEntryRecord,
  normalizeEntries,
  getPrimaryEntryMarket,
  trimTrailingEmptyEntries,
} from '../entryParsing'

describe('投注项语义解析', () => {
  // ==========================================================================
  // 名称归一化
  // ==========================================================================
  describe('normalizeEntryName', () => {
    it('全角标点转半角', () => {
      expect(normalizeEntryName('曼城，平局')).toBe('曼城, 平局')
    })

    it('折叠多余空白', () => {
      expect(normalizeEntryName('  arsenal    win  ')).toBe('arsenal win')
    })

    it('各种破折号统一为半角连字符', () => {
      expect(normalizeEntryName('a—b')).toBe('a-b')
    })

    it('剥离首尾的逗号分号空白', () => {
      expect(normalizeEntryName('；曼城；')).toBe('曼城')
    })

    it('空值返回空字符串', () => {
      expect(normalizeEntryName(null)).toBe('')
      expect(normalizeEntryName(undefined)).toBe('')
    })
  })

  // ==========================================================================
  // 语义分类
  // ==========================================================================
  describe('parseEntrySemantic', () => {
    it('比分盘：2-1 与 2:1 等价', () => {
      const dash = parseEntrySemantic('2-1')
      expect(dash.marketType).toBe('score')
      expect(dash.semanticKey).toBe('2-1')
      expect(dash.detail).toEqual({ home: 2, away: 1 })
      expect(parseEntrySemantic('2:1').semanticKey).toBe('2-1')
    })

    it('半全场：胜平 → win-draw', () => {
      const r = parseEntrySemantic('胜平')
      expect(r.marketType).toBe('half_full')
      expect(r.semanticKey).toBe('win-draw')
      expect(r.detail).toEqual({ half: 'win', full: 'draw' })
    })

    it('半全场：紧凑英文 WD → win-draw', () => {
      expect(parseEntrySemantic('WD').semanticKey).toBe('win-draw')
    })

    it('大小球：over2.5 → over:2.5', () => {
      const r = parseEntrySemantic('over2.5')
      expect(r.marketType).toBe('total')
      expect(r.semanticKey).toBe('over:2.5')
      expect(r.detail).toEqual({ direction: 'over', line: 2.5 })
    })

    it('大小球：中文「大2.5」', () => {
      expect(parseEntrySemantic('大2.5').semanticKey).toBe('over:2.5')
    })

    it('赛果：单独的 win', () => {
      const r = parseEntrySemantic('win')
      expect(r.marketType).toBe('result')
      expect(r.semanticKey).toBe('win')
    })

    it('无法识别的文本归类为 other', () => {
      const r = parseEntrySemantic('梅西首开纪录')
      expect(r.marketType).toBe('other')
    })

    it('每个结果都带上中文盘口标签', () => {
      expect(parseEntrySemantic('2-1').marketLabel).toBe('比分')
      expect(parseEntrySemantic('over2.5').marketLabel).toBe('大小球')
    })
  })

  // ==========================================================================
  // 单条记录归一化
  // ==========================================================================
  describe('normalizeEntryRecord', () => {
    it('解析名称并附加结构化字段', () => {
      const rec = normalizeEntryRecord({ name: '2-1', odds: '3.5' })
      expect(rec.name).toBe('2-1')
      expect(rec.odds).toBeCloseTo(3.5, 6)
      expect(rec.market_type).toBe('score')
      expect(rec.semantic_key).toBe('2-1')
    })

    it('odds 缺失时回退到 fallbackOdds', () => {
      const rec = normalizeEntryRecord({ name: 'win' }, 1.85)
      expect(rec.odds).toBeCloseTo(1.85, 6)
    })

    it('接受裸字符串作为输入', () => {
      const rec = normalizeEntryRecord('over2.5')
      expect(rec.market_type).toBe('total')
    })
  })

  // ==========================================================================
  // 批量归一化与主盘口推断
  // ==========================================================================
  describe('normalizeEntries / getPrimaryEntryMarket', () => {
    it('从分隔文本切分多个投注项', () => {
      const entries = normalizeEntries(null, 'win|平', 2.0)
      expect(entries).toHaveLength(2)
      expect(entries[0].market_type).toBe('result')
    })

    it('数组优先于文本', () => {
      const entries = normalizeEntries([{ name: '2-1' }, { name: '1-0' }], 'win', 2.0)
      expect(entries).toHaveLength(2)
      expect(entries.every((e) => e.market_type === 'score')).toBe(true)
    })

    it('主盘口取出现次数最多的类型', () => {
      const primary = getPrimaryEntryMarket([
        { name: '2-1' },
        { name: '1-0' },
        { name: 'win' },
      ])
      expect(primary.marketType).toBe('score')
      expect(primary.marketLabel).toBe('比分')
    })

    it('空输入回退到 other', () => {
      const primary = getPrimaryEntryMarket([], '')
      expect(primary.marketType).toBe('other')
    })
  })
})

describe('Entry 尾巴空行（投前双槽 / 投后导入）', () => {
  it('砍掉尾巴上完全空白的行，只留一条', () => {
    const rows = trimTrailingEmptyEntries([{ name: '', odds: '' }, { name: '', odds: '' }])
    expect(rows).toHaveLength(1)
  })

  it('有内容就留着，中间的空白行也原样保留', () => {
    const rows = trimTrailingEmptyEntries([
      { name: '主胜', odds: '3.41' },
      { name: '', odds: '' },
      { name: '2-1', odds: '' },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.name)).toEqual(['主胜', '', '2-1'])
    // 只填空、没填名 也算有内容
    expect(trimTrailingEmptyEntries([{ name: '', odds: '2' }, { name: '', odds: '' }])).toHaveLength(1)
  })

  it('空数组与非法输入不会炸', () => {
    expect(trimTrailingEmptyEntries([])).toEqual([])
    expect(trimTrailingEmptyEntries(null)).toEqual([])
  })
})
