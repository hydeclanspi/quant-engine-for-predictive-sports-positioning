// Per-investment descriptive ratios, target return = 0, NOT annualized.
// Downside deviation uses all observations in the denominator (full method).
export const getReturnRiskRatios = (returns, target = 0) => {
  const values = (returns || []).filter(Number.isFinite).map((r) => r - target)
  const n = values.length
  const mean = n ? values.reduce((s, r) => s + r, 0) / n : NaN
  const deviation = n > 1 ? Math.sqrt(values.reduce((s, r) => s + (r - mean) ** 2, 0) / n) : NaN
  const downsideDeviation = n ? Math.sqrt(values.reduce((s, r) => s + Math.min(0, r) ** 2, 0) / n) : NaN
  return {
    samples: n, target, basis: 'per_investment_non_annualized',
    deviation, downsideDeviation,
    sharpe: deviation > 1e-12 ? mean / deviation : NaN,
    sortino: downsideDeviation > 1e-12 ? mean / downsideDeviation : NaN,
  }
}
