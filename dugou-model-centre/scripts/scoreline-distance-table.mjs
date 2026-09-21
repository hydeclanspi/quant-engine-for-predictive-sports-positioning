#!/usr/bin/env node
/**
 * scoreline-distance-table.mjs — 比分距离函数原型：样例 case 输出表
 *
 * 用法：
 *   node scripts/scoreline-distance-table.mjs                              # 默认：exponential, scale=1.8, total=0.31
 *   node scripts/scoreline-distance-table.mjs --total=0.5                   # 提高总进球权重
 *   node scripts/scoreline-distance-table.mjs --scale=1.75                  # 调整封顶速度（球数尺度）
 *   node scripts/scoreline-distance-table.mjs --transform=saturating --total=0.25
 *
 * 归一口径：以「预测 1-0、实际 0-1」为 100（"明显的方向错误"标尺）。
 */

import process from 'node:process'
import { scorelineDistance } from '../src/lib/readQuality.js'

const args = process.argv.slice(2)
const readArg = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`))
  return found ? found.slice(name.length + 3) : fallback
}
const transform = readArg('transform', 'exponential')
const exponentialScale = Number(readArg('scale', '1.8'))
// 0.31 = 选定的总进球权重：让 1-1→5-5 有可见差别，又不把其他案例抬太多
const totalWeight = Number(readArg('total', '0.31'))

const CASES = [
  { pred: [2, 1], actual: [2, 1], note: '基准：完全命中' },
  { pred: [3, 0], actual: [5, 0], note: '同向、打花更狠（目标：可忽略）' },
  { pred: [4, 1], actual: [3, 2], note: '同向、但形态改了（目标：比较明显）' },
  { pred: [1, 0], actual: [0, 1], note: '反向 1 球（归一标尺 = 100）' },
  { pred: [2, 0], actual: [3, 0], note: '同向 +1 球' },
  { pred: [2, 0], actual: [2, 1], note: '同向，被追回一球' },
  { pred: [1, 1], actual: [2, 2], note: '平局，但进球更多' },
  { pred: [1, 1], actual: [4, 4], note: '平局，进球多两个' },
  { pred: [1, 1], actual: [5, 5], note: '平局，进球多三个' },
  { pred: [1, 1], actual: [0, 0], note: '平局，但更闷' },
  { pred: [1, 0], actual: [1, 1], note: '主胜 → 平' },
  { pred: [1, 1], actual: [0, 1], note: '平 → 客胜' },
  { pred: [0, 0], actual: [3, 0], note: '闷平 → 大胜' },
  { pred: [2, 1], actual: [1, 2], note: '反向 1 球（另一条路）' },
  { pred: [3, 1], actual: [1, 3], note: '反向 2 球' },
  { pred: [1, 0], actual: [4, 0], note: '同向，大爆发' },
  { pred: [0, 2], actual: [3, 2], note: '客胜 → 主胜逆转' },
  { pred: [2, 2], actual: [4, 3], note: '早期例子 A：读法接近' },
  { pred: [2, 2], actual: [4, 0], note: '早期例子 B：读法跑偏' },
  { pred: [1, 0], actual: [0, 0], note: '主胜 → 闷平' },
  { pred: [2, 0], actual: [0, 2], note: '反向 2 球（对称检验）' },
]

const toPoint = ([home, away]) => ({ home, away })

const rows = CASES.map(({ pred, actual, note }) => {
  const distance = scorelineDistance(toPoint(pred), toPoint(actual), {
    transform,
    totalWeight,
    exponentialScale,
  }).distance
  return { label: `${pred[0]}-${pred[1]} → ${actual[0]}-${actual[1]}`, note, distance }
})

const flip = rows.find((row) => row.label.startsWith('1-0 → 0-1'))
const fmt = (value) => value.toFixed(3)
const rel = (value) => ((value / flip.distance) * 100).toFixed(1)

console.log(`# 比分距离原型 · transform = ${transform} · scale = ${exponentialScale} · totalWeight = ${totalWeight}\n`)
console.log('| # | 预测 → 实际 | d | 归一（1-0→0-1 = 100） | 解读 |')
console.log('| --- | --- | --- | --- | --- |')
rows.forEach((row, index) => {
  console.log(`| ${index} | ${row.label} | ${fmt(row.distance)} | ${rel(row.distance)} | ${row.note} |`)
})
