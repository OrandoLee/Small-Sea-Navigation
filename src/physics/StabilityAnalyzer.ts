import type { BlueprintStats } from '../build/ShipBlueprint'

export type StabilitySummary = {
  score: number
  status: string
  warnings: string[]
}

export function analyzeStats(stats: BlueprintStats): StabilitySummary {
  if (stats.blocks === 0) {
    return { score: 0, status: '等待建造', warnings: ['请先放置至少一个船体或浮力模块。'] }
  }

  const warnings: string[] = []
  if (stats.totalBuoyancy <= 0.2) warnings.push('缺少有效浮力来源。')
  if (stats.buoyancyMargin < 0) warnings.push('总浮力低于总质量，存在下沉风险。')
  if (Math.abs(stats.leftRightMassImbalance) > 0.22) warnings.push('左右质量分布不均，可能持续侧倾。')
  if (Math.abs(stats.frontBackMassImbalance) > 0.24) warnings.push('前后质量分布不均，可能出现纵倾。')
  if (stats.topWeightRatio > 0.28) warnings.push('上层重物比例偏高，风浪中翻覆风险上升。')
  warnings.push(...stats.structuralWarnings)

  const floatScore = Math.max(0, Math.min(100, 55 + stats.buoyancyMargin * 14))
  const balanceScore = Math.max(0, 100 - Math.abs(stats.leftRightMassImbalance) * 95 - Math.abs(stats.frontBackMassImbalance) * 70)
  const structurePenalty = stats.unstableBlocks * 12 + stats.disconnectedBlocks * 4
  const score = Math.max(0, Math.round(
    floatScore * 0.38 + stats.rollStability * 0.28 + stats.pitchStability * 0.2 + balanceScore * 0.14 - structurePenalty,
  ))

  let status = '稳定漂浮'
  if (stats.unstableBlocks > 0) status = '结构坍塌风险'
  else if (stats.buoyancyMargin < -1) status = '浮力不足'
  else if (stats.topWeightRatio > 0.36) status = '翻覆风险'
  else if (Math.abs(stats.leftRightMassImbalance) > 0.3) status = '发生侧倾'
  else if (stats.frontBackMassImbalance < -0.3) status = '船头过重'
  else if (stats.frontBackMassImbalance > 0.3) status = '船尾过重'

  return { score, status, warnings }
}

