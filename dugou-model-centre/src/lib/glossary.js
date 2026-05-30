/**
 * Shared glossary for ExplainHover (「名词都能悬停解释」).
 *
 * Each entry is a `card` consumed by <ExplainHover term="…">: a plain-language
 * definition of a piece of jargon a first-time visitor would not know.
 *
 * Scope discipline: these are STANDARD quantitative terms (Kelly, Brier, Monte
 * Carlo, VaR…) — textbook concepts that are safe to spell out in demo/preview
 * mode. Proprietary naming (the calibration weights, strategy code-names, the
 * fragility internals) is deliberately NOT defined here; that stays masked.
 *
 * Card shape: { title, what, describes } — the runtime-specific fields
 * (current/baseline/status) are passed inline at the call site where needed.
 */

export const GLOSSARY = {
  monteCarlo: {
    title: '蒙特卡洛模拟',
    what: '用随机抽样估计分布',
    describes:
      '把这套组合的输赢用伪随机数重复模拟上万次，统计每种盈亏出现的频率，从而估出盈利概率、VaR 等无法用公式直接求解的量。次数越多越接近真实分布。',
  },
  profitProb: {
    title: '盈利概率',
    what: '最终账面为正的概率',
    describes:
      '在上万次蒙特卡洛模拟里，最终结算为盈利的比例。50% 相当于抛硬币，越高代表这套组合在随机性下越稳。',
  },
  evMedian: {
    title: '中位收益',
    what: '排序后正中间的那次结果',
    describes:
      '把所有模拟结果从小到大排序，取正中间的一笔。比平均值更抗极端值，代表“最典型”的一次盈亏。',
  },
  evMean: {
    title: '平均收益',
    what: '所有模拟结果的期望值',
    describes:
      '上万次模拟盈亏的算术平均，即数学期望 E[R]。会被少数极端大赚/大亏拉动，宜与中位收益对照着看。',
  },
  var95: {
    title: '95% VaR 风险价值',
    what: '95% 把握下的最坏亏损',
    describes:
      '在 95% 的情形里，亏损都不会超过这个数；只有最差 5% 的尾部会更糟。数值越接近 0，组合越稳健。',
  },
  maxPnl: {
    title: '最大收益',
    what: '模拟中出现过的最好一次',
    describes:
      '所有模拟里运气最好的一次盈利，即全部腿命中、赔率叠满的上限。属于小概率的尾部，参考其量级即可。',
  },
  allLose: {
    title: '全亏概率',
    what: '所有腿同时落空的概率',
    describes:
      '整套组合一注未中、本金全部亏掉的概率。腿越多、相关性越高，这个尾部风险通常越大。',
  },
  kelly: {
    title: 'Kelly 凯利公式',
    what: '理论最优下注比例',
    describes:
      '根据赔率与胜率算出单注该投入本金的比例，使长期对数收益最大化。系统用“分数 Kelly”（除以一个分母）来压低波动、避免过度下注。',
  },
  brier: {
    title: 'Brier 分数',
    what: '概率预测的准确度',
    describes:
      '预测概率与真实结果（0/1）之间的均方误差，越低越准：0 是完美，0.25 约等于乱猜。用来检验“说 70% 的事是不是真有 70% 发生”。',
  },
  logLoss: {
    title: 'LogLoss 对数损失',
    what: '惩罚“自信却押错”',
    describes:
      '对高概率却押错的预测施以重罚，比 Brier 更敏感于过度自信。越低代表概率刻度越诚实。',
  },
  walkForward: {
    title: 'Walk-Forward 滚动验证',
    what: '只用过去预测未来',
    describes:
      '按时间把样本切成多个窗口，逐窗用更早的数据校准、更晚的数据检验，模拟真实下注里“看不到未来”的约束，避免自欺式的过拟合。',
  },
  calibration: {
    title: '校准 Calibration',
    what: '让概率说真话',
    describes:
      '若模型说 70% 的事件长期确实约 70% 发生，就是校准良好。校准层把原始概率重映射到更可信的刻度，再交给 Kelly 下注。',
  },
  confidence: {
    title: '置信度',
    what: '这条建议有多可信',
    describes:
      '由样本量与历史一致性推得：样本越多、表现越稳，置信度越高。低置信度的建议更宜观望。',
  },
  roi: {
    title: 'ROI 投资回报率',
    what: '净收益 ÷ 本金',
    describes:
      '衡量资金效率：+10% 表示每投入 100 收回 110。剥离了本金规模，便于横向比较不同策略。',
  },
  maxDrawdown: {
    title: '最大回撤',
    what: '峰值到谷底的最大跌幅',
    describes:
      '资金曲线从历史高点回落的最深幅度，刻画最坏的连续亏损体验，是衡量风险承受度的核心指标。',
  },
  fragility: {
    title: '碎裂热力图',
    what: '组合的相关性脆弱度',
    describes:
      '衡量各腿之间“一荣俱荣、一损俱损”的程度。越红代表越容易因共同因素同时落空，尾部风险越高，分散度越差。',
  },
  leg: {
    title: '腿 / Leg',
    what: '串联组合中的一注',
    describes:
      '组合里的单场选择；N 条腿必须全中才算赢，因此腿越多潜在赔率越高、但命中越难。',
  },
  odds: {
    title: '赔率 Odds',
    what: '含本金的回报倍数',
    describes:
      '赔率 1.85 表示押中后 100 变 185。隐含概率 ≈ 1 ÷ 赔率，是市场对该结果的概率定价。',
  },
}

export default GLOSSARY
