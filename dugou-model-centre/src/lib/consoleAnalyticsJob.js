import {
  getExpectedVsActualRows, getModeKellyRecommendations, getKellyDivisorMatrix,
  getKellyDivisorBacktest, getPredictionCalibrationContext, getModelValidationSnapshot,
} from './analytics'

// Only presentation data crosses the worker boundary. Prediction closures stay
// with the engine; no JSON conversion that would turn unavailable values into 0.
export const runConsoleAnalytics = (emit) => {
  emit('rating', { ratingRows: getExpectedVsActualRows(240), modeKellyRows: getModeKellyRecommendations() })
  emit('kelly', { kellyMatrix: getKellyDivisorMatrix(), kellyBacktest: getKellyDivisorBacktest() })
  const context = getPredictionCalibrationContext({ detail: 'full' })
  const calibrationContext = Object.fromEntries([
    'sampleCount', 'n', 'multipliers', 'bands', 'repBuckets', 'regression',
    'regressionMultiplier', 'regressionReliability', 'scatterData',
  ].map((key) => [key, context[key]]))
  // The full calibration already calculated these suggestions. Do not run the
  // same temporal tuning again while rendering AdaptiveWeightCard.
  emit('calibration', { calibrationContext, adaptiveSuggestions: context.adaptiveWeightResult })
  emit('validation', { modelValidation: getModelValidationSnapshot() })
}
