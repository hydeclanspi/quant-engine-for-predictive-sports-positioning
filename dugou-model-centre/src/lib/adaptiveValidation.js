// Evaluate the actual probability function with a proper scoring rule. These
// windows are tuning data, not an estimate of the selected model's performance.
export const probabilityLoss = (rows, predict) => {
  if (!rows.length) return { brier: NaN, logLoss: NaN }
  let brier = 0, logLoss = 0
  for (const row of rows) {
    const p = Math.max(0.001, Math.min(0.999, predict(row)))
    if (!Number.isFinite(p)) return { brier: NaN, logLoss: NaN }
    brier += (p - row.actual) ** 2
    logLoss -= row.actual * Math.log(p) + (1 - row.actual) * Math.log(1 - p)
  }
  return { brier: brier / rows.length, logLoss: logLoss / rows.length }
}

export const validatesProbabilityUpdate = (baseline, candidate) =>
  Number.isFinite(baseline?.brier) && Number.isFinite(candidate?.brier)
  && Number.isFinite(baseline?.logLoss) && Number.isFinite(candidate?.logLoss)
  && candidate.brier < baseline.brier - 1e-8 && candidate.logLoss <= baseline.logLoss + 1e-8
