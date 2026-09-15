import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Plus,
  Sparkles,
  Layers,
  Compass,
  BookOpen,
  Orbit,
  SlidersHorizontal,
  ShieldCheck,
  Cloud,
  HelpCircle as CircleHelp,
  X,
  Pencil,
  Search,
  Clock3,
  CircleDot,
  LayoutDashboard as PanelsTopLeft,
} from 'lucide-react'
import {
  CONCEPTS,
  DESIGN_PAGES,
  SAMPLE_ROWS,
  EQUITY,
  DEMO_METRICS,
} from '../design/inpirationConcepts'
import '../design/inpirationStudio.css'

const ICONS = { helio: Compass, kepler: Orbit, folio: BookOpen }
const pageIcons = [
  Orbit,
  Plus,
  Layers,
  Check,
  PanelsTopLeft,
  CircleDot,
  Compass,
  Clock3,
  Search,
  SlidersHorizontal,
]
const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(0)}`

function Mark({ big = false }) {
  return (
    <span className={`ds-mark ${big ? 'ds-mark--big' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

function Sculpture() {
  return (
    <div className="ds-sculpture" aria-hidden="true">
      <div className="ds-orbit o1" />
      <div className="ds-orbit o2" />
      <div className="ds-orbit o3" />
      <div className="ds-lens">
        <Mark big />
      </div>
      <div className="ds-orbit-dot" />
      <span className="ds-coord">INSIGHT / IN MOTION</span>
      <span className="ds-coord ds-coord--end">D / 03</span>
    </div>
  )
}

function Card({ title, kicker, children, className = '', aside }) {
  return (
    <section className={`ds-card ${className}`}>
      <div className="ds-card-head">
        <div>
          {kicker && <span className="ds-kicker">{kicker}</span>}
          <h3>{title}</h3>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Metric({ item, onOpen }) {
  return (
    <button className="ds-metric" onClick={() => onOpen(item)}>
      <span>
        {item[0]}
        <ArrowUpRight size={13} />
      </span>
      <strong>{item[1]}</strong>
      <small>{item[2]}</small>
    </button>
  )
}

function EquityChart() {
  const [active, setActive] = useState(null)
  const min = Math.min(...EQUITY) - 80,
    max = Math.max(...EQUITY) + 80
  const point = (value, i) => [
    36 + (i * 600) / 24,
    150 - ((value - min) / (max - min)) * 120,
  ]
  const points = EQUITY.map(point)
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')
  const picked = active === null ? null : SAMPLE_ROWS[active - 1]
  return (
    <div className="ds-chart-wrap">
      <div className="ds-chart-summary">
        <strong>
          ¥1,444<span>期末净值</span>
        </strong>
        <span className="ds-positive">+44.4% / 对比周期本金</span>
      </div>
      <svg
        className="ds-chart"
        viewBox="0 0 672 196"
        role="img"
        aria-label="24 笔示例投资的净值轨迹，从 1000 元到 1444 元"
      >
        <defs>
          <linearGradient id="ds-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="var(--ds-accent)" stopOpacity=".18" />
            <stop offset="1" stopColor="var(--ds-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[1000, 1250, 1500].map((v) => (
          <g key={v}>
            <path d={`M36,${point(v, 0)[1]}H636`} className="ds-gridline" />
            <text x="2" y={point(v, 0)[1] - 6}>
              {v}
            </text>
          </g>
        ))}
        <path d={`${path} L636,160 L36,160 Z`} fill="url(#ds-chart-fill)" />
        <path
          d={path}
          fill="none"
          stroke="var(--ds-accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={active === i ? 5 : 2.5}
            fill="var(--ds-accent)"
          />
        ))}
        {[0, 6, 12, 18, 24].map((i) => (
          <text key={i} x={point(0, i)[0]} y="185" textAnchor="middle">
            {i}
          </text>
        ))}
        <text x="638" y="194" textAnchor="end">
          投资笔数
        </text>
        <rect
          x="36"
          y="0"
          width="600"
          height="162"
          fill="transparent"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setActive(
              Math.max(
                1,
                Math.min(24, Math.round(((e.clientX - r.left) / r.width) * 24)),
              ),
            )
          }}
          onPointerLeave={() => setActive(null)}
        />
      </svg>
      <div className="ds-chart-caption" aria-live="polite">
        {picked
          ? `${picked.date} · ${picked.home} vs ${picked.away} · 盈亏 ¥${signed(picked.profit)}`
          : '移至曲线查看比赛与盈亏 · 示例数据'}
      </div>
    </div>
  )
}

function Bars({ type = 'league', onOpen }) {
  const groups =
    type === 'week' ? ['08/31–09/06', '09/07–09/13'] : ['西甲', '英超', '德甲']
  return (
    <div className="ds-bars">
      {groups.map((name, i) => {
        const rows = SAMPLE_ROWS.filter((r) =>
          type === 'week'
            ? (Number(r.date.slice(3)) <= 6 ? 0 : 1) === i
            : r.league === name,
        )
        const profit = rows.reduce((s, r) => s + r.profit, 0)
        const roi = (profit / (rows.length * 100)) * 100
        return (
          <button
            key={name}
            className="ds-bar-row"
            onClick={() =>
              onOpen([
                name,
                `${signed(roi)}%`,
                `${rows.length} 笔 · 投入 ¥${rows.length * 100} · 盈亏 ¥${signed(profit)}`,
              ])
            }
          >
            <span>
              <b>{name}</b>
              <small>
                {rows.length} 笔 · 命中{' '}
                {(
                  (rows.filter((r) => r.hit).length / rows.length) *
                  100
                ).toFixed(0)}
                %
              </small>
            </span>
            <div className="ds-bar-track">
              <i style={{ width: `${Math.min(100, Math.abs(roi))}%` }} />
            </div>
            <strong className={roi >= 0 ? 'ds-positive' : 'ds-negative'}>
              {signed(roi)}%<small>ROI</small>
            </strong>
          </button>
        )
      })}
    </div>
  )
}

function HistoryTable({ compact = false, onOpen }) {
  const [page, setPage] = useState(0)
  const size = compact ? 4 : 6
  const rows = SAMPLE_ROWS.slice(page * size, (page + 1) * size)
  return (
    <>
      <div className="ds-table-wrap">
        <table className="ds-table">
          <thead>
            <tr>
              <th>日期 / 投资</th>
              <th>比赛</th>
              <th>投入</th>
              <th>收入</th>
              <th>ROI</th>
              <th>
                <span className="ds-sr">查看</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.date}
                  <small>DG-{String(row.id).padStart(3, '0')}</small>
                </td>
                <td>
                  {row.home} <span className="ds-muted">vs</span> {row.away}
                  <small>
                    {row.league} · {row.hit ? '命中' : '未中'}
                  </small>
                </td>
                <td>¥{row.stake}</td>
                <td>¥{row.revenue}</td>
                <td className={row.hit ? 'ds-positive' : 'ds-negative'}>
                  {signed(row.roi)}%
                </td>
                <td>
                  <button
                    className="ds-icon"
                    aria-label={`查看第 ${row.id} 笔明细`}
                    onClick={() =>
                      onOpen([
                        `${row.home} vs ${row.away}`,
                        `${signed(row.roi)}%`,
                        `${row.date} · 投入 ¥100 · 收入 ¥${row.revenue} · 盈亏 ¥${signed(row.profit)}`,
                      ])
                    }
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ds-pagination">
        <span>
          {page * size + 1}–{Math.min(24, (page + 1) * size)} / 24 笔
        </span>
        <button
          className="ds-icon"
          aria-label="上一页"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          <ArrowLeft size={15} />
        </button>
        <button
          className="ds-icon"
          aria-label="下一页"
          disabled={(page + 1) * size >= 24}
          onClick={() => setPage(page + 1)}
        >
          <ArrowRight size={15} />
        </button>
      </div>
    </>
  )
}

function Seasons({ onOpen }) {
  const [season, setSeason] = useState(2)
  const [names, setNames] = useState(['Hello World', '世界杯!', '未命名'])
  const [editing, setEditing] = useState(false)
  return (
    <>
      <div className="ds-season-selector" role="group" aria-label="选择周期">
        {names
          .map((name, i) => `S${i + 1} · ${name || '未命名'}`)
          .map((label, i) => (
            <button
              key={i}
              aria-pressed={season === i}
              onClick={() => {
                setSeason(i)
                setEditing(false)
              }}
            >
              <span className="ds-tiny-square" />
              {label}
              <small>{i === 2 ? '进行中' : '已结算'}</small>
            </button>
          ))}
      </div>
      <div className="ds-season-cover">
        <div>
          <span className="ds-kicker">
            SEASON 0{season + 1} / THE COLLECTED INSIGHTS
          </span>
          <h2>
            {season === 0
              ? 'Hello World.'
              : season === 1
                ? '世界，是一个赛场。'
                : '新的篇章，正在发生。'}
          </h2>
          <p>
            {season === 2
              ? '从每一次判断，向更清晰的自己靠近。'
              : '让每一季的得失，成为下一次判断的起点。'}
          </p>
          <div className="ds-cover-bottom">
            <span className="ds-status">
              <i />
              {season === 2 ? '本期进行中' : '本期已结算'}
            </span>
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  setEditing(false)
                }}
              >
                <input
                  aria-label="周期名称"
                  value={names[season]}
                  onChange={(e) =>
                    setNames(
                      names.map((name, i) =>
                        i === season ? e.target.value : name,
                      ),
                    )
                  }
                />
                <button className="ds-icon" aria-label="确认名称">
                  <Check size={14} />
                </button>
              </form>
            ) : (
              <button className="ds-link" onClick={() => setEditing(true)}>
                命名这一季
                <Pencil size={13} />
              </button>
            )}
          </div>
        </div>
        <Sculpture />
        <div className="ds-cover-number">
          <span>周期 ROI</span>
          <strong>
            +18.5<small>%</small>
          </strong>
          <span>
            净利润 <b>+¥444</b>
          </span>
        </div>
      </div>
      {season !== 2 && (
        <p className="ds-note">
          演示历史周期的封面状态；下方统一使用同一组示例流水，便于比较视觉方案。
        </p>
      )}
      <div className="ds-metrics-grid">
        {DEMO_METRICS.map((item) => (
          <Metric key={item[0]} item={item} onOpen={onOpen} />
        ))}
      </div>
      <div className="ds-main-grid">
        <Card
          title="每一步，都在曲线上。"
          kicker="01 / CAPITAL TRAJECTORY"
          className="ds-wide"
        >
          <EquityChart />
        </Card>
        <Card title="这一季，来自哪里。" kicker="02 / LEAGUES">
          <Bars onOpen={onOpen} />
        </Card>
      </div>
      <div className="ds-main-grid ds-equal">
        <Card title="按自然周，回看起伏。" kicker="03 / WEEKS">
          <Bars type="week" onOpen={onOpen} />
        </Card>
        <Card title="投入的尺度。" kicker="04 / STAKE DISTRIBUTION">
          <div className="ds-stakes">
            {['0–50', '50–100', '100–200', '200+'].map((s, i) => (
              <button
                key={s}
                onClick={() =>
                  onOpen([
                    `投入 ¥${s}`,
                    i === 2 ? '+18.5%' : '—',
                    i === 2
                      ? '24 笔 · 区间为 100 ≤ 投入 < 200'
                      : '此示例区间暂无样本',
                  ])
                }
              >
                <span>¥{s}</span>
                <strong>{i === 2 ? '+18.5%' : '—'}</strong>
                <small>{i === 2 ? '24 笔' : '0 笔'}</small>
              </button>
            ))}
          </div>
        </Card>
      </div>
      <Card title="每一笔，都有据可循。" kicker="05 / THE RECORD">
        <HistoryTable compact onOpen={onOpen} />
      </Card>
    </>
  )
}

function NewPage({ notify }) {
  const [parsed, setParsed] = useState(false)
  const [conf, setConf] = useState(71)
  const [mode, setMode] = useState('常规')
  return (
    <div className="ds-workspace-grid">
      <div className="ds-workspace-main">
        <Card
          title="从一句话开始。"
          kicker="QUICK INPUT"
          className="ds-ai-card"
          aside={
            <span className="ds-lab">
              <Sparkles size={12} />
              LAB · AI
            </span>
          }
        >
          <textarea
            aria-label="示例自然语言录入"
            defaultValue="阿森纳2-0利物浦 odds 3.9 conf 0.71，140块。"
          />
          <div className="ds-action-row">
            <span>比赛、赔率与参数，自动整理。</span>
            <button className="ds-primary" onClick={() => setParsed(true)}>
              <Sparkles size={14} />
              {parsed ? '已填入下方示例' : '查看解析示例'}
            </button>
          </div>
          {parsed && (
            <div className="ds-receipt">
              <Check size={16} />
              <span>
                阿森纳 vs 利物浦 · 2-0 @ 3.9 · ¥140
                <br />
                <small>Conf 0.71 · FSE 沿用历史 · 这是固定演示结果</small>
              </span>
            </div>
          )}
        </Card>
        <Card
          title="一场比赛，一份判断。"
          kicker="MATCH 01"
          aside={<span className="ds-tag">单场</span>}
        >
          <div className="ds-matchup">
            <label>
              主队
              <input aria-label="主队" defaultValue="阿森纳" />
            </label>
            <span>VS</span>
            <label>
              客队
              <input aria-label="客队" defaultValue="利物浦" />
            </label>
          </div>
          <div className="ds-form-row">
            <label>
              Entry · 预测结果
              <input defaultValue="2-0" />
            </label>
            <label>
              Odds · 赔率
              <input defaultValue="3.9" inputMode="decimal" />
            </label>
          </div>
          <div className="ds-field-head">
            <span>Mode · 策略</span>
          </div>
          <div className="ds-segment">
            {['常规', '赌一把', '保险产品'].map((m) => (
              <button
                key={m}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
          <label className="ds-range-label">
            Conf · 主观置信度 <strong>{(conf / 100).toFixed(2)}</strong>
            <input
              type="range"
              min="0"
              max="100"
              value={conf}
              onChange={(e) => setConf(Number(e.target.value))}
            />
          </label>
          <div className="ds-form-row ds-form-row--three">
            <label>
              TYS · 主 / 客
              <select defaultValue="M / M">
                <option>M / M</option>
                <option>S / M</option>
                <option>L / M</option>
              </select>
            </label>
            <label>
              FID
              <input defaultValue="0.4" />
            </label>
            <label>
              FSE · 主 / 客<input defaultValue="0.72 / 0.38" />
              <small>沿用上次记录</small>
            </label>
          </div>
          <label>
            赛前笔记
            <textarea defaultValue="关注主队高位压迫，以及对方客场的体能分配。" />
          </label>
        </Card>
      </div>
      <aside className="ds-workspace-side">
        <Card title="这一笔的轮廓。" kicker="YOUR POSITION">
          <div className="ds-position-art">
            <Mark big />
          </div>
          <label>
            实际投入
            <input defaultValue="140" inputMode="decimal" />
          </label>
          <div className="ds-summary-row">
            <span>组合赔率</span>
            <b>3.90</b>
          </div>
          <div className="ds-summary-row">
            <span>比赛</span>
            <b>1 场</b>
          </div>
          <div className="ds-summary-row">
            <span>归属周期</span>
            <b>S3 · 未命名</b>
          </div>
          <button
            className="ds-primary ds-full"
            onClick={() =>
              notify(
                '录入确认态演示：字段已准备好，真实版本通过原入档流程保存。',
              )
            }
          >
            确认入档
            <ArrowUpRight size={15} />
          </button>
          <p className="ds-note">先理解，再确认。每个字段都可以修改。</p>
        </Card>
        <div className="ds-margin-note">
          <span>01 / INSIGHT</span>
          <p>
            把直觉留下来，
            <br />
            让时间帮你校准。
          </p>
        </div>
      </aside>
    </div>
  )
}

function Portfolio({ notify, onOpen }) {
  const [selected, setSelected] = useState([true, true, false])
  const [risk, setRisk] = useState(35)
  const [generated, setGenerated] = useState(false)
  return (
    <div className="ds-workspace-grid">
      <Card
        title="今日备选比赛"
        kicker="01 / OBSERVATIONS"
        className="ds-workspace-side"
      >
        {[
          ['阿森纳', '利物浦', '3.90'],
          ['皇马', '皇社', '1.52'],
          ['纽卡', '西汉姆', '1.23'],
        ].map((m, i) => (
          <label className="ds-candidate" key={m[0]}>
            <input
              type="checkbox"
              checked={selected[i]}
              onChange={() =>
                setSelected(selected.map((v, j) => (i === j ? !v : v)))
              }
            />
            <span>
              {m[0]} vs {m[1]}
              <small>Odds {m[2]} · 常规</small>
            </span>
          </label>
        ))}
        <label className="ds-range-label">
          Risk Preference <strong>{risk}%</strong>
          <input
            type="range"
            value={risk}
            onChange={(e) => setRisk(Number(e.target.value))}
          />
        </label>
        <div className="ds-form-row">
          <label>
            预算 ¥<input defaultValue="300" />
          </label>
          <label>
            Kelly 分母
            <input defaultValue="4" />
          </label>
        </div>
        <button
          className="ds-primary ds-full"
          disabled={!selected.some(Boolean)}
          onClick={() => setGenerated(true)}
        >
          查看组合示例
          <ArrowRight size={15} />
        </button>
      </Card>
      <div className="ds-workspace-main">
        <Card
          title={
            generated ? '配置，开始形成。' : '每一种组合，都有自己的节奏。'
          }
          kicker="02 / COMPOSITION"
          className="ds-portfolio-hero"
        >
          <Sculpture />
          <p>
            从 {selected.filter(Boolean).length}{' '}
            场备选里，为风险找到合适的形状。
          </p>
        </Card>
        <div className="ds-main-grid ds-equal">
          {['稳态配置', '弹性配置'].map((name, i) => (
            <Card
              key={name}
              title={name}
              kicker={`OPTION 0${i + 1}`}
              aside={<span className="ds-tag">{i ? '探索' : '均衡'}</span>}
            >
              <div className="ds-allocation">
                <i style={{ flex: i ? 4 : 6 }} />
                <i style={{ flex: 3 }} />
                <i style={{ flex: i ? 3 : 1 }} />
              </div>
              <div className="ds-summary-row">
                <span>配置预算</span>
                <b>¥{i ? '240' : '180'}</b>
              </div>
              <div className="ds-summary-row">
                <span>留存资金</span>
                <b>¥{i ? '60' : '120'}</b>
              </div>
              <button
                className="ds-link"
                onClick={() =>
                  onOpen([
                    name,
                    i ? '80%' : '60%',
                    '静态组合样例 · 展示预算、分层与风险说明的位置；正式方案仍由现有组合引擎计算。',
                  ])
                }
              >
                展开配置依据
                <ArrowUpRight size={14} />
              </button>
            </Card>
          ))}
        </div>
        <button
          className="ds-link"
          onClick={() => notify('方案历史会以同一套可展开卡片呈现。')}
        >
          查看方案历史
          <Clock3 size={14} />
        </button>
      </div>
    </div>
  )
}

function Settle({ notify }) {
  const [result, setResult] = useState('')
  const [ai, setAi] = useState('0-0')
  const [hit, setHit] = useState(null)
  const [ajr, setAjr] = useState('')
  const [rep, setRep] = useState('')
  const setScore = (score) => {
    setResult(score)
    const match = score.match(/^(\d+)\s*(?:-|:|：)\s*(\d+)$/)
    if (match) {
      const won = Number(match[1]) - 1 < Number(match[2])
      setHit(won)
      setAjr(won ? '0.8' : '')
      setRep('0')
    } else {
      setHit(null)
      setAjr('')
      setRep('')
    }
  }
  return (
    <>
      <details className="ds-general">
        <summary>
          <Sparkles size={15} />
          General Quick Settle<span className="ds-lab">LAB · AI</span>
          <ChevronDown size={15} />
        </summary>
        <textarea aria-label="批量结算演示" placeholder="输入多场实际结果…" />
        <button
          className="ds-link"
          onClick={() =>
            notify('批量解析示意：正式功能会调用现有结算 AI 接口。')
          }
        >
          查看批量解析说明
          <ArrowRight size={14} />
        </button>
      </details>
      <div className="ds-workspace-grid">
        <Card
          title="热刺 vs 埃弗顿"
          kicker="MATCH 01 / SETTLEMENT"
          className="ds-workspace-main"
          aside={<span className="ds-tag">待结算</span>}
        >
          <div className="ds-prediction">
            <span>我的预测</span>
            <b>−1 lose</b>
            <small>Odds 1.74</small>
          </div>
          <div className="ds-inline-ai">
            <span className="ds-lab">
              <Sparkles size={12} />
              LAB · AI
            </span>
            <input
              aria-label="单场结算示例"
              value={ai}
              onChange={(e) => setAi(e.target.value)}
            />
            <button
              className="ds-icon"
              aria-label="演示填入结果"
              onClick={() => {
                if (/中了|命中/.test(ai)) {
                  setResult('-1 lose')
                  setHit(true)
                  setAjr('0.8')
                  setRep('0')
                } else setScore(ai)
              }}
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="ds-form-row">
            <label>
              Results · 实际结果
              <input
                aria-label="Results 实际结果"
                value={result}
                onChange={(e) => setScore(e.target.value)}
                placeholder="比分或结果"
              />
            </label>
            <label>
              是否命中
              <span className="ds-segment">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    aria-pressed={hit === v}
                    onClick={() => {
                      setHit(v)
                      if (v) {
                        setAjr('0.8')
                        setRep('0')
                      }
                    }}
                  >
                    {v ? '✓ 命中' : '× 未中'}
                  </button>
                ))}
              </span>
            </label>
          </div>
          <div className="ds-form-row">
            <label>
              AJR · 判断评分
              <input
                aria-label="AJR"
                placeholder="0–0.8"
                value={ajr}
                onChange={(e) => setAjr(e.target.value)}
              />
            </label>
            <label>
              REP · 随机事件
              <input
                aria-label="REP"
                placeholder="0–1.8"
                value={rep}
                onChange={(e) => setRep(e.target.value)}
              />
            </label>
          </div>
          <label>
            赛后笔记
            <textarea placeholder="发生了什么，值得下一次记住？" />
          </label>
          <p className="ds-note">
            可试：0-0 → 命中；3-2 → 未中。这里使用固定单场演示。
          </p>
        </Card>
        <aside>
          <Card title="这一单，完整收好。" kicker="THE RECEIPT">
            <div className="ds-receipt-seal">
              <Mark />
            </div>
            <div className="ds-summary-row">
              <span>投入</span>
              <b>¥100</b>
            </div>
            <label>
              实际总收入 ¥<input placeholder="含本金" defaultValue="174" />
            </label>
            <button
              className="ds-primary ds-full"
              onClick={() =>
                notify('结算确认态演示：实际保存仍走现有统一结算与同步流程。')
              }
            >
              确认结算
              <Check size={15} />
            </button>
            <p className="ds-note">组合级收入 · 单场级反馈</p>
          </Card>
        </aside>
      </div>
    </>
  )
}

function Research({ page, onOpen }) {
  const [axis, setAxis] = useState('Conf')
  const metrics =
    page === 'overview'
      ? [
          DEMO_METRICS[0],
          DEMO_METRICS[3],
          ['累计 ROI', '+18.5%', '24 笔示例'],
          DEMO_METRICS[4],
        ]
      : [
          DEMO_METRICS[1],
          DEMO_METRICS[8],
          DEMO_METRICS[10],
          ['样本量', '24', '结论的观察范围'],
        ]
  return (
    <>
      <div className="ds-metrics-grid ds-metrics-grid--four">
        {metrics.map((m) => (
          <Metric item={m} key={m[0]} onOpen={onOpen} />
        ))}
      </div>
      <div className="ds-main-grid">
        <Card
          title={
            page === 'overview'
              ? '资金，沿时间生长。'
              : '判断与反馈，逐渐对齐。'
          }
          kicker={page === 'overview' ? 'CAPITAL POOL' : 'RESEARCH NOTES'}
          className="ds-wide"
        >
          <EquityChart />
        </Card>
        <Card
          title={page === 'overview' ? '此刻的资金轮廓' : '联赛的不同侧面'}
          kicker="AT A GLANCE"
        >
          {page === 'overview' ? (
            <>
              <div className="ds-pool">
                <span>
                  可用资金<strong>¥1,444</strong>
                </span>
              </div>
              <button
                className="ds-link"
                onClick={() =>
                  onOpen([
                    '资金注入',
                    '¥1,000',
                    '本金记录、注资历史与周期结算在这里展开。',
                  ])
                }
              >
                资金注入与周期
                <ArrowUpRight size={14} />
              </button>
            </>
          ) : (
            <Bars onOpen={onOpen} />
          )}
        </Card>
      </div>
      {page !== 'overview' && (
        <Card
          title="沿着参数，寻找线索。"
          kicker="THE EVIDENCE MATRIX"
          aside={
            <div className="ds-segment">
              {['Conf', 'Odds', 'Mode', 'Entry'].map((n) => (
                <button
                  key={n}
                  aria-pressed={axis === n}
                  onClick={() => setAxis(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          }
        >
          <div className="ds-matrix">
            <div />
            <span>低区间</span>
            <span>中区间</span>
            <span>高区间</span>
            {['常规', '赌一把', '保险产品'].map((m, i) => (
              <div className="ds-matrix-line" key={m}>
                <span>{m}</span>
                {[0, 1, 2].map((j) => (
                  <button
                    key={j}
                    style={{
                      '--cell-weight': `${((i * 3 + j + axis.length) % 5) * 12 + 5}%`,
                    }}
                    onClick={() =>
                      onOpen([
                        `${axis} × ${m}`,
                        `${[12, -8, 24, 18, 4, -12, 32, 9, 15][i * 3 + j]}%`,
                        '矩阵交互样例 · 6 笔示例样本 · 明细中展示定义、分组、流水。',
                      ])
                    }
                  >
                    <strong>
                      {[12, -8, 24, 18, 4, -12, 32, 9, 15][i * 3 + j]}%
                    </strong>
                    <small>6 笔示例</small>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p className="ds-note">
            矩阵为独立示意数据。点击单元格体验“指标 → 样本”的明细层。
          </p>
        </Card>
      )}
      <Card title="把结论，放回具体比赛。" kicker="TRACEABLE RECORDS">
        <HistoryTable compact onOpen={onOpen} />
      </Card>
    </>
  )
}

function Teams({ onOpen }) {
  const [search, setSearch] = useState('')
  const names = [
    '阿森纳',
    '利物浦',
    '皇家马德里',
    '巴塞罗那',
    '热刺',
    '拜仁慕尼黑',
  ]
  return (
    <>
      <label className="ds-search">
        <Search size={17} />
        <input
          placeholder="搜索球队，打开一份档案…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="ds-team-grid">
        {names
          .map((name, i) => ({ name, i }))
          .filter(({ name }) => name.includes(search))
          .map(({ name, i }) => (
            <button
              className="ds-team"
              key={name}
              onClick={() =>
                onOpen([
                  name,
                  `FSE ${(0.32 + i * 0.06).toFixed(2)}`,
                  '球队档案示例 · 最近记录、REP、FSE、投资历史与个人笔记在同一详情层展示。',
                ])
              }
            >
              <span className="ds-team-monogram">
                {['A', 'L', 'R', 'B', 'T', 'M'][i]}
              </span>
              <span className="ds-kicker">CLUB ARCHIVE / 0{i + 1}</span>
              <h3>{name}</h3>
              <div className="ds-summary-row">
                <span>历史样本</span>
                <b>{12 + i * 3} 场示例</b>
              </div>
              <div className="ds-summary-row">
                <span>最近 FSE</span>
                <b>{(0.32 + i * 0.06).toFixed(2)}</b>
              </div>
              <span className="ds-link">
                打开档案
                <ArrowUpRight size={14} />
              </span>
            </button>
          ))}
      </div>
      {!names.some((n) => n.includes(search)) && (
        <p className="ds-empty">暂无匹配球队</p>
      )}
    </>
  )
}

function Console({ notify, onOpen }) {
  const [group, setGroup] = useState('核心指标')
  const [weights, setWeights] = useState([45, 16, 12, 14, 6, 7])
  return (
    <>
      <div className="ds-section-tabs">
        {['核心指标', '系统配置', '模型分析', '校准引擎', '数据管理'].map(
          (g) => (
            <button
              key={g}
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ),
        )}
      </div>
      <div className="ds-main-grid">
        <Card
          title={
            group === '数据管理'
              ? '数据的每一步，都有回音。'
              : group === '系统配置'
                ? '你的系统，你的秩序。'
                : group === '校准引擎'
                  ? '让经验，修正判断。'
                  : group === '模型分析'
                    ? '看清模型如何学习。'
                    : '让系统始终有据可查。'
          }
          kicker="SYSTEM HEALTH"
          className="ds-wide"
        >
          <div className="ds-console-health">
            <span className="ds-health-symbol">
              <ShieldCheck size={32} />
            </span>
            <div>
              <h3>Everything in its place.</h3>
              <p>同步、样本、参数修改都有明确的状态与时间。</p>
              <span className="ds-tag">设计预览 · 状态示例</span>
            </div>
          </div>
          {group === '数据管理' ? (
            <div className="ds-section-tabs">
              {['Excel 导入 / 导出', 'JSON 备份', 'Time Machine'].map((n) => (
                <button
                  key={n}
                  onClick={() =>
                    onOpen([
                      n,
                      '数据管理',
                      '预览只展示入口和确认层；真实数据操作继续使用当前的数据管理实现。',
                    ])
                  }
                >
                  {n}
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          ) : (
            <EquityChart />
          )}
        </Card>
        <Card title="Git 云同步" kicker="CONNECTED">
          <div className="ds-sync-symbol">
            <Cloud size={30} />
          </div>
          <div className="ds-summary-row">
            <span>同步状态</span>
            <b>已同步 · 示例</b>
          </div>
          <div className="ds-summary-row">
            <span>最近更新</span>
            <b>19:42</b>
          </div>
          <button
            className="ds-link"
            onClick={() =>
              notify('这是同步反馈的设计示例，没有向云端发送数据。')
            }
          >
            同步状态说明
            <ArrowUpRight size={14} />
          </button>
        </Card>
      </div>
      <Card
        title="一组参数，一个可解释的系统。"
        kicker="CALIBRATION PARAMETERS"
      >
        <div className="ds-console-weights">
          {['Conf', 'Mode', 'TYS', 'FID', 'Odds', 'FSE'].map((n, i) => (
            <label className="ds-range-label" key={n}>
              {n}
              <strong>{weights[i]}%</strong>
              <input
                type="range"
                value={weights[i]}
                onChange={(e) =>
                  setWeights(
                    weights.map((v, j) =>
                      j === i ? Number(e.target.value) : v,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
        <div className="ds-action-row">
          <span>
            权重合计 {weights.reduce((s, v) => s + v, 0)}% · 参数交互演示
          </span>
          <button
            className="ds-primary"
            onClick={() =>
              notify('已预览参数确认态；这些滑杆不会改变真实模型参数。')
            }
          >
            预览保存反馈
            <Check size={14} />
          </button>
        </div>
      </Card>
    </>
  )
}

function Detail({ detail, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="ds-detail"
      aria-labelledby="ds-detail-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ds-detail-inner">
        <button
          className="ds-icon ds-detail-close"
          aria-label="关闭明细"
          autoFocus
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <span className="ds-kicker">BEHIND THE NUMBER</span>
        <h2 id="ds-detail-title">{detail[0]}</h2>
        <strong className="ds-detail-value">{detail[1]}</strong>
        <p>{detail[2]}</p>
        <hr />
        <h3>定义与样本，在同一层。</h3>
        <p>
          详情采用独立玻璃面板，保留所在页面的阅读位置。正式接入时，沿用现有指标定义与明细数据。
        </p>
        {detail[0] === '周期本金' && (
          <label>
            本金编辑样式
            <input defaultValue="1000" type="number" min="0" />
          </label>
        )}
        <button className="ds-primary" onClick={onClose}>
          返回页面
          <ArrowRight size={15} />
        </button>
      </div>
    </dialog>
  )
}

export default function DesignStudioPage() {
  const [params, setParams] = useSearchParams()
  const concept =
    CONCEPTS.find((c) => c.id === params.get('concept')) || CONCEPTS[0]
  const page =
    DESIGN_PAGES.find((p) => p.id === params.get('page')) || DESIGN_PAGES[0]
  const [detail, setDetail] = useState(null)
  const [notice, setNotice] = useState('')
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const notify = (message) => {
    setNotice(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setNotice(''), 5500)
  }
  const select = (key, value) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set(key, value)
        return next
      },
      { replace: true },
    )
    setDetail(null)
    setNotice('')
  }
  const renderPage = () => {
    if (page.id === 'seasons') return <Seasons onOpen={setDetail} />
    if (page.id === 'new') return <NewPage notify={notify} />
    if (page.id === 'portfolio')
      return <Portfolio notify={notify} onOpen={setDetail} />
    if (page.id === 'settle') return <Settle notify={notify} />
    if (['overview', 'metrics', 'analysis'].includes(page.id))
      return <Research page={page.id} onOpen={setDetail} />
    if (page.id === 'history')
      return (
        <Card title="所有记录" kicker="THE ARCHIVE">
          <HistoryTable onOpen={setDetail} />
        </Card>
      )
    if (page.id === 'teams') return <Teams onOpen={setDetail} />
    return <Console notify={notify} onOpen={setDetail} />
  }
  return (
    <div className="ds-studio" data-concept={concept.id}>
      <header className="ds-studio-toolbar">
        <Link to="/new" reloadDocument className="ds-back">
          <ArrowLeft size={16} />
          返回应用
        </Link>
        <span>
          dugou <b>Design Editions</b>
        </span>
        <span className="ds-preview-label">交互提案 · 全部为示例数据</span>
      </header>
      <section className="ds-editions" aria-label="选择设计方案">
        {CONCEPTS.map((c) => {
          const Icon = ICONS[c.id]
          return (
            <button
              key={c.id}
              onClick={() => select('concept', c.id)}
              aria-pressed={concept.id === c.id}
              className={`ds-edition ds-edition--${c.id}`}
            >
              <span className="ds-edition-symbol">
                <Icon size={21} strokeWidth={1.3} />
              </span>
              <span>
                <small>
                  {c.number} / {c.tag}
                </small>
                <strong>
                  {c.name}
                  <em>{c.chinese}</em>
                </strong>
              </span>
              <ArrowUpRight size={16} />
            </button>
          )
        })}
      </section>
      <div className="ds-preview-shell">
        <header className="ds-app-header">
          <Link to="/design/inpiration" className="ds-brand">
            <Mark />
            <b>dugou</b>
            <span>{concept.id === 'folio' ? 'THE JOURNAL' : 'inpiration'}</span>
          </Link>
          <div className="ds-app-context">
            <span>S3 · 未命名</span>
            <span className="ds-status">
              <i />
              示例工作区
            </span>
          </div>
          <button
            className="ds-icon"
            aria-label="查看本方案设计说明"
            onClick={() =>
              document
                .getElementById('ds-guidelines')
                ?.scrollIntoView({
                  behavior: window.matchMedia(
                    '(prefers-reduced-motion: reduce)',
                  ).matches
                    ? 'instant'
                    : 'smooth',
                  block: 'start',
                })
            }
          >
            <CircleHelp size={18} />
          </button>
        </header>
        <div className="ds-app-grid">
          <nav className="ds-app-nav" aria-label="页面预览">
            {DESIGN_PAGES.map((p, i) => {
              const Icon = pageIcons[i]
              return (
                <button
                  key={p.id}
                  aria-pressed={page.id === p.id}
                  onClick={() => select('page', p.id)}
                >
                  <Icon size={16} strokeWidth={1.6} />
                  <span>{p.name}</span>
                  <small>{p.cn}</small>
                  {page.id === p.id && <i />}
                </button>
              )
            })}
            <div className="ds-nav-signature">
              <Mark />
              <span>
                Precision
                <br />
                in uncertainty.
              </span>
            </div>
          </nav>
          <main className="ds-canvas">
            <div className="ds-page-heading">
              <div>
                <span className="ds-kicker">
                  {concept.name} / CHAPTER {page.chapter} ·{' '}
                  {page.name.toUpperCase()}
                </span>
                <h1>{page.title}</h1>
                <p>{page.subtitle}</p>
              </div>
              <span className="ds-page-index">
                {page.chapter}
                <small>dugou / 2026</small>
              </span>
            </div>
            <div key={page.id} className="ds-page-content">
              {renderPage()}
            </div>
            <footer className="ds-product-footer">
              <Mark />
              <span>Precision in uncertainty.</span>
              <span>为每一次判断，留一个坐标。</span>
            </footer>
          </main>
        </div>
      </div>
      <section className="ds-guidelines" id="ds-guidelines">
        <div className="ds-guidelines-title">
          <span className="ds-kicker">
            THE DESIGN DIRECTION / {concept.number}
          </span>
          <h2>{concept.line}</h2>
          <p>{concept.description}</p>
        </div>
        <div className="ds-guideline-grid">
          <article>
            <h3>品牌与几何</h3>
            <p>{concept.motif}</p>
            <p>{concept.geometry}</p>
            <div className="ds-palette">
              {concept.palette.map((color, i) => (
                <span key={color}>
                  <i style={{ background: color }} />
                  <small>{concept.paletteNames[i]}</small>
                  <code>{color}</code>
                </span>
              ))}
            </div>
          </article>
          <article>
            <h3>字体与材质</h3>
            <p>{concept.typography}</p>
            <p>{concept.glass}</p>
            <h3>动效节奏</h3>
            <p>{concept.motion} 减少动态效果开启时，自动退化为即时切换。</p>
          </article>
          <article>
            <h3>叙事与产品定位</h3>
            <p>{concept.story}</p>
            <p>{concept.business}</p>
            <h3>需要权衡</h3>
            <p>{concept.tradeoff}</p>
          </article>
        </div>
        <details className="ds-page-plan" open>
          <summary>
            10 个现有页面，如何贯穿同一套设计
            <ChevronDown size={16} />
          </summary>
          {DESIGN_PAGES.map((p) => (
            <div key={p.id}>
              <b>
                {p.chapter} / {p.name}
              </b>
              <p>{p.mapping}</p>
            </div>
          ))}
        </details>
        <p className="ds-design-source">
          材质原则参考{' '}
          <a
            href="https://developer.apple.com/design/human-interface-guidelines/materials"
            target="_blank"
            rel="noreferrer"
          >
            Apple Materials ↗
          </a>
          ：玻璃主要承载导航和控制层。此处为网页材质近似与交互原型，数字、同步及保存反馈均为示例。
        </p>
      </section>
      {notice && (
        <div className="ds-toast" role="status">
          <Check size={18} />
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {detail && <Detail detail={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
