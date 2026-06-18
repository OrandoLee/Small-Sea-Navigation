import type { BlueprintStats } from '../build/ShipBlueprint'
import type { RuntimeFrame } from '../physics/ShipRigidBody'

export type ShipReport = {
  result: string
  issues: string[]
  suggestions: string[]
}

export function generateReport(stats: BlueprintStats, frame: RuntimeFrame | null): ShipReport {
  const issues: string[] = []
  const suggestions: string[] = []

  if (stats.blocks === 0) {
    return {
      result: '未开始测试',
      issues: ['当前蓝图没有任何模块。'],
      suggestions: ['先用木质船体块和浮力块搭建一条基础船体。'],
    }
  }

  if (stats.unstableBlocks > 0) {
    issues.push(`结构中有 ${stats.unstableBlocks} 个模块存在悬空或断开连接风险，航行时会脱落。`)
    suggestions.push('让所有模块至少与主体船体相连；悬空模块需要底部支撑，或形成左右/前后两侧同时连接的桥接结构。')
  }

  if ((frame?.detachedBlocks ?? 0) > 0) {
    issues.push(`实测过程中已有 ${frame?.detachedBlocks} 个模块从船体上脱落。`)
    suggestions.push('回到船坞后补强这些模块与主体之间的连接，再重新测试。')
  }

  if (stats.buoyancyMargin < 0) {
    issues.push('船体总浮力不足，无法支撑当前质量。')
    suggestions.push('增加底部或两侧浮力块，或减少金属块、货物与大炮模块。')
  }

  if (Math.abs(stats.leftRightMassImbalance) > 0.22) {
    const side = stats.leftRightMassImbalance > 0 ? '右侧' : '左侧'
    issues.push(`${side}质量明显偏高，船体会发生持续侧倾。`)
    suggestions.push('将重物尽量靠近中心线，或在另一侧增加对称结构。')
  }

  if (Math.abs(stats.frontBackMassImbalance) > 0.24) {
    const side = stats.frontBackMassImbalance > 0 ? '船尾' : '船头'
    issues.push(`${side}质量偏高，导致纵向吃水不均。`)
    suggestions.push('在相反方向补充浮力，或把引擎、货物等重物向船体中心移动。')
  }

  if (stats.topWeightRatio > 0.28) {
    issues.push('上层重物比例过高，横浪中恢复力矩不足。')
    suggestions.push('将大炮、货物和金属块下移，并在船底增加少量压载。')
  }

  if (stats.rollStability < 55) {
    issues.push('横向稳定性不足，窄船体或浮力集中会放大翻覆风险。')
    suggestions.push('扩大船宽，在左右两侧布置浮力块提升横向稳定。')
  }

  if (frame?.status === '下沉') {
    issues.push('实测过程中船体持续下沉。')
    suggestions.push('先把浮力余量提升到正值，再进行风浪测试。')
  }

  if (issues.length === 0) {
    issues.push('当前设计没有暴露明显失败项。')
    suggestions.push('可以切换到风暴测试，观察高浪下的最大横倾角与纵倾角。')
  }

  const result = frame?.status ?? (stats.buoyancyMargin >= 0 ? '可下水测试' : '下水风险较高')
  return { result, issues, suggestions }
}

