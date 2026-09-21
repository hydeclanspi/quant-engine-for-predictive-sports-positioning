import { estimateEntryAnchorOdds } from './atomicParlay'

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const weight = (x, fallback) => Number.isFinite(Number.parseFloat(x)) ? clamp(Number.parseFloat(x), 0.01, 1.5) : fallback
const MODE = { 常规: 1, '常规-稳': 1.05, '常规-杠杆': 0.95, '常规-激进': 0.95, 半彩票半保险: 0.92, 保险产品: 1.08, 赌一把: 0.88 }
const TYS = { S: 0.94, M: 1, L: 1.04, H: 1.08 }
const FID = { 0: 0.92, 0.25: 0.99, 0.4: 1.02, 0.5: 1.05, 0.6: 1.07, 0.75: 1.1 }

/** Single production predictor. Conf/FSE inputs are fractions, never percentages.
 * UI adapters handle their scales; historical replay calls this exact function.
 */
export const predictMatchProbability = (match, config, context) => {
  const rawConf = clamp(Number(match.conf), 0.05, 0.95)
  const conf = typeof context?.calibrate === 'function'
    ? clamp(context.calibrate(rawConf), 0.05, 0.95)
    : clamp(rawConf * clamp(Number(context?.multipliers?.conf || 1), 0.75, 1.25), 0.05, 0.95)
  const lf = context?.learnedFactors
  const learned = lf && lf.reliability > 0.15
  const factor = (kind, key, priors) => learned && lf[kind]?.[key] != null ? lf[kind][key] : (priors[key] || 1)
  const mode = factor('mode', match.mode, MODE)
  const tys = (factor('tys', match.tysHome ?? match.tys_home, TYS) + factor('tys', match.tysAway ?? match.tys_away, TYS)) / 2
  const fid = factor('fid', String(match.fid), FID)
  const fseGeo = Math.sqrt(clamp(Number(match.fseHome ?? match.fse_home ?? 0.1), 0.05, 1) * clamp(Number(match.fseAway ?? match.fse_away ?? 0.1), 0.05, 1))
  const fseBase = learned && typeof lf.fse?.interpolate === 'function' ? lf.fse.interpolate(fseGeo) : 0.88 + fseGeo * 0.24
  const fse = clamp(fseBase * clamp(Number(context?.multipliers?.fse || 1), 0.75, 1.25), 0.72, 1.35)
  const lift = mode ** weight(config.weightMode, 0.16) * tys ** weight(config.weightTys, 0.12)
    * fid ** weight(config.weightFid, 0.14) * fse ** weight(config.weightFse, 0.07)
  const baseProbability = clamp(conf * lift, 0.05, 0.95)
  const odds = estimateEntryAnchorOdds(match.entries, Number(match.odds) || Number(config.defaultOdds || 2.5))
  if (typeof context?.calibrateProbabilityForMatch !== 'function') return baseProbability
  return clamp(context.calibrateProbabilityForMatch({
    baseProbability, conf: rawConf, odds,
    homeTeam: match.homeTeam ?? match.home_team,
    awayTeam: match.awayTeam ?? match.away_team,
  }), 0.05, 0.95)
}
