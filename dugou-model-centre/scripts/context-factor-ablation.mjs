#!/usr/bin/env node
/**
 * ============================================================================
 *  context-factor-ablation.mjs — 情境因子消融试验（四.1）
 * ============================================================================
 *  问题：在控制 conf 与市场隐含概率 (1/odds) 后，MODE / TYS / FID / FSE
 *        对「命中」是否还有增量预测力？（双重计数检验）
 *
 *  用法：
 *    node scripts/context-factor-ablation.mjs                      # 默认 genesisBundle
 *    node scripts/context-factor-ablation.mjs path/to/bundle.json  # App「导出数据」的 JSON
 *
 *  方法：
 *    Part A  数据体检 + 因子与 conf 的相关性（Pearson/Spearman）
 *    Part B  Logistic 回归 LOO-CV：基线 → 逐个加因子 → 全加，看 Δlog-loss / ΔBrier
 *    Part C  Walk-forward 桶 lift 检验（复刻生产 learnContextFactors 的
 *            shrinkage K=12、每桶≥5，但严格样本外评估）
 *    Part D  Bootstrap 系数稳定性（全模型，500 次重抽样）
 *
 *  无第三方依赖，可直接 node 运行。
 * ============================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const bundleArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
const bundlePath = bundleArg
  ? path.resolve(process.cwd(), bundleArg)
  : path.join(projectRoot, 'src/data/genesisBundle.json')
const outPath = path.join(projectRoot, 'output/context-factor-ablation.md')

// ── 数据提取 ─────────────────────────────────────────────────────────────

const raw = JSON.parse(fs.readFileSync(bundlePath, 'utf8'))
const investments = Array.isArray(raw) ? raw : raw.investments || []
const settled = investments.filter((i) => i?.status === 'win' || i?.status === 'lose')

const num = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

const legs = []
for (const inv of settled) {
  for (const m of inv.matches || []) {
    if (typeof m.is_correct !== 'boolean') continue
    legs.push({
      ticketId: inv.id,
      createdAt: inv.created_at || '',
      y: m.is_correct ? 1 : 0,
      conf: num(m.conf),
      odds: num(m.odds),
      mode: m.mode || null,
      tysHome: m.tys_home || null,
      tysAway: m.tys_away || null,
      fid: num(m.fid),
      fseHome: num(m.fse_home),
      fseAway: num(m.fse_away),
      fseMatch: num(m.fse_match),
    })
  }
}
legs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))

const withMarket = legs.filter((l) => l.conf != null && l.odds != null && l.odds > 1)
for (const l of withMarket) l.pMkt = 1 / l.odds

// TYS 先验映射（生产硬编码，仅用于把类别转数值做回归；桶检验仍用原始类别）
const TYS_NUM = { S: 0.94, M: 0.87, L: 0.87, H: 0.91 }

const FACTORS = [
  { key: 'fid', name: 'FID', num: (l) => l.fid },
  { key: 'fseMatch', name: 'FSE(match)', num: (l) => l.fseMatch },
  { key: 'tysHome', name: 'TYS(home)', num: (l) => (l.tysHome ? TYS_NUM[l.tysHome] ?? null : null), cat: (l) => l.tysHome },
  { key: 'tysAway', name: 'TYS(away)', num: (l) => (l.tysAway ? TYS_NUM[l.tysAway] ?? null : null), cat: (l) => l.tysAway },
  { key: 'mode', name: 'MODE', num: null, cat: (l) => l.mode },
]

// ── 统计小工具 ───────────────────────────────────────────────────────────

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
const logLoss = (pairs) =>
  -mean(pairs.map(([y, p]) => y * Math.log(Math.max(p, 1e-9)) + (1 - y) * Math.log(Math.max(1 - p, 1e-9))))
const brier = (pairs) => mean(pairs.map(([y, p]) => (y - p) ** 2))

function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN
}

function rank(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(xs.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}
const spearman = (xs, ys) => pearson(rank(xs), rank(ys))

// 岭正则 logistic 回归（IRLS）
function fitLogistic(X, y, l2 = 1) {
  const n = X.length, p = X[0].length
  let beta = new Array(p).fill(0)
  for (let iter = 0; iter < 50; iter++) {
    const grad = new Array(p).fill(0)
    const H = Array.from({ length: p }, () => new Array(p).fill(0))
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((s, x, j) => s + x * beta[j], 0)
      const pr = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))))
      const w = Math.max(pr * (1 - pr), 1e-6)
      const r = y[i] - pr
      for (let j = 0; j < p; j++) {
        grad[j] += X[i][j] * r
        for (let k = j; k < p; k++) H[j][k] += X[i][j] * w * X[i][k]
      }
    }
    for (let j = 1; j < p; j++) { grad[j] -= l2 * beta[j]; H[j][j] += l2 }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) H[j][k] = H[k][j]
    // 高斯消元解 H·delta = grad
    const A = H.map((row, i) => [...row, grad[i]])
    let ok = true
    for (let col = 0; col < p && ok; col++) {
      let piv = col
      for (let r2 = col + 1; r2 < p; r2++) if (Math.abs(A[r2][col]) > Math.abs(A[piv][col])) piv = r2
      if (Math.abs(A[piv][col]) < 1e-10) { ok = false; break }
      ;[A[col], A[piv]] = [A[piv], A[col]]
      for (let r2 = 0; r2 < p; r2++) {
        if (r2 === col) continue
        const f = A[r2][col] / A[col][col]
        for (let c = col; c <= p; c++) A[r2][c] -= f * A[col][c]
      }
    }
    if (!ok) break
    const delta = A.map((row, i) => row[p] / A[i][i])
    let maxD = 0
    for (let j = 0; j < p; j++) { beta[j] += delta[j]; maxD = Math.max(maxD, Math.abs(delta[j])) }
    if (maxD < 1e-8) break
  }
  return beta
}

const predict = (X, beta) => X.map((row) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, row.reduce((s, x, j) => s + x * beta[j], 0))))))

// 标准化特征列
function standardize(cols) {
  return cols.map((col) => {
    const m = mean(col)
    const sd = Math.sqrt(mean(col.map((x) => (x - m) ** 2))) || 1
    return col.map((x) => (x - m) / sd)
  })
}

// LOO-CV 评估一组特征构造器
function looEval(rows, featFns) {
  const pairs = []
  for (let i = 0; i < rows.length; i++) {
    const train = rows.filter((_, j) => j !== i)
    const rawCols = featFns.map((f) => train.map(f))
    const stdCols = standardize(rawCols)
    const Xtrain = train.map((_, r) => [1, ...stdCols.map((c) => c[r])])
    const beta = fitLogistic(Xtrain, train.map((r) => r.y))
    // 用训练集的均值/方差变换测试行
    const testFeats = featFns.map((f, j) => {
      const col = rawCols[j]
      const m = mean(col)
      const sd = Math.sqrt(mean(col.map((x) => (x - m) ** 2))) || 1
      return (f(rows[i]) - m) / sd
    })
    const p = predict([[1, ...testFeats]], beta)[0]
    pairs.push([rows[i].y, p])
  }
  return { ll: logLoss(pairs), br: brier(pairs), pairs }
}

// ── Part A：体检 + 相关性 ────────────────────────────────────────────────

const lines = []
const say = (s = '') => { lines.push(s); console.log(s) }

say(`# 情境因子消融试验报告`)
say(``)
say(`数据源：\`${path.basename(bundlePath)}\` ｜ 已结算票 ${settled.length} ｜ 有效腿 ${withMarket.length}（需同时具备 conf 与 odds>1）`)
say(`整体命中率：${(mean(withMarket.map((l) => l.y)) * 100).toFixed(1)}%`)
say(``)
say(`## Part A · 因子体检与共线性`)
say(``)
say(`| 因子 | 非缺失 | 缺失率 | 与 conf 的 Pearson | 与 conf 的 Spearman |`)
say(`| --- | --- | --- | --- | --- |`)
for (const f of FACTORS) {
  const vals = withMarket.map((l) => (f.num ? f.num(l) : f.cat ? f.cat(l) : null))
  const okIdx = vals.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0)
  const fv = okIdx.map((i) => vals[i])
  const cv = okIdx.map((i) => withMarket[i].conf)
  const numeric = Boolean(f.num)
  const pr = numeric && fv.length > 5 ? pearson(fv, cv) : NaN
  const sr = numeric && fv.length > 5 ? spearman(fv, cv) : NaN
  const distinct = new Set(fv.map((x) => (typeof x === 'number' ? x.toFixed(3) : x))).size
  say(`| ${f.name} | ${fv.length} | ${((1 - fv.length / withMarket.length) * 100).toFixed(0)}% | ${Number.isFinite(pr) ? pr.toFixed(3) : '—（类别型，见桶检验）'} | ${Number.isFinite(sr) ? sr.toFixed(3) : '—'} | （${distinct} 个不同取值）`)
}
say(``)
say(`> |r|>0.5 视为与 conf 高度共线：因子里含有的信息 conf 里基本已有。`)

// ── Part B：LOO 消融 ─────────────────────────────────────────────────────

say(``)
say(`## Part B · Logistic 回归 LOO-CV 消融（标签 = 二元命中）`)
say(``)
say(`| 模型 | 特征 | LOO log-loss | Δ vs 基线 | LOO Brier |`)
say(`| --- | --- | --- | --- | --- |`)

const fConf = (l) => l.conf
const fMkt = (l) => l.pMkt
const base = looEval(withMarket, [fConf])
const baseMkt = looEval(withMarket, [fConf, fMkt])
say(`| M0 | conf | ${base.ll.toFixed(4)} | — | ${base.br.toFixed(4)} |`)
say(`| M1 | conf + 市场隐含概率 | ${baseMkt.ll.toFixed(4)} | ${(baseMkt.ll - base.ll).toFixed(4)} | ${baseMkt.br.toFixed(4)} |`)

const factorLoo = {}
for (const f of FACTORS) {
  if (!f.num) { factorLoo[f.key] = null; continue }
  const rows = withMarket.filter((l) => f.num(l) != null)
  if (rows.length < 30) { factorLoo[f.key] = { skipped: rows.length }; continue }
  const b = looEval(rows, [fConf, fMkt])
  const a = looEval(rows, [fConf, fMkt, (l) => f.num(l)])
  factorLoo[f.key] = { n: rows.length, before: b, after: a }
  say(`| M1+${f.name} | +${f.name}（n=${rows.length}）| ${a.ll.toFixed(4)} | ${(a.ll - b.ll).toFixed(4)} | ${a.br.toFixed(4)} |`)
}
// 全加（只用所有数值因子都非缺失的行）
const numFactors = FACTORS.filter((f) => f.num)
const fullRows = withMarket.filter((l) => numFactors.every((f) => f.num(l) != null))
if (fullRows.length >= 30) {
  const b = looEval(fullRows, [fConf, fMkt])
  const a = looEval(fullRows, [fConf, fMkt, ...numFactors.map((f) => (l) => f.num(l))])
  say(`| M1+全部数值因子 | +${numFactors.map((f) => f.name).join('+')}（n=${fullRows.length}）| ${a.ll.toFixed(4)} | ${(a.ll - b.ll).toFixed(4)} | ${a.br.toFixed(4)} |`)
}
say(``)
say(`> Δ 为负 = 加入因子后样本外 log-loss 改善（有增量信息）；Δ≥0 = 该因子没有增量（疑似重复计数）。`)

// ── Part C：walk-forward 桶 lift（生产口径，样本外）──────────────────────

say(``)
say(`## Part C · Walk-forward 桶 lift 检验（复刻生产 shrinkage K=12、每桶≥5）`)
say(``)
say(`对每条腿：只用它之前的历史估计「该桶命中率/全局命中率」lift，乘到基线概率上；`)
say(`与不用 lift 的基线比较样本外 log-loss。基线 = 历史全局命中率收缩到 0.5（K=8）。`)
say(``)
say(`| 因子 | 可用预测数 | 基线 LL | +lift LL | Δ |`)
say(`| --- | --- | --- | --- | --- |`)

const MIN_TRAIN = 20
const clampP = (p) => Math.max(0.02, Math.min(0.98, p))

for (const f of FACTORS) {
  if (!f.cat) continue
  const rows = withMarket.filter((l) => f.cat(l) != null)
  const basePairs = [], liftPairs = []
  for (let t = MIN_TRAIN; t < rows.length; t++) {
    const hist = rows.slice(0, t)
    const global = mean(hist.map((h) => h.y))
    const baseP = clampP((hist.length * global + 8 * 0.5) / (hist.length + 8))
    const bucket = hist.filter((h) => f.cat(h) === f.cat(rows[t]))
    let p = baseP
    if (bucket.length >= 5) {
      const bucketHit = mean(bucket.map((b) => b.y))
      const shrunk = (bucket.length * bucketHit + 12 * global) / (bucket.length + 12)
      p = clampP(baseP * (shrunk / Math.max(global, 1e-6)))
    }
    basePairs.push([rows[t].y, baseP])
    liftPairs.push([rows[t].y, p])
  }
  if (basePairs.length < 10) {
    say(`| ${f.name} | ${basePairs.length}（样本不足）| — | — | — |`)
    continue
  }
  const bLL = logLoss(basePairs), lLL = logLoss(liftPairs)
  say(`| ${f.name} | ${basePairs.length} | ${bLL.toFixed(4)} | ${lLL.toFixed(4)} | ${(lLL - bLL).toFixed(4)} |`)
}
say(``)
say(`> Δ 为负 = 该因子的桶 lift 在严格样本外有帮助；Δ≥0 = 生产里的 lift 修正很可能是在拟合噪声。`)

// ── Part D：bootstrap 系数稳定性 ─────────────────────────────────────────

say(``)
say(`## Part D · 全模型系数 bootstrap（500 次重抽样）`)
say(``)

if (fullRows.length >= 30) {
  const B = 500
  const featFns = [fConf, fMkt, ...numFactors.map((f) => (l) => f.num(l))]
  const names = ['conf', '市场隐含', ...numFactors.map((f) => f.name)]
  const coefs = names.map(() => [])
  let seed = 42
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let b = 0; b < B; b++) {
    const sample = Array.from({ length: fullRows.length }, () => fullRows[Math.floor(rand() * fullRows.length)])
    const rawCols = featFns.map((f) => sample.map(f))
    const stdCols = standardize(rawCols)
    const X = sample.map((_, r) => [1, ...stdCols.map((c) => c[r])])
    const beta = fitLogistic(X, sample.map((r) => r.y))
    beta.slice(1).forEach((v, j) => coefs[j].push(v))
  }
  say(`| 特征 | 系数中位数 | 90% 区间 | 区间含 0？ |`)
  say(`| --- | --- | --- | --- |`)
  coefs.forEach((cs, j) => {
    cs.sort((a, b) => a - b)
    const med = cs[Math.floor(B / 2)]
    const lo = cs[Math.floor(B * 0.05)]
    const hi = cs[Math.floor(B * 0.95)]
    say(`| ${names[j]} | ${med.toFixed(3)} | [${lo.toFixed(3)}, ${hi.toFixed(3)}] | ${lo <= 0 && hi >= 0 ? '是（不稳定）' : '否'} |`)
  })
  say(``)
  say(`> 区间含 0 = 该因子对命中的边际贡献方向都不稳定，在现有样本量下不可信。`)
}

// ── 结论模板 ─────────────────────────────────────────────────────────────

say(``)
say(`## 判读规则`)
say(``)
say(`- **保留**：Part B Δ<0 且 Part D 区间不含 0，或 Part C Δ<0。`)
say(`- **合并/降维**：与 conf 共线 |r|>0.5 但桶检验有效 → 并入 conf 校准而非独立因子。`)
say(`- **停用**：B、C 双 Δ≥0 且 bootstrap 区间含 0 → 该因子在做重复计数，建议从生产 lift 中移除。`)
say(`- **样本不足下任何结论都是暂定的**——本脚本可随数据积累反复重跑。`)

fs.writeFileSync(outPath, lines.join('\n') + '\n')
console.log(`\n已写入 ${outPath}`)
