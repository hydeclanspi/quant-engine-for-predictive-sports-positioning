import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PreMatchBoard from '../../components/PreMatchBoard'
import PreMatchHero, { PreMatchRecords } from '../../components/PreMatchHero'
import PreScoreSlider from '../../components/PreScoreSlider'
import { weightsFromSlider } from '../../lib/preMatchOpinion'

// SSR 会在相邻文本节点之间插 <!-- -->，断言前先去掉，读起来才是界面上的那句话。
const strip = (html) => html.replace(/<!-- -->/g, '')

const scoreEntry = {
  name: '2-1',
  odds: 8.5,
  market_type: 'score',
  parse_detail: { home: 2, away: 1 },
}

describe('投前研究板（Pre-Match Board）', () => {
  it('没写比分时整块是提示，不展开滑轨与云图', () => {
    const html = strip(renderToStaticMarkup(
      <PreMatchBoard matchIndex={0} homeTeam="阿森纳" awayTeam="埃弗顿" entries={[]} detectedScore={null} />,
    ))
    expect(html).toContain('data-testid="pre-match-board-idle"')
    expect(html).not.toContain('data-testid="pre-match-board"')
    expect(html).not.toContain('data-testid="pre-match-cloud"')
    expect(html).not.toContain('data-testid="pre-slider-home"')
  })

  it('写了 2-1：区间默认 ±1 球，出两条滑轨、云图与等价盘口', () => {
    const html = strip(renderToStaticMarkup(
      <PreMatchBoard matchIndex={0} homeTeam="阿森纳" awayTeam="埃弗顿" entries={[scoreEntry]} detectedScore={{ home: 2, away: 1 }} />,
    ))
    expect(html).toContain('data-testid="pre-match-board"')
    expect(html).toContain('data-testid="pre-slider-home"')
    expect(html).toContain('data-testid="pre-slider-away"')
    expect(html).toContain('data-testid="pre-match-cloud"')
    expect(html).toContain('区间 1–3 球')
    expect(html).toContain('区间 0–2 球')
    // 7 个进球数格子都在，默认全是 auto 浓度
    expect((html.match(/data-cell-mode="auto"/g) || [])).toHaveLength(14)

    // 主胜 67.7% / 平 24.8% / 客胜 7.5%（区间正态外积后的直接读数）
    expect(html).toContain('67.7%')
    expect(html).toContain('24.8%')
    expect(html).toContain('7.5%')
    // 这条 Entry 的概率 = 我的分布给 2-1 的浓度
    expect(html).toContain('这条 Entry（2-1）：我给 20.4%')
    // 市场还没拉到时，不显示对照表
    expect(html).not.toContain('pre-board-compare')
  })

  it('没有偏差样本时如实说明，并保留「我坚持」开关', () => {
    const html = strip(renderToStaticMarkup(
      <PreMatchBoard
        matchIndex={0}
        homeTeam="阿森纳"
        awayTeam="埃弗顿"
        entries={[scoreEntry]}
        detectedScore={{ home: 2, away: 1 }}
        biasModel={null}
      />,
    ))
    expect(html).toContain('这支队还没有历史登记样本，本场不做偏差修正。')
    expect(html).toContain('data-testid="pre-board-insist-toggle"')
    expect(html).toContain('用修正后（默认）')
    expect(html).toContain('分布中心 2.00-1.00')
  })
})

describe('进球区间滑轨（PreScoreSlider）', () => {
  it('渲染 7 个格子与两个端点，端点可读可拖', () => {
    const weights = weightsFromSlider({ lo: 1, hi: 3 })
    const html = strip(renderToStaticMarkup(
      <PreScoreSlider label="主队" tone="home" value={{ lo: 1, hi: 3, modes: {} }} weights={weights} onChange={() => {}} testId="pre-slider-home" />,
    ))
    expect((html.match(/data-testid="pre-slider-home-cell-/g) || [])).toHaveLength(7)
    expect(html).toContain('data-testid="pre-slider-home-lower"')
    expect(html).toContain('data-testid="pre-slider-home-upper"')
    expect(html).toContain('区间 1–3 球')
    expect(html).toContain('期望 2.00')
  })

  it('手动加压的格子会带上对应状态', () => {
    const weights = weightsFromSlider({ lo: 1, hi: 3, modes: { 3: 'boost', 0: 'zero' } })
    const html = strip(renderToStaticMarkup(
      <PreScoreSlider label="主队" value={{ lo: 1, hi: 3, modes: { 3: 'boost', 0: 'zero' } }} weights={weights} onChange={() => {}} testId="s" />,
    ))
    expect(html).toContain('data-cell-mode="boost"')
    expect(html).toContain('data-cell-mode="zero"')
  })
})

describe('两队 PK（PreMatchHero）', () => {
  const records = {
    home: [
      {
        id: 'a',
        dateLabel: '26-09-20',
        venue: 'home',
        opponent: '埃弗顿',
        entryText: '主胜',
        oddsLabel: '1.80',
        predictedScore: { home: 2, away: 1 },
        actualScore: { home: 2, away: 1 },
        resultText: '2-1',
        isCorrect: true,
        settled: true,
        note: '**主场**[red]强势[/red]',
        postNote: '按预判走完',
      },
    ],
    away: [],
  }

  it('两队各一块面板，队名是焦点', () => {
    const html = strip(renderToStaticMarkup(
      <PreMatchHero
        homeTeam="阿森纳"
        awayTeam="埃弗顿"
        hintFor={() => '12 场 · REP 0.66'}
        suggestions={{ home: [], away: [] }}
      />,
    ))
    expect(html).toContain('data-testid="pre-match-hero"')
    expect(html).toContain('data-testid="pre-hero-input-home"')
    expect(html).toContain('data-testid="pre-hero-input-away"')
    expect(html).toContain('12 场 · REP 0.66')
    expect(html).toContain('VS')
  })

  it('没填队名时给出空白占位文案，而不是报错', () => {
    const html = strip(renderToStaticMarkup(<PreMatchHero />))
    expect(html).toContain('输入球队名或缩写')
  })
})

describe('两队过往记录（PreMatchRecords）', () => {
  const records = {
    home: [
      {
        id: 'a',
        dateLabel: '26-09-20',
        venue: 'home',
        opponent: '埃弗顿',
        entryText: '主胜',
        oddsLabel: '1.80',
        predictedScore: { home: 2, away: 1 },
        actualScore: { home: 2, away: 1 },
        resultText: '2-1',
        isCorrect: true,
        settled: true,
        note: '**主场**[red]强势[/red]',
        postNote: '按预判走完',
      },
    ],
    away: [],
  }

  it('备注一字不差的两条：新的照常显示，旧的那条折叠成「同上」', () => {
    const dup = {
      home: [
        { id: 'new', dateLabel: '26-09-20', venue: 'home', opponent: '埃弗顿', entryText: 'win', oddsLabel: '1.52', resultText: 'win', isCorrect: true, settled: true, note: '赛前', postNote: '英格兰牛逼' },
        { id: 'old', dateLabel: '26-09-18', venue: 'home', opponent: '克罗地亚', entryText: 'win', oddsLabel: '1.52', resultText: 'win', isCorrect: true, settled: true, note: '赛前', postNote: '英格兰牛逼' },
        { id: 'other', dateLabel: '26-09-16', venue: 'home', opponent: '法国', entryText: 'draw', oddsLabel: '3.3', resultText: 'draw', isCorrect: false, settled: true, note: '另一条', postNote: '不一样' },
      ],
      away: [],
    }
    const html = strip(renderToStaticMarkup(<PreMatchRecords homeTeam="英格兰" awayTeam="西班牙" records={dup} />))
    // 备注只出现一次（新的那条），旧的折叠
    expect((html.match(/英格兰牛逼/g) || [])).toHaveLength(1)
    expect(html).toContain('投前/投后 同上')
    expect((html.match(/另一条/g) || [])).toHaveLength(1)
  })

  it('一条记录就一行：日期 · 主客 · 对手 · Entry · odds · 结果，都在同一个行容器里', () => {
    const rows = {
      home: [
        { id: 'a', dateLabel: '26-08-23', venue: 'home', opponent: '皇马', entryText: 'lose', oddsLabel: '1.30', resultText: 'lose', isCorrect: true, settled: true, note: '', postNote: '' },
      ],
      away: [],
    }
    const html = strip(renderToStaticMarkup(<PreMatchRecords homeTeam="西班牙" awayTeam="英格兰" records={rows} />))
    const main = html.slice(html.indexOf('pre-record-main'), html.indexOf('</li>'))
    expect(main).toContain('26-08-23')
    expect(main).toContain('主')
    expect(main).toContain('对 皇马')
    expect(main).toContain('lose')
    expect(main).toContain('odds 1.30')
    expect(main).toContain('结果 lose')
    expect(main).toContain('中')
  })

  it('一整块左右两半（淡红/淡蓝），行里带备注与复盘', () => {
    const html = strip(renderToStaticMarkup(
      <PreMatchRecords homeTeam="阿森纳" awayTeam="埃弗顿" records={records} />,
    ))
    expect(html).toContain('data-testid="pre-match-records"')
    expect(html).toContain('data-testid="pre-dossier-home"')
    expect(html).toContain('data-testid="pre-dossier-away"')
    expect(html).toContain('阿森纳')
    expect(html).toContain('26-09-20')
    expect(html).toContain('结果 2-1')
    expect(html).toContain('投前')
    expect(html).toContain('主场强势')
    expect(html).toContain('投后')
    expect(html).toContain('按预判走完')
    // 客队那半边没有记录
    expect(html).toContain('这支队还没有历史记录')
  })
})

