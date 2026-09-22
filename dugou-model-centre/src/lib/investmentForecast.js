import { getMatchSourceIdentity } from './investmentIdentity'

export const FORECAST_SCHEMA_VERSION = 1
export const MEAN_LEG_RATING_SEMANTICS = 'mean_calibrated_leg_probability'

export const isValidDecimalOdds = (value) => {
  const number = Number(value)
  return value !== '' && value !== null && value !== undefined && Number.isFinite(number) && number > 1
}

export const capRecommendedStake = (amount, poolCapital, riskCapRatio) => {
  const capital = Number.isFinite(Number(poolCapital)) ? Math.max(0, Number(poolCapital)) : 0
  const ratio = Number.isFinite(Number(riskCapRatio)) ? Math.max(0, Number(riskCapRatio)) : 0
  const candidate = Number.isFinite(Number(amount)) ? Math.max(0, Math.round(Number(amount))) : 0
  return Math.min(candidate, Math.max(0, Math.floor(capital * ratio)))
}

const snapshotStates = (states) => {
  if (!Array.isArray(states) || states.length === 0) return null
  if (states.some((state) => !state || typeof state !== 'object' ||
    !Number.isFinite(state.probability) || state.probability < 0 || state.probability > 1 ||
    !Number.isFinite(state.gross) || state.gross < 0)) return null
  const rows = states.map((state) => ({ probability: state.probability, gross: state.gross, net: state.gross - 1 }))
  const total = rows.reduce((sum, state) => sum + state.probability, 0)
  if (Math.abs(total - 1) > 1e-6) return null
  return rows
}

// This is a prediction-time snapshot, not a backfilled reconstruction. Call only
// when creating a forecast; never on getInvestments()/normalization.
export const buildForecastSnapshot = ({ combinedProfile, legs = [], generatedAt, modelVersion = 'atomic-v2', calibrationMetadata = null }) => {
  const states = snapshotStates(combinedProfile?.states)
  if (!states || combinedProfile?.valid === false || !generatedAt || !Number.isFinite(Date.parse(generatedAt))) return null
  return {
    schema_version: FORECAST_SCHEMA_VERSION,
    model_version: modelVersion,
    generated_at: generatedAt,
    calibration: calibrationMetadata
      ? JSON.parse(JSON.stringify(calibrationMetadata))
      : { stage: 'unknown' },
    expected_rating_semantics: MEAN_LEG_RATING_SEMANTICS,
    model_status: combinedProfile.modelStatus || 'unspecified',
    states,
    ticket_hit_probability: states.reduce((sum, state) => sum + (state.gross > 0 ? state.probability : 0), 0),
    ticket_profit_probability: states.reduce((sum, state) => sum + (state.gross > 1 ? state.probability : 0), 0),
    expected_return: states.reduce((sum, state) => sum + state.probability * state.net, 0),
    legs: legs.map(({ match, profile, investmentId }) => ({
      ...getMatchSourceIdentity(match, investmentId),
      calibrated_probability: Number(profile?.hitProbability),
      raw_conf: Number.isFinite(match?.conf) ? match.conf : null,
      entries: (match?.entries || []).map((entry) => ({ name: entry.name, odds: entry.odds })),
      input: {
        conf: match?.conf, mode: match?.mode, odds: match?.odds,
        home_team: match?.home_team ?? match?.homeTeam, away_team: match?.away_team ?? match?.awayTeam,
        tys_home: match?.tys_home ?? match?.tysHome, tys_away: match?.tys_away ?? match?.tysAway,
        fid: match?.fid, fse_home: match?.fse_home ?? match?.fseHome, fse_away: match?.fse_away ?? match?.fseAway,
        entries: (match?.entries || []).map((entry) => ({ name: entry.name, odds: entry.odds })),
      },
      model_status: profile?.modelStatus || 'unspecified',
      states: snapshotStates(profile?.states),
    })),
  }
}

/** Stamp availability only during a confirmed write, preserving unknown history. */
export const addSettlementTimestamps = (previous, next, writtenAt) => {
  if (!['win', 'lose'].includes(next?.status) || !Number.isFinite(Date.parse(writtenAt))) return next
  const firstSettlement = previous?.status === 'pending'
  const oldMatches = new Map((previous?.matches || []).map((match) => [match.id, match]))
  const labelChanged = (match) => {
    const old = oldMatches.get(match.id)
    return !old || ['results', 'is_correct', 'match_rating', 'match_rep'].some((key) => old[key] !== match[key])
  }
  const corrected = previous && (previous.status !== next.status || previous.profit !== next.profit
    || previous.revenues !== next.revenues || (next.matches || []).some(labelChanged))
  if (!firstSettlement && !corrected) return next
  return {
    ...next,
    settled_at: next.settled_at || (firstSettlement ? writtenAt : undefined),
    outcome_available_at: writtenAt,
    matches: (next.matches || []).map((match) => ({ ...match,
      outcome_available_at: firstSettlement || labelChanged(match) ? writtenAt : match.outcome_available_at,
    })),
  }
}
