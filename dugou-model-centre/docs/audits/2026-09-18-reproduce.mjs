// Historical read-only audit probes against baseline 49e4622, NOT current code.
// Current fix regressions live in src/lib/__tests__ (run npm test).
// No browser, storage,
// network, real account data, or application write functions are invoked.
// Run from the app directory: node docs/audits/2026-09-18-reproduce.mjs
// Assertions below capture observed defects, NOT desired product behavior.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import { transformSync } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const baseline = '49e4622'
const source = (file) => execFileSync('git', ['show', `${baseline}:dugou-model-centre/${file}`], { cwd: root, encoding: 'utf8' })
console.log(`Historical audit baseline ${baseline}; assertions intentionally reproduce pre-fix defects.`)
function isolated(file, names, bindings = {}, before = null) {
  let code = source(file)
  if (before) code = code.slice(0, code.indexOf(before))
  code = code.replace(/^import\s[\s\S]*?\sfrom\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^export\s+(?=(const|function|class)\b)/gm, '')
  if (file.endsWith('.jsx')) code = transformSync(code, { loader: 'jsx', jsx: 'transform' }).code
  const context = vm.createContext({ ...bindings })
  vm.runInContext(`${code}\n;globalThis.audit = {${names.join(',')}}`, context, { filename: file, timeout: 10000 })
  return context.audit
}
const emit = (id, value) => console.log(JSON.stringify({ id, ...value }))
const config = {
  initialCapital: 1000, riskCapRatio: .12, defaultOdds: 2.5, kellyDivisor: 4,
  weightConf: .45, weightMode: .16, weightTys: .12, weightFid: .14, weightOdds: .06, weightFse: .07,
  adaptiveWeights: { enabled: false, mode: 'disabled', minSamples: 50 },
}
let investments = []
let writes = []
const entry = isolated('src/lib/entryParsing.js', ['normalizeEntryRecord', 'getPrimaryEntryMarket'])
const atomic = isolated('src/lib/atomicParlay.js', ['buildAtomicMatchProfile', 'combineAtomicMatchProfiles', 'estimateEntryAnchorOdds', 'solveKellyFractionByAtomicDistribution'], entry)
const a = isolated('src/lib/analytics.js', [
  'buildIsotonicRegression', 'evaluateComboPrequentialQuality', 'buildEntryCorrelationMatrix',
  'autoApplyAdaptiveWeights', 'computeInvestmentScore', 'computePortfolioScore',
  'getRowTemporalTs', 'buildPrequentialWalkForwardWindows', 'buildComboRetrospective',
  'calculateDependencyPremium', 'assessFragilityScore', 'estimateInvestmentExpected', 'calcKellyStake',
], {
  ...entry, getInvestments: () => investments, getSystemConfig: () => config,
  getTeamProfiles: () => [], findTeamProfile: () => null, lookupTeam: () => null,
  isPreviewMode: () => false, saveSystemConfig: (patch) => { writes.push(patch) },
})
const c = isolated('src/pages/ComboPage.jsx', [
  'runPortfolioMonteCarlo', 'getEffectiveStakeForScoring', 'allocateAmountsWithinRiskCap',
  'stratifiedSelect', 'generateRecommendations', 'calcAdjustedProbability',
], { ...atomic, isPreviewMode: () => false }, 'export default function ComboPage')

const tied = Array.from({ length: 60 }, (_, i) => ({ conf: .5, actual: i < 30 ? 0 : 1 }))
const pavA = a.buildIsotonicRegression(tied)
const pavB = a.buildIsotonicRegression([...tied].reverse())
assert.notEqual(pavA.calibrate(.5), pavB.calibrate(.5))
emit('PAV_TIES', { forward: pavA.calibrate(.5), reversed: pavB.calibrate(.5), reliability: pavA.reliability })

const temporal = (actual) => Array.from({ length: 50 }, (_, i) => ({
  created_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), conf: .7, odds: 2, actual,
}))
const good = a.evaluateComboPrequentialQuality(temporal(1))
const bad = a.evaluateComboPrequentialQuality(temporal(0))
assert.equal(good.quality, 1); assert.equal(bad.quality, 1)
assert.equal(bad.strongHitRate, null); assert.equal(bad.enabled, true)
emit('EMPTY_QUALITY_CHECK', { allWin: good, allLose: bad })

const scoreLeg = { entry_market_type: 'score', is_correct: true, odds: 2, conf: .5 }
const resultLeg = { entry_market_type: 'result', is_correct: false, odds: 2, conf: .5 }
investments = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, status: 'lose', matches: [scoreLeg, resultLeg] }))
const rhoA = a.buildEntryCorrelationMatrix().getCorrelation('score', 'result').rho
investments = investments.map((x, i) => ({ ...x, matches: i < 10 ? [...x.matches].reverse() : x.matches }))
const rhoB = a.buildEntryCorrelationMatrix().getCorrelation('score', 'result').rho
assert.notEqual(rhoA, rhoB)
emit('ENTRY_ORDER', { originalRho: rhoA, mixedOrderRho: rhoB })

investments = Array.from({ length: 60 }, (_, i) => ({
  id: `a${i}`, status: 'win', inputs: 10, profit: 10, matches: [{
    conf: .8, odds: 2, mode: '保险产品', tys_home: 'S', tys_away: 'H', fid: .75, fse_home: .7, fse_away: .8,
  }],
}))
const applied = a.autoApplyAdaptiveWeights()
assert.equal(applied.applied, true); assert.equal(writes.length, 1)
const features = a.computeInvestmentScore(investments[0], config).components
assert.equal(features.tys, .5); assert.equal(features.fid, .5)
emit('DISABLED_AUTO_WRITES', { applied: applied.applied, mockedWriteCount: writes.length, appliedChanges: applied.appliedChanges })
emit('FEATURE_SCHEMA', { inputTys: 'S / H', inputFid: .75, extracted: features })

const missingWindows = a.buildPrequentialWalkForwardWindows(Array.from({ length: 30 }, () => ({ conf: .5 })))
assert.equal(a.getRowTemporalTs({}), 0); assert.ok(missingWindows.length > 0)
emit('MISSING_TIMESTAMPS', { missingDate: a.getRowTemporalTs({}), walkForwardWindows: missingWindows.length })

const twoLegMean = a.estimateInvestmentExpected({ expected_rating: .6, matches: [{ conf: .6 }, { conf: .6 }] })
emit('KELLY_SEMANTICS', {
  storedAverage: twoLegMean, independentJointProbability: .6 * .6,
  replayStakeUsingAverage: a.calcKellyStake(twoLegMean, 4, 4, config),
  binaryStakeUsingJoint: a.calcKellyStake(.36, 4, 4, config),
})

const cold = a.assessFragilityScore({ odds: 2 }, { odds: 2 }, [])
emit('NO_DATA_RISK', { score: cold.fragilityScore, riskLevel: cold.riskLevel, confidence: cold.components.premium.confidence })
const hist = Array.from({ length: 10 }, (_, i) => ({ matches: [{ odds: 2, result: i < 5 ? false : true }, { odds: 2, result: i < 5 ? false : true }] }))
const dep1 = a.calculateDependencyPremium({ odds: 2 }, { odds: 2 }, hist, 0, 1, Array(8).fill(1))
const dep2 = a.calculateDependencyPremium({ odds: 2 }, { odds: 2 }, hist, 0, 1, Array(8).fill(2))
assert.ok(Math.abs(dep1.effectiveSampleSize - dep2.effectiveSampleSize) < 1e-8)
assert.notEqual(dep1.pValue, dep2.pValue)
emit('WEIGHT_SCALE_PVALUE', { first: { ess: dep1.effectiveSampleSize, weight: dep1.weightedCount, p: dep1.pValue }, rescaled: { ess: dep2.effectiveSampleSize, weight: dep2.weightedCount, p: dep2.pValue } })

const unitProfile = atomic.buildAtomicMatchProfile({ entries: [{ name: 'win', odds: 2 }, { name: 'lose', odds: 8 }], unionProbability: .8 })
const atomicProfit = unitProfile.profitWinProbability
const mc = c.runPortfolioMonteCarlo([{ amount: 100, subset: [{ key: 'x', calibratedP: .8, atomicProfile: unitProfile }], combinedOdds: unitProfile.equivalentOdds }], 50000)
assert.ok(Math.abs(mc.profitProb - atomicProfit) > .5)
emit('MC_DISTRIBUTION', { atomicProfitProbability: atomicProfit, mcProfitProbability: mc.profitProb, atomicExpectedProfit: unitProfile.expectedReturn * 100, mcExpectedProfit: mc.mean, atomicStates: unitProfile.states })
const zeroItem = { amount: 0, allocatedWeight: .25, subset: [{ key: 'x', calibratedP: .5 }], combinedOdds: 2 }
assert.equal(c.getEffectiveStakeForScoring(zeroItem), 25)
emit('ZERO_STAKE', { actualAmount: 0, simulatedAmount: c.getEffectiveStakeForScoring(zeroItem) })

const ranking = c.stratifiedSelect([
  { id: 'should_be_first', subset: [{ key: 'a' }, { key: 'b' }], utility: 1, softUtility: 10, boostedUtility: 10, sharpe: 1 },
  { id: 'raw_utility_first', subset: [{ key: 'c' }, { key: 'd' }], utility: 2, softUtility: 0, boostedUtility: 0, sharpe: 1 },
], 1, 2)
assert.equal(ranking[0].id, 'raw_utility_first')
emit('SCORE_DISCARDED', { winner: ranking[0].id })

const candidates = Array.from({ length: 10 }, (_, i) => ({
  key: `m${i}`, investmentId: `inv${i}`, matchIndex: 0, homeTeam: `H${i}`, awayTeam: `A${i}`,
  entry: 'win', entries: [{ name: 'win', odds: 2 }], odds: 2, conf: .6,
  mode: '常规', tysHome: 'M', tysAway: 'M', fid: .4, fseHome: .5, fseAway: .5,
}))
const noCover = c.generateRecommendations(candidates, 50, 120, config, {}, { minCoverageEnabled: true, minCoveragePercent: 55 })
assert.equal(noCover, null)
const negative = c.generateRecommendations(candidates.slice(0, 3).map(m => ({ ...m, conf: .2, calibratedP: .2, confSurplus: { surplus: -.3 } })), 50, 120, config, {}, { minCoverageEnabled: false })
assert.ok(negative && negative.totalInvest === 120 && negative.recommendations.every(x => x.expectedReturn < 0))
emit('NO_FEASIBLE_COVERAGE', { selectedMatches: 10, maxLegs: 5, minCoverage: .55, result: noCover })
emit('NO_CASH_OPTION', { budgetCap: 120, allocated: negative.totalInvest, expectedReturns: negative.recommendations.map(x => x.expectedReturn) })

const certainCoverage = atomic.buildAtomicMatchProfile({ entries: ['win', 'draw', 'lose'].map(name => ({ name, odds: 3 })) })
assert.ok(certainCoverage.missProbability > .29)
emit('EXHAUSTIVE_OUTCOMES', { covered: ['win', 'draw', 'lose'], impliedProbabilitySum: 1, generatedMissProbability: certainCoverage.missProbability })
const unchangedP = [0.25, 0.65].map(weightConf => c.calcAdjustedProbability(candidates[0], { ...config, weightConf }, {}))
assert.equal(unchangedP[0], unchangedP[1])
emit('INACTIVE_CONF_WEIGHT', { weightConf: [.25, .65], probabilities: unchangedP })
const fixedCandidates = candidates.slice(0, 3).map(m => ({ ...m, calibratedP: .6, confSurplus: { surplus: .1 } }))
const plain = c.generateRecommendations(fixedCandidates, 50, 120, config, {}, { minCoverageEnabled: false })
const correlated = c.generateRecommendations(fixedCandidates, 50, 120, config, {
  entryCorrelation: { ready: true, getCorrelation: () => ({ rho: .5, reliability: 1 }) },
}, { minCoverageEnabled: false })
const two = rows => rows.candidateUniverse.find(x => x.legs === 2)
assert.notEqual(two(plain).p, two(correlated).p)
assert.equal(two(plain).ev, two(correlated).ev)
emit('CORRELATION_DISTRIBUTION_SPLIT', { before: { p: two(plain).p, ev: two(plain).ev }, after: { p: two(correlated).p, ev: two(correlated).ev } })

const fixture = (id, date, home, away, hit) => ({ id, created_at: date, status: hit ? 'win' : 'lose', matches: [{ home_team: home, away_team: away, is_correct: hit, odds: 2 }] })
investments = [fixture('new', '2026-09-01', 'A', 'B', true), fixture('old', '2026-01-01', 'A', 'B', false), fixture('c', '2026-01-01', 'C', 'D', true), fixture('d', '2026-01-01', 'E', 'F', true)]
const plans = [{ createdAt: '2026-08-30', recommendations: [1, 2].map(() => ({ layer: '主推', subset: [{ homeTeam: 'A', awayTeam: 'B', entry: 'win', conf: .6 }] })) }]
const retro = a.buildComboRetrospective(plans)
assert.equal(retro.layerHitRates.core, 0)
emit('RETRO_IDENTITY', { newestResult: true, olderResult: false, learnedCoreHitRate: retro.layerHitRates.core })

console.log('All audit probes reproduced. Only synthetic data and mocked writes were used.')
