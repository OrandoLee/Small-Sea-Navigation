import type { GridPosition, ModuleType, PlacedModule } from '../modules/ModuleDefinition'
import { MODULE_DEFINITIONS } from '../modules/ModuleTypes'

export type BlueprintStats = {
  blocks: number
  totalMass: number
  totalBuoyancy: number
  buoyancyMargin: number
  centerOfMass: GridPosition
  estimatedCenterOfBuoyancy: GridPosition
  estimatedDraft: number
  rollStability: number
  pitchStability: number
  topWeightRatio: number
  enginePower: number
  rudderPower: number
  leftRightMassImbalance: number
  frontBackMassImbalance: number
  floatingBlocks: number
  disconnectedBlocks: number
  unstableBlocks: number
  structuralWarnings: string[]
}

export type StructuralAnalysis = {
  floatingModuleIds: string[]
  disconnectedModuleIds: string[]
  unstableModuleIds: string[]
  stableModuleIds: string[]
  componentCount: number
  warnings: string[]
}

const emptyPoint: GridPosition = { x: 0, y: 0, z: 0 }

export class ShipBlueprint {
  private modules = new Map<string, PlacedModule>()

  addModule(type: ModuleType, gridPosition: GridPosition, rotation: number): PlacedModule | null {
    const key = this.key(gridPosition)
    if (this.modules.has(key)) return null

    const module: PlacedModule = {
      id: crypto.randomUUID(),
      type,
      gridPosition: { ...gridPosition },
      rotation,
    }

    this.modules.set(key, module)
    return module
  }

  removeModule(gridPosition: GridPosition): PlacedModule | null {
    const key = this.key(gridPosition)
    const existing = this.modules.get(key) ?? null
    this.modules.delete(key)
    return existing
  }

  clear(): void {
    this.modules.clear()
  }

  getAt(gridPosition: GridPosition): PlacedModule | null {
    return this.modules.get(this.key(gridPosition)) ?? null
  }

  getModules(): PlacedModule[] {
    return [...this.modules.values()]
  }

  serialize(): string {
    return JSON.stringify(this.getModules())
  }

  deserialize(raw: string): void {
    const parsed = JSON.parse(raw) as PlacedModule[]
    this.clear()
    parsed.forEach((module) => this.modules.set(this.key(module.gridPosition), module))
  }

  getStats(modules = this.getModules()): BlueprintStats {
    const structure = this.analyzeStructure(modules)
    if (modules.length === 0) {
      return {
        blocks: 0,
        totalMass: 0,
        totalBuoyancy: 0,
        buoyancyMargin: 0,
        centerOfMass: emptyPoint,
        estimatedCenterOfBuoyancy: emptyPoint,
        estimatedDraft: 0,
        rollStability: 0,
        pitchStability: 0,
        topWeightRatio: 0,
        enginePower: 0,
        rudderPower: 0,
        leftRightMassImbalance: 0,
        frontBackMassImbalance: 0,
        floatingBlocks: 0,
        disconnectedBlocks: 0,
        unstableBlocks: 0,
        structuralWarnings: [],
      }
    }

    let totalMass = 0
    let totalBuoyancy = 0
    let massX = 0
    let massY = 0
    let massZ = 0
    let buoyX = 0
    let buoyY = 0
    let buoyZ = 0
    let leftMass = 0
    let rightMass = 0
    let bowMass = 0
    let sternMass = 0
    let topMass = 0
    let enginePower = 0
    let rudderPower = 0

    for (const module of modules) {
      const def = MODULE_DEFINITIONS[module.type]
      const { x, y, z } = module.gridPosition
      totalMass += def.mass
      totalBuoyancy += def.buoyancy
      massX += x * def.mass
      massY += y * def.mass
      massZ += z * def.mass
      buoyX += x * def.buoyancy
      buoyY += y * def.buoyancy
      buoyZ += z * def.buoyancy
      if (x < 0) leftMass += def.mass
      if (x > 0) rightMass += def.mass
      if (z < 0) bowMass += def.mass
      if (z > 0) sternMass += def.mass
      if (y >= 2 || (y >= 1 && def.mass >= 2.5)) topMass += def.mass
      enginePower += def.thrust ?? 0
      rudderPower += def.turnPower ?? 0
    }

    const widthSpan = Math.max(1, new Set(modules.map((m) => m.gridPosition.x)).size)
    const lengthSpan = Math.max(1, new Set(modules.map((m) => m.gridPosition.z)).size)
    const centerOfMass = {
      x: massX / totalMass,
      y: massY / totalMass,
      z: massZ / totalMass,
    }
    const estimatedCenterOfBuoyancy = totalBuoyancy > 0
      ? { x: buoyX / totalBuoyancy, y: buoyY / totalBuoyancy, z: buoyZ / totalBuoyancy }
      : emptyPoint
    const topWeightRatio = topMass / totalMass
    const buoyancyMargin = totalBuoyancy - totalMass
    const imbalanceBase = Math.max(totalMass, 0.001)
    const leftRightMassImbalance = (rightMass - leftMass) / imbalanceBase
    const frontBackMassImbalance = (sternMass - bowMass) / imbalanceBase

    return {
      blocks: modules.length,
      totalMass,
      totalBuoyancy,
      buoyancyMargin,
      centerOfMass,
      estimatedCenterOfBuoyancy,
      estimatedDraft: Math.max(0, Math.min(1.8, totalMass / Math.max(totalBuoyancy, 0.1))),
      rollStability: Math.max(0, Math.min(100, 78 + widthSpan * 8 - topWeightRatio * 95 - Math.abs(leftRightMassImbalance) * 50)),
      pitchStability: Math.max(0, Math.min(100, 72 + lengthSpan * 4 - Math.abs(frontBackMassImbalance) * 56 - topWeightRatio * 24)),
      topWeightRatio,
      enginePower,
      rudderPower,
      leftRightMassImbalance,
      frontBackMassImbalance,
      floatingBlocks: structure.floatingModuleIds.length,
      disconnectedBlocks: structure.disconnectedModuleIds.length,
      unstableBlocks: structure.unstableModuleIds.length,
      structuralWarnings: structure.warnings,
    }
  }

  analyzeStructure(modules = this.getModules()): StructuralAnalysis {
    if (modules.length === 0) {
      return {
        floatingModuleIds: [],
        disconnectedModuleIds: [],
        unstableModuleIds: [],
        stableModuleIds: [],
        componentCount: 0,
        warnings: [],
      }
    }

    const byKey = new Map(modules.map((module) => [this.key(module.gridPosition), module]))
    const byId = new Map(modules.map((module) => [module.id, module]))
    const visited = new Set<string>()
    const components: string[][] = []
    const directions = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ]

    for (const module of modules) {
      if (visited.has(module.id)) continue

      const component: string[] = []
      const queue = [module]
      visited.add(module.id)

      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const current = queue[cursor]
        component.push(current.id)
        for (const direction of directions) {
          const neighbor = byKey.get(this.key({
            x: current.gridPosition.x + direction.x,
            y: current.gridPosition.y + direction.y,
            z: current.gridPosition.z + direction.z,
          }))
          if (!neighbor || visited.has(neighbor.id)) continue
          visited.add(neighbor.id)
          queue.push(neighbor)
        }
      }

      components.push(component)
    }

    const supportedScore = (component: string[]): number => component.reduce((score, id) => {
      const module = byId.get(id)
      return score + (module?.gridPosition.y === 0 ? 1 : 0)
    }, 0)

    const mainComponent = [...components].sort((a, b) => {
      const sizeDelta = b.length - a.length
      if (sizeDelta !== 0) return sizeDelta
      return supportedScore(b) - supportedScore(a)
    })[0] ?? []
    const mainIds = new Set(mainComponent)
    const disconnectedModuleIds = components.flatMap((component) => (
      component === mainComponent ? [] : component
    ))

    const floatingModuleIds = modules
      .filter((module) => module.gridPosition.y > 0 && !this.hasDirectSupport(module, byKey) && !this.isBridged(module, byKey))
      .map((module) => module.id)

    const unstableIds = new Set([...disconnectedModuleIds, ...floatingModuleIds])
    const stableModuleIds = modules
      .filter((module) => mainIds.has(module.id) && !unstableIds.has(module.id))
      .map((module) => module.id)

    const warnings: string[] = []
    if (components.length > 1) warnings.push(`船体存在 ${components.length} 个互不相连的结构，出航后非主体结构会脱落。`)
    if (floatingModuleIds.length > 0) warnings.push(`发现 ${floatingModuleIds.length} 个缺少支撑的悬空模块，航行时可能坍塌掉落。`)

    return {
      floatingModuleIds,
      disconnectedModuleIds,
      unstableModuleIds: [...unstableIds],
      stableModuleIds,
      componentCount: components.length,
      warnings,
    }
  }

  private hasDirectSupport(module: PlacedModule, byKey: Map<string, PlacedModule>): boolean {
    const { x, y, z } = module.gridPosition
    return byKey.has(this.key({ x, y: y - 1, z }))
  }

  private isBridged(module: PlacedModule, byKey: Map<string, PlacedModule>): boolean {
    const { x, y, z } = module.gridPosition
    const hasLeft = byKey.has(this.key({ x: x - 1, y, z }))
    const hasRight = byKey.has(this.key({ x: x + 1, y, z }))
    const hasFront = byKey.has(this.key({ x, y, z: z - 1 }))
    const hasBack = byKey.has(this.key({ x, y, z: z + 1 }))
    return (hasLeft && hasRight) || (hasFront && hasBack)
  }

  private key(position: GridPosition): string {
    return `${position.x}:${position.y}:${position.z}`
  }
}

