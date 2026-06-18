import type { BlueprintStats } from '../build/ShipBlueprint'
import type { VoyageRecord } from './VoyageRecorder'

export type VoyageReport = {
  result: string
  evaluation: string
  issues: string[]
  suggestions: string[]
}

export class VoyageReportGenerator {
  generate(record: VoyageRecord, stats: BlueprintStats): VoyageReport {
    const issues: string[] = []
    const suggestions: string[] = []
    if (stats.enginePower <= 0) { issues.push('船体没有有效引擎，推进能力极低。'); suggestions.push('在船尾增加至少一个引擎模块。') }
    if (stats.rudderPower <= 0) { issues.push('船舵不足，转向半径过大。'); suggestions.push('在船尾增加船舵模块以提升转向。') }
    if (stats.estimatedDraft > 1.1 || record.groundings > 0) { issues.push('吃水偏深，在浅滩区域存在搁浅风险。'); suggestions.push('减少货物或压载块，并在两侧增加浮力块。') }
    if (record.collisions > 0) { issues.push(`航程中发生 ${record.collisions} 次礁石碰撞。`); suggestions.push('降低入弯速度，并沿浮标航道航行。') }
    if (record.maxRoll > 30 || stats.rollStability < 55) { issues.push('船体横向稳定性不足，转向时横倾明显。'); suggestions.push('扩大船宽、降低上层结构并平衡左右质量。') }
    if (!issues.length) issues.push('船体与驾驶表现稳定，适合继续远航。')
    if (!suggestions.length) suggestions.push('当前设计均衡，可尝试增加少量货物测试载重上限。')

    let evaluation = record.completed ? 'Successful Arrival / 成功抵达' : 'Aborted / 航行中止'
    if (record.completed && !record.collisions && !record.groundings) evaluation = 'Smooth Voyage / 平稳航行'
    else if (stats.totalMass > 25) evaluation = 'Heavy but Reliable / 笨重但可靠'
    else if (record.maxSpeed > 9 && record.maxRoll > 25) evaluation = 'Fast but Unstable / 快速但不稳定'
    else if (record.groundings) evaluation = 'Shallow Water Risk / 吃水过深'

    return { result: record.completed ? 'Voyage Complete / 航行完成' : 'Voyage Aborted / 航行中止', evaluation, issues, suggestions }
  }
}

