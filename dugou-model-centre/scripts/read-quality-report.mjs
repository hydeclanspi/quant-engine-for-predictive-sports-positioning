#!/usr/bin/env node
/**
 * ============================================================================
 *  read-quality-report.mjs — DuGou 2.0 原型报告生成器
 * ============================================================================
 *  用法：
 *    node scripts/read-quality-report.mjs                       # 默认内置样包
 *    node scripts/read-quality-report.mjs path/to/bundle.json   # 任意导出包
 *    node scripts/read-quality-report.mjs bundle.json --out=report.md
 *
 *  导出包格式与应用一致：{ system_config, team_profiles, investments, ... }
 *  （App 内"导出数据"生成的 JSON 可直接喂给本脚本。）
 *
 * @module scripts/read-quality-report
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  READ_TIER_LABELS,
  READ_TIERS,
  ajrObjectiveContrast,
  buildReadRecords,
  calibratedLambdaFromPoint,
  deriveMarketProbabilities,
  disagreementBuckets,
  fitFusionWeight,
  learnForecastBias,
  legacyAjrBuckets,
  pointForecastToLambda,
  readStateAutocorrelation,
  simulateCalibrationLoop,
} from '../src/lib/readQuality.js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')

const args = process.argv.slice(2)
const outArg = args.find((arg) => arg.startsWith('--out='))
const bundleArg = args.find((arg) => !arg.startsWith('--'))
const bundlePath = bundleArg ? path.resolve(process.cwd(), bundleArg) : path.join(projectRoot, 'src/data/genesisBundle.json')
const outPath = outArg ? path.resolve(process.cwd(), outArg.slice(6)) : path.join(projectRoot, 'output/read-quality-report.md')

const fmt = (value, digits = 2) => (Number.isFinite(value) ? Number(value).toFixed(digits) : '—')
const pct = (value, digits = 1) => (Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—')
const day = (value) => (value ? String(value).slice(0, 10) : '—')

const table = (headers, rows) => {
  if (rows.length === 0) return '_（无数据）_'
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  return [head, sep, body].join('\n')
}

const main = () => {
  if (!fs.existsSync(bundlePath)) {
    console.error(`[read-quality] 找不到数据文件：${bundlePath}`)
    process.exit(1)
  }

  const raw = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
  const investments = Array.isArray(raw) ? raw : Array.isArray(raw.investments) ? raw.investments : []
  const settledInvestments = investments.filter((item) => item?.status === 'win' || item?.status === 'lose')
  const records = buildReadRecords(investments)

  const isGenesis = path.basename(bundlePath) === 'genesisBundle.json'
  const sourceLabel = isGenesis
    ? '内置样包 `src/data/genesisBundle.json`（注意：可能为早期 demo/合成数据，非全量实盘）'
    : `导出包 \`${path.basename(bundlePath)}\``

  // ── 1. 数据体检 ──────────────────────────────────────────────────────
  const labeled = records.filter((record) => typeof record.isCorrect === 'boolean')
  const hits = labeled.filter((record) => record.isCorrect).length
  const tierCounts = new Map()
  records.forEach((record) => tierCounts.set(record.tier, (tierCounts.get(record.tier) || 0) + 1))

  const tierRows = [READ_TIERS.R3, READ_TIERS.R2A, READ_TIERS.R2B, READ_TIERS.R1].map((tier) => [
    READ_TIER_LABELS[tier],
    String(tierCounts.get(tier) || 0),
    tier === READ_TIERS.R3
      ? '双方进球分布（最强信号）'
      : tier === READ_TIERS.R2A
        ? '总进球 / 净胜球残差'
        : tier === READ_TIERS.R2B
          ? '净胜球粗分档（待上线）'
          : '只喂二元命中校准（现状）',
  ])

  // ── 2. R3 客观距离分 ─────────────────────────────────────────────────
  const r3 = records
    .filter((record) => record.tier === READ_TIERS.R3 && record.actual && record.primaryPoint)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const r3Rows = r3.map((record) => {
    const distance = record.distance
    return [
      day(record.date),
      `${record.homeTeam} vs ${record.awayTeam}`,
      record.points.map((point) => `${point.home}-${point.away}`).join(' / '),
      `${record.actual.home}-${record.actual.away}`,
      String(distance.l1),
      String(record.minDistance),
      fmt(record.ajr, 2),
      record.isCorrect === true ? '命中' : record.isCorrect === false ? '未中' : '—',
    ]
  })

  const r3Summary = (() => {
    if (r3.length === 0) return null
    const meanL1 = r3.reduce((sum, record) => sum + record.distance.l1, 0) / r3.length
    const meanDh = r3.reduce((sum, record) => sum + record.distance.dh, 0) / r3.length
    const meanDa = r3.reduce((sum, record) => sum + record.distance.da, 0) / r3.length
    const predictedDraws = r3.filter((record) => record.primaryPoint.home === record.primaryPoint.away).length
    const actualDraws = r3.filter((record) => record.actual.home === record.actual.away).length
    return {
      meanL1,
      meanDh,
      meanDa,
      predictedDrawRate: predictedDraws / r3.length,
      actualDrawRate: actualDraws / r3.length,
    }
  })()

  // ── 3. 通道 1：偏差 θ ────────────────────────────────────────────────
  const bias = learnForecastBias(r3)
  const biasRows = [
    ['主队进球', bias.home],
    ['客队进球', bias.away],
    ['总进球', bias.total],
  ].map(([label, entry]) => [
    label,
    String(entry.n),
    fmt(entry.sumPredicted),
    fmt(entry.sumActual),
    fmt(entry.rawRatio, 3),
    fmt(entry.bias, 3),
    fmt(entry.reliability, 2),
  ])

  // ── 4. 通道 2：登记 → 分布 → 任意盘口（演示）────────────────────────
  const demoPoint = { home: 3, away: 3 }
  const demoRaw = pointForecastToLambda(demoPoint)
  const demoCalibrated = calibratedLambdaFromPoint(demoPoint, bias)
  const demoMarkets = deriveMarketProbabilities(demoCalibrated.home, demoCalibrated.away)
  const demoRawMarkets = deriveMarketProbabilities(demoRaw.home, demoRaw.away)

  // ── 5. 通道 3：融合权重（真实数据，时间切分）────────────────────────
  const fusionRows = [...records]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((record, index) => ({
      pConf: record.conf,
      pMarket: record.marketProbability,
      y: record.isCorrect === true ? 1 : record.isCorrect === false ? 0 : null,
      index,
    }))
  const fusion = fitFusionWeight(fusionRows)
  const disagreeRows = disagreementBuckets(fusionRows).map((bucket) => [
    bucket.label,
    String(bucket.n),
    pct(bucket.hitRate),
    pct(bucket.avgConf),
    pct(bucket.avgMarket),
  ])

  // ── 6. 通道 4：状态探针 ──────────────────────────────────────────────
  const stateProbe = readStateAutocorrelation(records)

  // ── 7. Legacy AJR 情报 ───────────────────────────────────────────────
  const ajrRows = legacyAjrBuckets(records).map((bucket) => [
    bucket.label,
    String(bucket.n),
    pct(bucket.hitRate),
    pct(bucket.avgConf),
    fmt(bucket.avgMinDistance, 2),
  ])
  const contrast = ajrObjectiveContrast(records)

  // ── 8. 合成模拟：校准回路 ────────────────────────────────────────────
  const sim = simulateCalibrationLoop({ matches: 220, seed: 20260219 })

  // ── 报告组装 ─────────────────────────────────────────────────────────
  const sections = []

  sections.push(`# DuGou 2.0 · 读球质量原型机报告

生成时间：${new Date().toISOString()}  
数据源：${sourceLabel}  
样本：${investments.length} 笔票 / ${settledInvestments.length} 笔已结算 / ${records.length} 条腿

> 本报告是 readQuality 原型机的输出。核心原则：**距离分是损失函数，不是特征**；
> 概率层标签只有 is_correct；被损失训练出来的 θ / w 才是未来预测允许使用的参数。`)

  sections.push(`## 1. 数据体检 + 分辨率阶梯覆盖

- 已结算腿：**${records.length}** 条，其中有命中标签 ${labeled.length} 条（命中 ${hits} / 未中 ${labeled.length - hits}）。
- 阶梯覆盖：

${table(['登记档', '腿数', '本档能训练什么'], tierRows)}

> R1 是现状（conf + 命中）；2.0 的目标是让 R2A/R3 的占比自然上升——
> 你不需要每场都预测比分：有盘口线的腿自动进 R2A，愿意写比分时进 R3。`)

  if (r3.length > 0 && r3Summary) {
    sections.push(`## 2. R3 客观距离分（真实数据可算的部分）

${table(['日期', '对局', '登记比分（主/备）', '实际', '距离 L1', '最优 L1', 'AJR', '结果'], r3Rows)}

- 平均距离 **${fmt(r3Summary.meanL1)}** 球；平均方向偏差：主队 ${fmt(r3Summary.meanDh)} / 客队 ${fmt(r3Summary.meanDa)}（正 = 你预测得偏高）。
- 你预测平局的比例 **${pct(r3Summary.predictedDrawRate)}** vs 实际平局比例 **${pct(r3Summary.actualDrawRate)}**。

> 这就是"3-3 实际 4-3（距离 1）"与"2-2 实际 4-0（距离 4）"被区分的地方——
> 0/1 命中标签做不到这件事。`)

    sections.push(`## 3. 通道 1：个人预测偏差 θ（pilot）

θ = Σ实际 / Σ登记，按 n/(n+k) 向中性 1 收缩。校准后的 λ = 修正后的登记值 → 映射。

${table(['维度', 'n', 'Σ登记', 'Σ实际', '原始比值', '收缩后 bias', '可靠度'], biasRows)}

> n=${bias.sampleCount} 时这只是机制演示；2.0 里每结算一场就自动更新一次，
> 样本爬坡后 bias 才开始有资格进入预测。`)
  } else {
    sections.push(`## 2-3. R3 / 通道 1

本数据包中没有"有实际比分的比分登记"（R3 为空）。2.0 上线"预测比分"字段后这里会自动出数。`)
  }

  sections.push(`## 4. 通道 2：一次登记 → 全部盘口（演示）

演示登记：**预测 3-3**。当前 θ 下的校准 λ = (${fmt(demoCalibrated.home)}, ${fmt(demoCalibrated.away)})，未校准 λ = (${fmt(demoRaw.home)}, ${fmt(demoRaw.away)})。

${table(
    ['盘口', '未校准', '校准后'],
    [
      ['主胜', pct(demoRawMarkets.oneXTwo.home), pct(demoMarkets.oneXTwo.home)],
      ['平局', pct(demoRawMarkets.oneXTwo.draw), pct(demoMarkets.oneXTwo.draw)],
      ['客胜', pct(demoRawMarkets.oneXTwo.away), pct(demoMarkets.oneXTwo.away)],
      ['大 2.5', pct(demoRawMarkets.totals.find((row) => row.line === 2.5).over), pct(demoMarkets.totals.find((row) => row.line === 2.5).over)],
      ['小 2.5', pct(demoRawMarkets.totals.find((row) => row.line === 2.5).under), pct(demoMarkets.totals.find((row) => row.line === 2.5).under)],
      ['让 -1 主胜', pct(demoRawMarkets.handicaps.find((row) => row.line === -1).win), pct(demoMarkets.handicaps.find((row) => row.line === -1).win)],
    ],
  )}

校准后最可能比分：${demoMarkets.topScores.map((cell) => `${cell.score} (${pct(cell.p, 1)})`).join('、')}

> 一次登记 → 所有盘口共享同一个分布。你的"反共识信号"从此可以覆盖**没下注的盘口**。`)

  const fusionVerdict = (() => {
    if (!fusion.ready) return `_样本不足（n=${fusion.n}），暂不拟合。_`
    const bestBaseline = fusion.test.marketOnly.brier <= fusion.test.confOnly.brier ? '市场' : '你（conf）'
    const fusionWins = fusion.test.fusion.brier <= Math.min(fusion.test.confOnly.brier, fusion.test.marketOnly.brier) + 1e-12
    return fusionWins
      ? `融合在测试段不劣于两条基线（较优基线：${bestBaseline}）——w 有资格进入候选池，但仍需更多样本确认。`
      : `注意：融合在测试段**没有**跑赢较优基线（${bestBaseline}）。训练段学出的 w=${fmt(fusion.w, 2)} 不能外推——这就是为什么一切好坏判定都必须用时间外样本。`
  })()

  sections.push(`## 5. 通道 3：融合权重 w（真实数据，时间切分）

用前 ${fusion.ready ? fusion.trainN : '—'} 条拟合 w，后 ${fusion.ready ? fusion.testN : '—'} 条检验。w = 你的判断相对市场占的权重（0 = 全信市场，1 = 全信自己）。

${
    fusion.ready
      ? `${table(
          ['策略', 'Brier ↓', 'LogLoss ↓'],
          [
            ['你（conf）', fmt(fusion.test.confOnly.brier, 4), fmt(fusion.test.confOnly.logLoss, 4)],
            ['市场（1/odds）', fmt(fusion.test.marketOnly.brier, 4), fmt(fusion.test.marketOnly.logLoss, 4)],
            [`融合（w=${fmt(fusion.w, 2)}）`, fmt(fusion.test.fusion.brier, 4), fmt(fusion.test.fusion.logLoss, 4)],
          ],
        )}`
      : `_样本不足（n=${fusion.n}），暂不拟合。_`
  }

${fusionVerdict}

按分歧大小分桶：

${table(['|conf − 市场|', 'n', '命中率', '平均 conf', '平均市场'], disagreeRows)}

> 注意力放在"分歧大时谁对"——这是"什么时候该相信自己的反共识"的可学习答案。`)

  sections.push(`## 6. 通道 4：近期状态探针

${
    stateProbe.ready
      ? `窗口数 ${stateProbe.windows}，相邻窗口损失自相关 r = ${fmt(stateProbe.correlation, 3)}，判定：**${stateProbe.verdict}**（persistent = 状态有惯性，值得做成参数；no_clear_signal = 暂不启用）。`
      : `样本不足（窗口 ${stateProbe.windows}/${stateProbe.minWindows}），暂不下结论——按纪律，无结论就是无结论。`
  }`)

  sections.push(`## 7. Legacy 情报：1.0 时代的 AJR 有没有信号

${table(['AJR 桶', 'n', '命中率', '平均 conf', '平均客观距离'], ajrRows)}

- AJR 与客观距离的相关（R3 子集，n=${contrast.n}）：${fmt(contrast.correlation, 3)}

> 口径提醒：命中时 AJR 会被自动记为 0.8，所以"AJR 与命中高度重合"是**记账方式的产物**，
> 不构成"AJR 有预测力"的证据。它永远是赛后信息——只能做诊断，不能进任何预测输入。`)

  sections.push(`## 8. 合成模拟：校准回路机制证明（明确标注：合成数据）

真值：读球者对客队进球存在系统性低估 = ${sim.trueAwayBias}（即需要 ×${sim.expectedAwayCorrection} 的修正）。跑 ${sim.matches} 场。

- **λ 校准表（核心证据）**：

${table(
    ['维度', '未校准 λ 均值', '校准后 λ 均值', '实际进球均值'],
    [
      ['主队', fmt(sim.lambdaCalibration.home.raw, 3), fmt(sim.lambdaCalibration.home.calibrated, 3), fmt(sim.lambdaCalibration.home.actual, 3)],
      ['客队', fmt(sim.lambdaCalibration.away.raw, 3), fmt(sim.lambdaCalibration.away.calibrated, 3), fmt(sim.lambdaCalibration.away.actual, 3)],
    ],
  )}

- 学到的最终修正：主队 ×${sim.finalBias.home}，客队 ×${sim.finalBias.away}（目标 ×${sim.expectedAwayCorrection}）
- 对数损失（每场，越低越好）。单场对数损失被泊松随机性主导（约 2.9 纳特），窗口级差异基本是噪声——**证据以 λ 表为准**：

${table(
    ['阶段', '未校准', '校准后'],
    [
      [`全 ${sim.matches} 场平均`, fmt(sim.overallLoss.raw, 4), fmt(sim.overallLoss.calibrated, 4)],
      ['后 25 场', fmt(sim.lastWindow.raw, 4), fmt(sim.lastWindow.calibrated, 4)],
    ],
  )}

- θ 轨迹（每 10 场）：${sim.biasTrail.filter((_, index) => index % 3 === 0).map((entry) => `#${entry.i} 主 ×${entry.home} / 客 ×${entry.away}`).join('，')}

> 这就是"自动赋能"的端到端证明：结算 → 距离分（损失）→ 更新 θ → 下一次预测自动使用。
> 客队 λ 从 ${fmt(sim.lambdaCalibration.away.raw, 3)} 被学回 ${fmt(sim.lambdaCalibration.away.calibrated, 3)}（该样本实际均值 ${fmt(sim.lambdaCalibration.away.actual, 3)}）；
> θ 本身也有估计噪声，可靠度爬坡与收缩就是为此存在——全程不需要任何人工调参。`)

  sections.push(`## 9. 边界与下一步

- 本报告的账本分析在**内置样包**上完成（可能为 demo 数据）；把 App 导出的真实包喂给脚本即可复跑全量（123+ 笔）。
- R3/θ 目前是 pilot：真实数据里需要先积累"预测比分"登记（或继续用比分票）。
- θ 的比值估计会排除"登记值为 0"的样本（0 无法做乘性比值），因此每侧 n 可能不同；真实数据里要留意这类样本的占比。
- 本原型**尚未接线到 UI 与训练管道**：只读、零副作用。下一步是把 θ/w 接进 \`getPredictionCalibrationContext\` 成为新的一层（带可靠度爬坡门槛）。
- 纪律提醒：距离分永远不做特征、永远不给 p 当标签；一切好坏判定用时间外样本。`)

  const markdown = sections.join('\n\n---\n\n')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${markdown}\n`, 'utf8')
  console.log(markdown)
  console.log(`\n[read-quality] 报告已写入：${path.relative(process.cwd(), outPath)}`)
}

main()
