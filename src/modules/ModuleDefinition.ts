export type ModuleType =
  | 'wood'
  | 'buoyancy'
  | 'ballast'
  | 'metal'
  | 'engine'
  | 'rudder'
  | 'cannon'
  | 'cargo'

export type ModuleDefinition = {
  type: ModuleType
  name: string
  shortName: string
  description: string
  mass: number
  buoyancy: number
  durability: number
  drag: number
  thrust?: number
  turnPower?: number
  recoil?: number
  color: string
  emissive?: string
  tags: string[]
}

export type GridPosition = {
  x: number
  y: number
  z: number
}

export type PlacedModule = {
  id: string
  type: ModuleType
  gridPosition: GridPosition
  rotation: number
}

