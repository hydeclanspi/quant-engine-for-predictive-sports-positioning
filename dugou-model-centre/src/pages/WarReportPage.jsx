import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Award,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Flag,
  Layers,
  Pencil,
  ShieldCheck,
  Swords,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { getCyclePeriods, getWarReport } from '../lib/warReport'
import { setCycleTitle } from '../lib/localData'
import CountUp from '../components/CountUp'
import { useModeLabelMap } from '../components/ModeLabel'
import { isPreviewMode } from '../lib/displayMode'

/**
 * WarReportPage — 「战报」：按周期复盘的结算台。
 *
 * 周期沿用蓄水池那条分界线（见 lib/warReport.js），所以这里看到的每一期
 * 与「蓄水池余额 · 历史明细」里的止盈/止损刀口一一对应，不是另一套时间轴。
 *
 * 视觉以 Apple 式信息产品为基准：暖白底、柔和材质、清晰的大数字层级，
 * 让周期数据本身成为主角，只用少量系统蓝提示交互与状态。
 */

const LEDGER_PAGE_SIZE = 10

const toRmb = (value) => `¥${Math.round(Number(value) || 0).toLocaleString('zh-CN')}`
const toSigned = (value, digits = 0) => {
  const num = Number(value) || 0
  return `${num > 0 ? '+' : num < 0 ? '−' : ''}${Math.abs(num).toFixed(digits)}`
}
const toSignedPct = (value, digits = 1) => {
  const num = Number(value) || 0
  return `${num > 0 ? '+' : num < 0 ? '−' : ''}${Math.abs(num).toFixed(digits)}%`
}
const toneOf = (value) => (value > 0 ? 'win' : value < 0 ? 'lose' : 'flat')

const GRADE_TONE = {
  S: 'is-grade-s',
  A: 'is-grade-a',
  B: 'is-grade-b',
  C: 'is-grade-c',
  D: 'is-grade-d',
  '—': 'is-grade-none',
}

/* ── 周期选择器 ───────────────────────────────────────────────────────── */

function PeriodCard({ period, active, onSelect }) {
  const tone = toneOf(period.profit)
  return (
    <button
      type="button"
      onClick={() => onSelect(period.id)}
      className={`wr-period-card ${active ? 'is-active' : ''} is-${tone}`}
      role="tab"
      aria-selected={active}
      aria-label={`${period.name}，${period.isOpen ? '进行中' : '已归档'}，净盈亏 ${toSigned(period.profit)} 元`}
    >
      <div className="wr-period-card__top">
        <span className="wr-period-card__ordinal">SEASON {String(period.ordinal).padStart(2, '0')}</span>
        <span className={`wr-period-card__state ${period.isOpen ? 'is-live' : ''}`}>
          <i aria-hidden="true" />
          {period.isOpen ? '进行中' : '已归档'}
        </span>
      </div>
      <p className="wr-period-card__name" title={period.name}>{period.name}</p>
      <p className="wr-period-card__profit">
        {toSigned(period.profit)}
        <em>rmb</em>
      </p>
      <p className="wr-period-card__meta">
        {period.settledCount} 笔结算 <i /> 本金 {toRmb(period.baseCapital)}
      </p>
    </button>
  )
}

/* ── 裁决横幅 ─────────────────────────────────────────────────────────── */

function VerdictBanner({ report, runKey, onRename, children }) {
  const { period, kpi } = report
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(period.title)
  const inputRef = useRef(null)

  useEffect(() => {
    setEditing(false)
    setDraft(period.title)
  }, [period.id, period.title])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    const next = draft.trim()
    setEditing(false)
    if (next !== period.title) onRename(period.id, next)
  }

  const tone = toneOf(kpi.profit)
  const spanLabel = [
    period.startAt ? new Date(period.startAt).toLocaleDateString('zh-CN') : '起始',
    period.endAt ? new Date(period.endAt).toLocaleDateString('zh-CN') : '至今',
  ].join(' — ')

  return (
    <div className={`wr-banner ${GRADE_TONE[kpi.grade] || 'is-grade-none'}`}>
      <div className="wr-banner__sheen" aria-hidden="true" />
      <div className="wr-banner__grid" aria-hidden="true" />
      <span className="wr-banner__corner is-tl" aria-hidden="true" />
      <span className="wr-banner__corner is-tr" aria-hidden="true" />
      <span className="wr-banner__corner is-bl" aria-hidden="true" />
      <span className="wr-banner__corner is-br" aria-hidden="true" />

      <div className="wr-banner__body">
        {/* 标题 + 战果 */}
        <div className="wr-banner__main">
          <div className="wr-banner__eyebrow">
            <Swords size={13} />
            <span>Season {String(period.ordinal).padStart(2, '0')} · Summary</span>
            {period.isOpen && <em className="wr-banner__live">进行中</em>}
          </div>

          {editing ? (
            <div className="wr-rename">
              <span className="wr-rename__prefix" aria-hidden="true">S{period.ordinal}</span>
              <input
                ref={inputRef}
                value={draft}
                maxLength={24}
                onChange={(event) => setDraft(event.target.value)}
                aria-label={`S${period.ordinal} 周期标题`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit()
                  if (event.key === 'Escape') {
                    setDraft(period.title)
                    setEditing(false)
                  }
                }}
                placeholder="输入标题 · 序号自动添加"
                className="wr-rename__input"
              />
              <button type="button" onClick={commit} className="wr-rename__btn is-ok" title="保存">
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(period.title)
                  setEditing(false)
                }}
                className="wr-rename__btn"
                title="取消"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <h2 className="wr-banner__title">
              {period.name}
              <button type="button" onClick={() => setEditing(true)} className="wr-banner__edit" title="编辑周期标题">
                <Pencil size={13} />
              </button>
            </h2>
          )}

          <p className="wr-banner__span">{spanLabel}</p>

          <div className="wr-banner__figures">
            <div className="wr-figure is-primary">
              <span className="wr-figure__label">周期净盈亏</span>
              <span className={`wr-figure__value is-${tone}`}>
                <CountUp
                  value={kpi.profit}
                  runKey={runKey}
                  duration={1100}
                  format={(n) => toSigned(n)}
                />
                <em>rmb</em>
              </span>
            </div>
            <span className="wr-figure__sep" aria-hidden="true" />
            <div className="wr-figure">
              <span className="wr-figure__label">投注 ROI</span>
              <span className={`wr-figure__value is-${toneOf(kpi.roi)}`}>
                <CountUp
                  value={kpi.roi}
                  runKey={runKey}
                  duration={1100}
                  delay={120}
                  format={(n) => toSignedPct(n)}
                />
              </span>
            </div>
            <span className="wr-figure__sep" aria-hidden="true" />
            <div className="wr-figure">
              <span className="wr-figure__label">本金回报</span>
              <span className={`wr-figure__value is-${toneOf(kpi.returnOnBase)}`}>
                <CountUp
                  value={kpi.returnOnBase}
                  runKey={runKey}
                  duration={1100}
                  delay={240}
                  format={(n) => toSignedPct(n)}
                />
              </span>
            </div>
          </div>
        </div>

        {/* 评级徽章 */}
        <div className="wr-emblem" aria-label={`周期评级 ${kpi.grade}，${kpi.gradeTitle}`}>
          <span className="wr-emblem__halo" aria-hidden="true" />
          <span className="wr-emblem__orbit" aria-hidden="true">
            <i />
          </span>
          <span className="wr-emblem__ring" aria-hidden="true" />
          <span className="wr-emblem__plate">
            <span className="wr-emblem__grade">{kpi.grade}</span>
          </span>
          <span className="wr-emblem__caption">PERFORMANCE</span>
          <span className="wr-emblem__title">{kpi.gradeTitle}</span>
        </div>
      </div>

      {children && <div className="wr-banner__kpis">{children}</div>}
    </div>
  )
}

/* ── KPI 格 ───────────────────────────────────────────────────────────── */

function KpiTile({ label, value, sub, tone = 'flat', Icon, index = 0 }) {
  return (
    <div className={`wr-kpi is-${tone}`} style={{ '--wr-delay': `${index * 55}ms` }}>
      <div className="wr-kpi__head">
        {Icon && <Icon size={13} />}
        <span>{label}</span>
      </div>
      <p className="wr-kpi__value">{value}</p>
      {sub && <p className="wr-kpi__sub">{sub}</p>}
    </div>
  )
}

/* ── 净值曲线 ─────────────────────────────────────────────────────────── */

function CampaignCurve({ curve }) {
  const points = Array.isArray(curve) ? curve : []
  if (points.length < 2) {
    return <div className="wr-empty">本周期尚无已结算流水，曲线待战果填充。</div>
  }

  const W = 760
  const H = 168
  const padX = 14
  const padTop = 16
  const padBottom = 22

  const values = points.map((p) => p.balance)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || Math.max(1, Math.abs(max) || 1)
  const x = (i) => padX + (i / (points.length - 1)) * (W - padX * 2)
  const y = (v) => padTop + (1 - (v - min) / span) * (H - padTop - padBottom)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - padBottom} L${x(0).toFixed(1)},${H - padBottom} Z`
  const zeroY = min <= 0 && max >= 0 ? y(0) : null
  const last = points[points.length - 1]
  const tone = last.balance >= points[0].balance ? 'win' : 'lose'

  return (
    <div className={`wr-curve is-${tone}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="wr-curve__svg">
        <defs>
          <linearGradient id="wrCurveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--wr-curve-stroke)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--wr-curve-stroke)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={padX}
            y1={padTop + ratio * (H - padTop - padBottom)}
            x2={W - padX}
            y2={padTop + ratio * (H - padTop - padBottom)}
            className="wr-curve__guide"
          />
        ))}
        {zeroY !== null && (
          <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} className="wr-curve__zero" />
        )}
        <path d={area} fill="url(#wrCurveFill)" />
        <path d={line} className="wr-curve__line" />
        {points.map((p, i) =>
          p.kind === 'injection' ? (
            <circle key={`inj-${i}`} cx={x(i)} cy={y(p.balance)} r="3.4" className="wr-curve__inject" />
          ) : null,
        )}
        <circle cx={x(points.length - 1)} cy={y(last.balance)} r="4" className="wr-curve__head" />
      </svg>
      <div className="wr-curve__axis">
        <span>{points[0].dateLabel || '开局'}</span>
        <span className="wr-curve__legend">
          <i className="wr-curve__dot is-inject" /> 注资 / 划拨
        </span>
        <span>{last.dateLabel || '至今'}</span>
      </div>
    </div>
  )
}

/* ── 战绩节奏 ─────────────────────────────────────────────────────────── */

function OutcomeDigest({ entries, kpi }) {
  const settled = entries.filter((row) => row.settled).slice().reverse()
  const recent = settled.slice(-18)

  return (
    <div className="wr-panel wr-outcome">
      <div className="wr-panel__head">
        <Activity size={14} />
        <div>
          <p className="wr-panel__eyebrow">Outcome sequence</p>
          <h3>结果序列</h3>
        </div>
        <span className="wr-panel__count">按发生顺序</span>
      </div>

      {recent.length === 0 ? (
        <div className="wr-empty">本周期尚无已结算战果。</div>
      ) : (
        <>
          <div className="wr-outcome__score">
            <div>
              <strong>{kpi.wins}</strong>
              <span>命中</span>
            </div>
            <i aria-hidden="true" />
            <div>
              <strong>{kpi.losses}</strong>
              <span>失手</span>
            </div>
            <i aria-hidden="true" />
            <div>
              <strong>{kpi.pendingCount}</strong>
              <span>在途</span>
            </div>
          </div>

          <div className="wr-outcome__sequence" aria-label="最近战绩序列">
            {recent.map((row, index) => {
              const tone = toneOf(row.profit)
              return (
                <span
                  key={row.id}
                  className={`is-${tone}`}
                  title={`${row.fullDateLabel} · ${row.profit > 0 ? '命中' : row.profit < 0 ? '失手' : '走盘'} · ${toSigned(row.profit)} 元`}
                  style={{ '--wr-seq-delay': `${index * 34}ms` }}
                >
                  {row.profit > 0 ? 'W' : row.profit < 0 ? 'L' : 'D'}
                </span>
              )
            })}
          </div>
          <p className="wr-outcome__hint">显示最近 {recent.length} 笔 · 从左至右</p>

          <div className="wr-outcome__split">
            <div>
              <span>最佳单笔</span>
              <strong className="is-win">{kpi.bestEntry ? toSigned(kpi.bestEntry.profit) : '—'}</strong>
            </div>
            <div>
              <span>最差单笔</span>
              <strong className="is-lose">{kpi.worstEntry ? toSigned(kpi.worstEntry.profit) : '—'}</strong>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ── 分项战果（通用条形榜） ───────────────────────────────────────────── */

function BreakdownList({
  title,
  Icon,
  rows,
  emptyHint,
  renderLabel,
  metric = 'profit',
  showEmpty = false,
  className = '',
}) {
  const visible = showEmpty ? rows : rows.filter((row) => row.settled > 0)
  const hasData = visible.some((row) => row.settled > 0)

  // 条长与主数字编码同一个量 —— 显示 ROI 就按 ROI 的量级排条，
  // 显示盈亏就按盈亏排条。否则「数字最大的条最短」会读成假信号。
  const valueOf = (row) => (metric === 'roi' ? row.roi : row.profit)
  const scale = Math.max(1e-6, ...visible.map((row) => Math.abs(valueOf(row))))

  return (
    <div className={`wr-panel wr-breakdown ${className}`}>
      <div className="wr-panel__head">
        <Icon size={14} />
        <div>
          <p className="wr-panel__eyebrow">Performance split</p>
          <h3>{title}</h3>
        </div>
      </div>
      {!hasData ? (
        <div className="wr-empty">{emptyHint}</div>
      ) : (
        <ul className="wr-bars">
          {visible.map((row, index) => {
            const value = valueOf(row)
            const tone = row.settled === 0 ? 'idle' : toneOf(row.profit)
            const width = row.settled === 0 ? '0%' : `${Math.max(3, (Math.abs(value) / scale) * 48)}%`
            return (
              <li
                key={row.key}
                className={`wr-bar is-${tone}`}
                style={{ '--wr-delay': `${index * 45}ms`, '--wr-bar-size': width }}
              >
                <div className="wr-bar__row">
                  <span className="wr-bar__label">
                    <i>{String(index + 1).padStart(2, '0')}</i>
                    {renderLabel ? renderLabel(row) : row.label}
                  </span>
                  <span className="wr-bar__metric">
                    {row.settled === 0 ? '—' : metric === 'roi' ? toSignedPct(row.roi) : `${toSigned(row.profit)} rmb`}
                  </span>
                </div>
                <div className="wr-bar__track">
                  <span className="wr-bar__fill" />
                </div>
                <div className="wr-bar__foot">
                  <span>
                    {row.settled === 0
                      ? '本期无样本'
                      : metric === 'roi'
                        ? `${toSigned(row.profit)} rmb`
                        : `ROI ${toSignedPct(row.roi)}`}
                  </span>
                  <span>
                    {row.settled === 0
                      ? ''
                      : `${Math.round(row.count)} 笔 · 投入 ${toRmb(row.inputs)} · 命中 ${row.hitRate.toFixed(0)}%`}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ── 逐笔流水 ─────────────────────────────────────────────────────────── */

function EntryLedger({ entries, modeLabel }) {
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
  }, [entries])

  const totalPages = Math.max(1, Math.ceil(entries.length / LEDGER_PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const rows = entries.slice(safePage * LEDGER_PAGE_SIZE, safePage * LEDGER_PAGE_SIZE + LEDGER_PAGE_SIZE)
  const rangeStart = entries.length === 0 ? 0 : safePage * LEDGER_PAGE_SIZE + 1
  const rangeEnd = Math.min(entries.length, safePage * LEDGER_PAGE_SIZE + rows.length)

  return (
    <div className="wr-panel wr-panel--wide">
      <div className="wr-panel__head">
        <Layers size={14} />
        <div>
          <p className="wr-panel__eyebrow">Investment history</p>
          <h3>下注明细</h3>
        </div>
        <span className="wr-panel__fresh"><ShieldCheck size={12} /> 结果实时匹配</span>
      </div>

      {entries.length === 0 ? (
        <div className="wr-empty">本周期还没有任何下注记录。</div>
      ) : (
        <>
          <div className="wr-ledger">
            <table className="wr-ledger__table">
              <thead>
                <tr>
                  <th className="w-[76px]">日期</th>
                  <th>对阵 · 选项</th>
                  <th className="w-[72px] text-right">注额</th>
                  <th className="w-[68px] text-right">赔率</th>
                  <th className="w-[68px] text-center">结果</th>
                  <th className="w-[92px] text-right">盈亏</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tone = row.settled ? toneOf(row.profit) : 'pending'
                  return (
                    <tr key={row.id} className={`is-${tone}`}>
                      <td className="wr-ledger__date">{row.dateLabel}</td>
                      <td>
                        <div className="wr-legs">
                          {row.matches.map((leg, idx) => (
                            <div key={leg.id || idx} className="wr-leg">
                              <span className="wr-leg__teams">
                                {leg.homeTeam}
                                <i>vs</i>
                                {leg.awayTeam}
                              </span>
                              <span className="wr-leg__entry">{leg.entryText}</span>
                              {leg.results && <span className="wr-leg__score">{leg.results}</span>}
                              {leg.isCorrect === true && <span className="wr-leg__flag is-hit">中</span>}
                              {leg.isCorrect === false && <span className="wr-leg__flag is-miss">失</span>}
                            </div>
                          ))}
                        </div>
                        <div className="wr-ledger__tags">
                          {row.legs > 1 && <span className="wr-tag">{row.legs} 串</span>}
                          {row.modes.map((mode) => (
                            <span key={mode} className="wr-tag is-mode">{modeLabel(mode)}</span>
                          ))}
                          {row.leagues.map((league) => (
                            <span key={league} className="wr-tag is-league">{league}</span>
                          ))}
                        </div>
                      </td>
                      <td className="wr-ledger__num">{toRmb(row.inputs)}</td>
                      <td className="wr-ledger__num">{row.combinedOdds.toFixed(2)}</td>
                      <td className="text-center">
                        <span className={`wr-status is-${tone}`}>
                          {row.settled ? (row.profit > 0 ? '中' : row.profit < 0 ? '失' : '平') : '待结'}
                        </span>
                      </td>
                      <td className={`wr-ledger__profit is-${tone}`}>
                        {row.settled ? toSigned(row.profit) : '—'}
                        {row.settled && row.roi !== null && (
                          <em>{toSignedPct(row.roi, 0)}</em>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="wr-pager">
            <span>显示 {rangeStart}–{rangeEnd} / 共 {entries.length} 笔</span>
            <div className="wr-pager__btns">
              <button
                type="button"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ── 页面 ─────────────────────────────────────────────────────────────── */

export default function WarReportPage() {
  const [dataVersion, setDataVersion] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const railRef = useRef(null)
  const modeLabel = useModeLabelMap()

  // 结算界面一落笔就派发 dugou:data-changed —— 战报据此重算，results 永远跟最新的。
  useEffect(() => {
    const handler = () => setDataVersion((v) => v + 1)
    window.addEventListener('dugou:data-changed', handler)
    return () => window.removeEventListener('dugou:data-changed', handler)
  }, [])

  // dataVersion 是手动刷新触发器，故意作为依赖。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { periods, currentId } = useMemo(() => getCyclePeriods(), [dataVersion])

  const activeId = selectedId && periods.some((p) => p.id === selectedId) ? selectedId : currentId

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const report = useMemo(() => getWarReport(activeId), [activeId, dataVersion])

  const handleRename = useCallback((cycleId, name) => {
    setCycleTitle(cycleId, name)
    setDataVersion((v) => v + 1)
  }, [])

  const runKey = `${activeId}:${dataVersion}`

  const scrollRail = (direction) => {
    railRef.current?.scrollBy({ left: direction * 356, behavior: 'smooth' })
  }

  if (!report) {
    return (
      <div className="page-shell page-content-wide pt-5 motion-v2-scope">
        <div className="wr-empty">尚无周期数据。</div>
      </div>
    )
  }

  const { kpi } = report

  return (
    <div className="page-shell page-content-wide pt-5 space-y-5 motion-v2-scope warreport-scope">
      {/* 一整块沉浸式液态玻璃舞台：标题、主战果和周期选择不再拆成三张卡 */}
      <section className="wr-showcase">
        <div className="wr-liquid-field" aria-hidden="true">
          <span className="wr-liquid-orb is-one" />
          <span className="wr-liquid-orb is-two" />
          <span className="wr-liquid-orb is-three" />
          <span className="wr-liquid-glint" />
        </div>

        <div className="wr-page-head">
          <div className="wr-page-head__copy">
            <p className="wr-page-head__eyebrow"><span /> Performance archive</p>
            <h1>战报</h1>
            <p>
              每个周期，都值得一次清晰的回看。
              {isPreviewMode() && <span>· 演示数据</span>}
            </p>
          </div>
          <div className="wr-sync-note">
            <Cloud size={17} />
            <div>
              <span>Cloud archive</span>
              <strong>周期标题与数据同步</strong>
            </div>
          </div>
        </div>

        <VerdictBanner report={report} runKey={runKey} onRename={handleRename}>
          <KpiTile
            index={0}
            Icon={Wallet}
            label="周期本金"
            value={toRmb(report.period.baseCapital)}
            sub={report.period.allocation > 0 ? `含开局划拨 ${toRmb(report.period.allocation)}` : '期内注资合计'}
          />
          <KpiTile
            index={1}
            Icon={Target}
            label="命中率"
            value={`${kpi.hitRate.toFixed(1)}%`}
            sub={`${kpi.wins} 中 / ${kpi.losses} 失`}
            tone={kpi.hitRate >= 50 ? 'win' : 'lose'}
          />
          <KpiTile
            index={2}
            Icon={Layers}
            label="投入总额"
            value={toRmb(kpi.totalInputs)}
            sub={kpi.pendingCount > 0 ? `另有 ${toRmb(kpi.pendingInputs)} 在途` : `均注 ${toRmb(kpi.avgStake)}`}
          />
          <KpiTile
            index={3}
            Icon={TrendingDown}
            label="最大回撤"
            value={toRmb(kpi.maxDrawdown)}
            sub="期内峰谷差"
            tone={kpi.maxDrawdown > 0 ? 'lose' : 'flat'}
          />
          <KpiTile
            index={4}
            Icon={TrendingUp}
            label="最长连胜"
            value={`${kpi.bestWinStreak} 连`}
            sub={`最长连败 ${kpi.worstLoseStreak} 连`}
            tone={kpi.bestWinStreak >= kpi.worstLoseStreak ? 'win' : 'lose'}
          />
          <KpiTile
            index={5}
            Icon={Award}
            label="单笔最佳"
            value={kpi.bestEntry ? toSigned(kpi.bestEntry.profit) : '—'}
            sub={kpi.worstEntry ? `最差 ${toSigned(kpi.worstEntry.profit)}` : '尚无已结算'}
            tone="win"
          />
        </VerdictBanner>

        <div className="wr-cycle-browser">
          <div className="wr-cycle-browser__head">
            <div>
              <span>选择周期</span>
              <strong>{periods.length} 个周期</strong>
            </div>
            <div className="wr-cycle-browser__nav">
              <button type="button" onClick={() => scrollRail(-1)} aria-label="向前浏览周期">
                <ChevronLeft size={15} />
              </button>
              <button type="button" onClick={() => scrollRail(1)} aria-label="向后浏览周期">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          <div className="wr-rail" ref={railRef} role="tablist" aria-label="选择战报周期">
            {periods.map((period) => (
              <PeriodCard
                key={period.id}
                period={period}
                active={period.id === activeId}
                onSelect={setSelectedId}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 战局走势 */}
      <div className="wr-section-lead">
        <span>周期趋势</span>
        <h2>一次结算，不止一个数字。</h2>
      </div>
      <div className="wr-battle-grid">
        <div className="wr-panel wr-curve-panel">
          <div className="wr-panel__head">
            <TrendingUp size={14} />
            <div>
              <p className="wr-panel__eyebrow">Capital trajectory</p>
              <h3>周期净值推进</h3>
            </div>
            <span className="wr-panel__count">
              结束余额 <strong>{toRmb(report.period.endBalance)}</strong>
            </span>
          </div>
          <CampaignCurve curve={report.curve} />
        </div>
        <OutcomeDigest entries={report.entries} kpi={kpi} />
      </div>

      {/* 分项战果 */}
      <div className="wr-section-lead">
        <span>表现拆解</span>
        <h2>从结果里，找到真正有效的模式。</h2>
      </div>
      <div className="wr-grid-3">
        <BreakdownList
          title="分联赛战果"
          Icon={Flag}
          rows={report.leagues}
          emptyHint="本周期尚无已结算样本。"
        />
        <BreakdownList
          title="分注额档 ROI"
          Icon={Wallet}
          rows={report.stakeBuckets}
          emptyHint="本周期尚无已结算样本。"
          metric="roi"
          showEmpty
        />
        <BreakdownList
          title="分策略模式"
          Icon={Swords}
          rows={report.modes}
          emptyHint="本周期尚无已结算样本。"
          renderLabel={(row) => modeLabel(row.label)}
        />
      </div>

      {/* 分周 */}
      <BreakdownList
        title="分自然周盈亏"
        Icon={CalendarDays}
        rows={report.weeks}
        emptyHint="本周期尚无已结算样本。"
        className="wr-panel--weeks"
      />

      {/* 逐笔流水 */}
      <div className="wr-section-lead is-compact">
        <span>全部记录</span>
        <h2>每一笔，都有据可循。</h2>
      </div>
      <EntryLedger entries={report.entries} modeLabel={modeLabel} />

      <p className="wr-footnote">
        <ShieldCheck size={13} />
        <span>
          周期分界线与「蓄水池余额 · 历史明细」中的止盈 / 止损结算完全一致。跨联赛、跨模式的串关按腿数均摊计入各分项，
          故分项之和与总计一致。结算界面填回的比分与命中状态实时反映在逐笔战果中。
        </span>
      </p>
    </div>
  )
}
