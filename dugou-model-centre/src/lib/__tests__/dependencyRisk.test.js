/**
 * 依赖风险分析系统 - 单元测试
 * Tests for Dependency Risk Premium Analysis System
 *
 * 锁定诊断计算行为；不代表对统计假设或实盘收益的验证。
 */

import {
  getMarketImpliedFailureRate,
  getConfidenceWeight,
  getTemporalWeight,
  getWeightedObservedFailure,
  calculateDependencyPremium,
  checkSurvivingBias,
  adjustForBaseRate,
  assessFragilityScore,
  assessComboFragility,
  generateFragilityRecommendations,
} from '../analytics'

describe('Dependency Risk Premium Analysis', () => {
  // ==========================================================================
  // 测试1：市场隐含失败率
  // ==========================================================================

  describe('getMarketImpliedFailureRate', () => {
    it('应该从赔率计算隐含失败率 (1 - 1/odds)', () => {
      // 失败率 = 1 − 隐含胜率 = 1 − 1/odds
      expect(getMarketImpliedFailureRate(2.0)).toBeCloseTo(0.5, 2)
      expect(getMarketImpliedFailureRate(3.5)).toBeCloseTo(0.714, 2)
      expect(getMarketImpliedFailureRate(1.5)).toBeCloseTo(0.333, 2)
    })

    it('应该把失败率夹逼到 0.02 - 0.98', () => {
      // 1.01 超级大热门 → 失败率极低，夹逼到下限 0.02
      expect(getMarketImpliedFailureRate(1.01)).toBeLessThan(0.03)
      // 100 超级大冷门 → 失败率极高，夹逼到上限 0.98
      expect(getMarketImpliedFailureRate(100)).toBeGreaterThan(0.97)
    })

    it('应该返回NaN对于无效赔率', () => {
      expect(isNaN(getMarketImpliedFailureRate(0.5))).toBe(true)
      expect(isNaN(getMarketImpliedFailureRate(-1))).toBe(true)
      expect(isNaN(getMarketImpliedFailureRate('invalid'))).toBe(true)
    })
  })

  // ==========================================================================
  // 测试2：样本量信心权重
  // ==========================================================================

  describe('getConfidenceWeight', () => {
    it('应该根据样本量返回对数曲线权重', () => {
      // clamp(ln(1 + size) / ln(31), 0.05, 1.0)
      expect(getConfidenceWeight(3)).toBeCloseTo(0.404, 2)
      expect(getConfidenceWeight(8)).toBeCloseTo(0.64, 2)
      expect(getConfidenceWeight(15)).toBeCloseTo(0.807, 2)
      expect(getConfidenceWeight(25)).toBeCloseTo(0.949, 2)
      expect(getConfidenceWeight(50)).toBe(1.0) // 夹逼到上限
    })

    it('应该处理边界值', () => {
      expect(getConfidenceWeight(0)).toBe(0)
      expect(getConfidenceWeight(5)).toBeCloseTo(0.522, 2)
      expect(getConfidenceWeight(10)).toBeCloseTo(0.698, 2)
    })

    it('应该处理非数字输入', () => {
      expect(getConfidenceWeight('abc')).toBe(0)
      expect(getConfidenceWeight(null)).toBe(0)
    })
  })

  // ==========================================================================
  // 测试3：时间权重
  // ==========================================================================

  describe('getTemporalWeight', () => {
    it('最近30天的数据返回1.45倍权重', () => {
      const today = new Date()
      const recentDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

      expect(getTemporalWeight(recentDate, today)).toBe(1.45)
    })

    it('31-90天的数据返回1.28倍权重', () => {
      const today = new Date()
      const midDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)

      expect(getTemporalWeight(midDate, today)).toBe(1.28)
    })

    it('91-180天的数据返回1.15倍权重', () => {
      const today = new Date()
      const olderDate = new Date(today.getTime() - 180 * 24 * 60 * 60 * 1000)

      expect(getTemporalWeight(olderDate, today)).toBe(1.15)
    })

    it('超过180天的数据返回1.0倍权重', () => {
      const today = new Date()
      const oldDate = new Date(today.getTime() - 200 * 24 * 60 * 60 * 1000)

      expect(getTemporalWeight(oldDate, today)).toBe(1.0)
    })

    it('应该处理无效日期', () => {
      expect(getTemporalWeight('invalid')).toBe(1.0)
      expect(getTemporalWeight(null)).toBe(1.0)
    })

    it('边界：恰好60天落在 31-90 档，返回1.28', () => {
      const today = new Date()
      const boundaryDate = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)

      expect(getTemporalWeight(boundaryDate, today)).toBe(1.28)
    })
  })

  // ==========================================================================
  // 测试4：加权观察失败统计
  // ==========================================================================

  describe('getWeightedObservedFailure', () => {
    it('只统计双边结果都已结算的pair，避免未结算样本污染分母', () => {
      const now = new Date().toISOString()
      const historicalData = [
        {
          matches: [
            { odds: 2.0, result: false },
            { odds: 2.0, result: false },
          ],
          createdAt: now,
        },
        {
          matches: [
            { odds: 2.0, result: true },
            { odds: 2.0, result: undefined },
          ],
          createdAt: now,
        },
      ]

      const observed = getWeightedObservedFailure(historicalData, 2.0, 2.0)
      expect(observed.rawPairCount).toBe(1)
      expect(observed.totalWeight).toBeGreaterThan(0)
      expect(observed.failedTogether).toBeCloseTo(observed.totalWeight, 6)
      expect(observed.partialMiss).toBeCloseTo(0, 6)
    })

    it('赔率差距过远的历史对不构成证据，返回无可比历史', () => {
      const now = new Date().toISOString()
      const historicalData = [
        { matches: [{ odds: 1.2, result: true }, { odds: 1.2, result: false }], createdAt: now },
        { matches: [{ odds: 1.2, result: false }, { odds: 1.2, result: true }], createdAt: now },
        { matches: [{ odds: 1.2, result: true }, { odds: 1.2, result: true }], createdAt: now },
      ]
      // 历史全是 1.2 的腿；目标 8.0×8.0 的最优核权重远低于可比性下限。
      const observed = getWeightedObservedFailure(historicalData, 8.0, 8.0)
      expect(observed.totalWeight).toBe(0)
      expect(observed.rawPairCount).toBe(0)
      expect(observed.effectiveSampleSize).toBe(0)
    })
  })

  // ==========================================================================
  // 测试4：依赖风险溢价计算
  // ==========================================================================

  describe('calculateDependencyPremium', () => {
    it('应该计算基础溢价', () => {
      const raceA = { odds: 2.0 }
      const raceB = { odds: 2.0 }
      const historicalData = [
        {
          matches: [
            { odds: 2.0, result: false },
            { odds: 2.0, result: false },
            { odds: 1.5, result: true },
          ],
          succeeded: false,
          createdAt: new Date().toISOString(),
        },
        {
          matches: [
            { odds: 2.0, result: true },
            { odds: 2.0, result: false },
            { odds: 1.5, result: true },
          ],
          succeeded: false,
          createdAt: new Date().toISOString(),
        },
      ]

      const result = calculateDependencyPremium(raceA, raceB, historicalData, 0, 1)

      expect(result.pFailA).toBeCloseTo(0.5, 2)
      expect(result.pFailB).toBeCloseTo(0.5, 2)
      expect(result.pFailBothIndependent).toBeCloseTo(0.25, 2)
      expect(result.pFailBothObserved).toBeCloseTo(0.5, 2) // 2个都失败了1次
      expect(result.premium).toBeCloseTo(0.25, 2) // 0.5 - 0.25
      expect(Number.isFinite(result.premium)).toBe(true)
    })

    it('应该返回NaN对于无效赔率', () => {
      const raceA = { odds: 'invalid' }
      const raceB = { odds: 2.0 }

      const result = calculateDependencyPremium(raceA, raceB, [])

      expect(isNaN(result.premium)).toBe(true)
    })

    it('应该处理空历史数据', () => {
      const raceA = { odds: 2.0 }
      const raceB = { odds: 2.0 }

      const result = calculateDependencyPremium(raceA, raceB, [])

      expect(Number.isNaN(result.premium)).toBe(true)
      expect(result.sampleSize).toBe(0)
      expect(Number.isNaN(result.pFailBothObserved)).toBe(true)
      expect(Number.isNaN(result.pValue)).toBe(true)
      expect(result.confidence).toBe(0)
    })

    it('应该包含所有必要的输出字段', () => {
      const raceA = { odds: 3.0 }
      const raceB = { odds: 2.5 }

      const result = calculateDependencyPremium(raceA, raceB, [])

      expect(result).toHaveProperty('premium')
      expect(result).toHaveProperty('pFailA')
      expect(result).toHaveProperty('pFailB')
      expect(result).toHaveProperty('pFailBothObserved')
      expect(result).toHaveProperty('pFailBothIndependent')
      expect(result).toHaveProperty('sampleSize')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('pValue')
      expect(result).toHaveProperty('isSignificant')
    })
  })

  // ==========================================================================
  // 测试5：推断口径
  // ==========================================================================

  describe('dependency risk inference', () => {
    it('不提供二项检验 p 值，显著性一律不可用', () => {
      const raceA = { odds: 2.0 }
      const raceB = { odds: 3.0 }
      const result = calculateDependencyPremium(raceA, raceB, [])

      expect(result.pValue).toBeNaN()
      expect(result.isSignificant).toBe(false)
      expect(result.pValueMethod).toBe('unavailable_dependent_selected_sample')
      expect(result.confidenceBasis).toBe('ess_support_weight_not_statistical_confidence')
    })
  })

  // ==========================================================================
  // 测试6：幸存者偏差匹配
  // ==========================================================================

  describe('checkSurvivingBias', () => {
    it('未结算pair不应计入matchedPairs', () => {
      const raceA = { odds: 2.0 }
      const raceB = { odds: 2.0 }
      const historicalData = [
        {
          matches: [
            { odds: 2.0, result: true },
            { odds: 2.0, result: undefined },
          ],
        },
        {
          matches: [
            { odds: 2.0, result: true },
            { odds: 2.0, result: true },
          ],
        },
      ]

      const result = checkSurvivingBias(raceA, raceB, historicalData)
      expect(result.matchedPairs).toBe(1)
      expect(result.exactWon).toBe(1)
    })
  })

  // ==========================================================================
  // 测试6：脆弱性评分
  // ==========================================================================

  describe('assessFragilityScore', () => {
    it('无历史时不伪造风险分数', () => {
      const raceA = { odds: 3.0 }
      const raceB = { odds: 2.0 }

      const result = assessFragilityScore(raceA, raceB, [])

      expect(Number.isNaN(result.fragilityScore)).toBe(true)
      expect(result.riskLevel).toBe('insufficient_data')
      expect(result.confidence).toBe(0)
    })

    it('有可结算历史但与目标赔率差距过远时仍不给出数值风险分数', () => {
      const now = new Date().toISOString()
      const historicalData = [
        { matches: [{ odds: 1.2, result: true }, { odds: 1.2, result: false }], createdAt: now },
        { matches: [{ odds: 1.2, result: false }, { odds: 1.2, result: true }], createdAt: now },
      ]
      const result = assessFragilityScore({ odds: 8.0 }, { odds: 8.0 }, historicalData)

      expect(result.riskLevel).toBe('insufficient_data')
      expect(Number.isNaN(result.fragilityScore)).toBe(true)
    })

    it('应该包含风险等级', () => {
      const raceA = { odds: 3.0 }
      const raceB = { odds: 2.0 }

      const result = assessFragilityScore(raceA, raceB, [])

      expect(['low', 'medium', 'high', 'critical', 'insufficient_data']).toContain(
        result.riskLevel,
      )
    })

    it('无历史时不显示概率式百分比', () => {
      const raceA = { odds: 3.0 }
      const raceB = { odds: 2.0 }

      const result = assessFragilityScore(raceA, raceB, [])

      expect(result.fragilityPercentage).toBe('—')
    })

    it('应该处理无效输入', () => {
      const result = assessFragilityScore(
        { odds: 'invalid' },
        { odds: 2.0 },
        [],
      )

      expect(result.riskLevel).toBe('insufficient_data')
    })
  })

  // ==========================================================================
  // 测试7：组合脆弱性
  // ==========================================================================

  describe('assessComboFragility', () => {
    it('应该分析完整4串组合', () => {
      const combo = [
        { odds: 1.5 },
        { odds: 3.1 },
        { odds: 5.4 },
        { odds: 6.2 },
      ]

      const result = assessComboFragility(combo, [])

      expect(result.comboSize).toBe(4)
      expect(Number.isNaN(result.overallFragility)).toBe(true)
      expect(result.criticalPairs).toEqual([])
      expect(result.recommendations[0].type).toBe('insufficient_data')
      expect(Array.isArray(result.pairAnalysis)).toBe(true)
      expect(Array.isArray(result.criticalPairs)).toBe(true)
      expect(Array.isArray(result.recommendations)).toBe(true)
    })

    it('应该识别所有比赛对', () => {
      const combo = [
        { odds: 1.5 },
        { odds: 3.1 },
        { odds: 5.4 },
        { odds: 6.2 },
      ]

      const result = assessComboFragility(combo, [])

      // 4个比赛的组合应该有 C(4,2) = 6 对
      expect(result.pairAnalysis.length).toBe(6)
    })

    it('应该处理小于2个比赛的情况', () => {
      const combo = [{ odds: 1.5 }]

      const result = assessComboFragility(combo, [])

      expect(isNaN(result.overallFragility)).toBe(true)
      expect(result.comboSize).toBe(0)
    })
  })

  // ==========================================================================
  // 测试8：基准率调整
  // ==========================================================================

  describe('adjustForBaseRate', () => {
    it('应该对正溢价应用保守系数0.8', () => {
      // 空历史会原样返回 premium，故需提供非空数据以触发调整
      const result = adjustForBaseRate(0.1, [{ succeeded: true, matches: [] }], 0.2)

      expect(result.adjustedPremium).toBeCloseTo(0.08, 2)
    })

    it('应该对负溢价应用保守系数1.2', () => {
      const result = adjustForBaseRate(-0.1, [{ succeeded: true, matches: [] }], 0.2)

      expect(result.adjustedPremium).toBeCloseTo(-0.12, 2)
    })

    it('应该计算全局失败率', () => {
      const historicalData = [
        { succeeded: true, matches: [] },
        { succeeded: false, matches: [] },
        { succeeded: false, matches: [] },
      ]

      const result = adjustForBaseRate(0.05, historicalData, 0.2)

      expect(result.globalFailureRate).toBeCloseTo(0.667, 2)
    })
  })

  // ==========================================================================
  // 集成测试
  // ==========================================================================

  describe('完整工作流程', () => {
    it('应该能够评估真实场景的组合脆弱性', () => {
      // 模拟10个历史组合
      const historicalData = Array.from({ length: 10 }, (_, i) => ({
        matches: [
          { odds: 3.5, result: Math.random() > 0.3 },
          { odds: 2.1, result: Math.random() > 0.4 },
          { odds: 4.8, result: Math.random() > 0.2 },
          { odds: 1.7, result: Math.random() > 0.5 },
        ],
        succeeded: Math.random() > 0.6,
        createdAt: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000).toISOString(),
      }))

      const newCombo = [
        { odds: 5.5 },
        { odds: 2.0 },
        { odds: 4.2 },
        { odds: 1.8 },
      ]

      const result = assessComboFragility(newCombo, historicalData)

      expect(result.comboSize).toBe(4)
      expect(result.overallFragility).toBeGreaterThanOrEqual(0)
      expect(result.overallFragility).toBeLessThanOrEqual(100)
      expect(result.pairAnalysis.length).toBe(6)

      // 应该有建议
      if (result.criticalPairs.length > 0) {
        expect(result.recommendations.length).toBeGreaterThan(0)
      }
    })

    it('空历史组合不输出伪精确数字', () => {
      const result = assessComboFragility(
        [
          { odds: 1.5 },
          { odds: 3.1 },
          { odds: 5.4 },
          { odds: 6.2 },
        ],
        [],
      )

      expect(Number.isNaN(result.overallFragility)).toBe(true)
    })
  })
})
