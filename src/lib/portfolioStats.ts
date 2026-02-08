import type { Position, PortfolioStats } from '../types/app'

export function computePortfolioStats(positions: Position[]): PortfolioStats {
  const settled = positions.filter((p) => p.status === 'settled')
  const wins = settled.filter((p) => p.outcome === 'win')
  const losses = settled.filter((p) => p.outcome === 'lose')
  const voids = settled.filter((p) => p.outcome === 'void')

  let totalPnl = 0
  for (const p of settled) {
    if (p.outcome === 'win') totalPnl += (p.payout ?? 0) - p.cost
    else if (p.outcome === 'lose') totalPnl -= p.cost
    // void: 0 net
  }

  const decidedCount = wins.length + losses.length
  const winRate = decidedCount > 0 ? (wins.length / decidedCount) * 100 : 0

  const totalInvested = settled
    .filter((p) => p.outcome !== 'void')
    .reduce((sum, p) => sum + p.cost, 0)
  const roi = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0

  let bestTradePnl = 0
  let bestTradeLabel = 'N/A'
  for (const p of wins) {
    const pnl = (p.payout ?? 0) - p.cost
    if (pnl > bestTradePnl) {
      bestTradePnl = pnl
      bestTradeLabel = `${p.option} (${p.side.toUpperCase()})`
    }
  }

  const avgProfitPerTrade = decidedCount > 0 ? totalPnl / decidedCount : 0

  return {
    totalPnl,
    winRate,
    roi,
    bestTradePnl,
    bestTradeLabel,
    totalSettled: settled.length,
    wins: wins.length,
    losses: losses.length,
    voids: voids.length,
    avgProfitPerTrade,
  }
}

/**
 * Computes equity curve data points from settled positions.
 * Returns cumulative P&L values in chronological order, starting from 0.
 */
export function computeEquityCurve(positions: Position[]): number[] {
  const settled = positions
    .filter((p) => p.status === 'settled' && p.settledAt)
    .sort((a, b) => new Date(a.settledAt!).getTime() - new Date(b.settledAt!).getTime())

  if (settled.length === 0) return [0]

  const curve: number[] = [0]
  let cumulative = 0

  for (const p of settled) {
    if (p.outcome === 'win') cumulative += (p.payout ?? 0) - p.cost
    else if (p.outcome === 'lose') cumulative -= p.cost
    curve.push(cumulative)
  }

  return curve
}
