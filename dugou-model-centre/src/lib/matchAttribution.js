const number = (value) => Number.parseFloat(value)

/** Descriptive accounting allocation only, not observed stand-alone leg P&L. */
export const splitInvestmentToMatches = (investment) => {
  const matches = Array.isArray(investment.matches) ? investment.matches : []
  if (!matches.length) return []
  const inputs = Math.max(0, number(investment.inputs) || 0)
  const declared = number(investment.revenues), profit = number(investment.profit)
  const revenue = investment.status === 'pending' ? NaN
    : Number.isFinite(declared) ? Math.max(0, declared) : Number.isFinite(profit) ? Math.max(0, inputs + profit) : NaN
  const odds = matches.map((m) => Math.max(0, number(m.odds) || 0))
  const sum = odds.reduce((s, n) => s + n, 0)
  return matches.map((match, i) => {
    const allocatedRevenue = revenue * (sum > 0 ? odds[i] / sum : 1 / matches.length)
    return { ...match, allocated_input: inputs / matches.length,
      allocated_revenue: allocatedRevenue, allocated_profit: allocatedRevenue - inputs / matches.length,
      attribution_basis: matches.length > 1 ? 'synthetic_equal_stake_odds_weighted_revenue' : 'single_match_realized',
    }
  })
}
