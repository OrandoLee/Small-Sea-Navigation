import * as THREE from 'three'
import type { PlacedModule } from '../modules/ModuleDefinition'
import { MODULE_DEFINITIONS } from '../modules/ModuleTypes'
import type { BlueprintStats } from '../build/ShipBlueprint'
import type { WaveField } from './WaveField'

export type RuntimeFrame = {
  y: number
  roll: number
  pitch: number
  maxRoll: number
  maxPitch: number
  status: string
  detachedBlocks: number
}

export type ShipControls = {
  throttle: number
  turn: number
}

const IDLE_CONTROLS: ShipControls = {
  throttle: 0,
  turn: 0,
}

export class ShipRigidBody {
  position = new THREE.Vector3()
  rotation = new THREE.Euler(0, 0, 0, 'YXZ')
  velocity = new THREE.Vector3()
  horizontalVelocity = new THREE.Vector3()
  angularVelocity = 0
  rudderDeflection = 0
  maxRoll = 0
  maxPitch = 0
  capsized = false
  sunk = false
  private readonly forwardLocal: THREE.Vector3
  private steeringLoad = 0

  constructor(
    private readonly stats: BlueprintStats,
    private readonly modules: PlacedModule[],
    private readonly detachedBlockCount = 0,
  ) {
    this.forwardLocal = this.computeForwardLocal()
  }

  reset(): void {
    this.position.set(0, this.restingWaterOffset(), 0)
    this.rotation.set(0, 0, 0)
    this.velocity.set(0, 0, 0)
    this.horizontalVelocity.set(0, 0, 0)
    this.angularVelocity = 0
    this.rudderDeflection = 0
    this.steeringLoad = 0
    this.maxRoll = 0
    this.maxPitch = 0
    this.capsized = false
    this.sunk = false
  }

  update(delta: number, waveField: WaveField, controls: ShipControls = IDLE_CONTROLS): RuntimeFrame {
    this.updatePlanarMotion(delta, controls, waveField.severity())

    const water = waveField.heightAt(this.position.x, this.position.z)
    const floatTarget = water + this.restingWaterOffset()
    const floatError = floatTarget - this.position.y
    const buoyantAcceleration = floatError * 8.4 + this.stats.buoyancyMargin * 0.18
    const gravityPenalty = this.stats.buoyancyMargin < 0 ? this.stats.buoyancyMargin * 0.55 : 0
    this.velocity.y += (buoyantAcceleration + gravityPenalty) * delta
    this.velocity.y *= Math.pow(0.24, delta)
    this.position.y += this.velocity.y * delta

    const waveKick = waveField.heightAt(this.position.x + 1.2, this.position.z) - waveField.heightAt(this.position.x - 1.2, this.position.z)
    const pitchWave = waveField.heightAt(this.position.x, this.position.z + 1.8) - waveField.heightAt(this.position.x, this.position.z - 1.8)
    const highCenter = Math.max(0, this.stats.topWeightRatio - 0.22)
    const targetRoll = THREE.MathUtils.clamp(
      this.stats.leftRightMassImbalance * 0.86 + waveKick * (0.58 + highCenter * 2.6) - this.steeringLoad * 0.26,
      -1.42,
      1.42,
    )
    const targetPitch = THREE.MathUtils.clamp(
      this.stats.frontBackMassImbalance * 0.68 + pitchWave * (0.32 + highCenter * 1.5),
      -1.05,
      1.05,
    )

    this.rotation.z = THREE.MathUtils.lerp(this.rotation.z, targetRoll, 1 - Math.pow(0.035, delta))
    this.rotation.x = THREE.MathUtils.lerp(this.rotation.x, targetPitch, 1 - Math.pow(0.05, delta))

    this.maxRoll = Math.max(this.maxRoll, Math.abs(THREE.MathUtils.radToDeg(this.rotation.z)))
    this.maxPitch = Math.max(this.maxPitch, Math.abs(THREE.MathUtils.radToDeg(this.rotation.x)))
    this.sunk = this.position.y < -2.2 || this.stats.buoyancyMargin < -2.6
    this.capsized = this.maxRoll > 62 || (highCenter > 0.16 && waveField.seaState === 'storm' && this.maxRoll > 45)

    return {
      y: this.position.y,
      roll: THREE.MathUtils.radToDeg(this.rotation.z),
      pitch: THREE.MathUtils.radToDeg(this.rotation.x),
      maxRoll: this.maxRoll,
      maxPitch: this.maxPitch,
      status: this.getStatus(),
      detachedBlocks: this.detachedBlockCount,
    }
  }

  private updatePlanarMotion(delta: number, controls: ShipControls, waterSeverity: number): void {
    const forward = this.forwardLocal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation.y)
    const throttle = THREE.MathUtils.clamp(controls.throttle, -1, 1)
    const turn = THREE.MathUtils.clamp(controls.turn, -1, 1)
    const enginePower = this.stats.enginePower
    const rudderPower = this.stats.rudderPower
    const massFactor = THREE.MathUtils.clamp(18 / Math.max(this.stats.totalMass, 8), 0.38, 1.35)
    const acceleration = (enginePower > 0 ? 2.2 + enginePower * 0.68 : 0.12) * massFactor * throttle

    this.horizontalVelocity.addScaledVector(forward, acceleration * delta)
    this.horizontalVelocity.multiplyScalar(Math.pow(0.82 - Math.min(0.12, waterSeverity * 0.025), delta))

    const maxSpeed = enginePower > 0 ? (4.2 + enginePower * 0.82) * Math.sqrt(massFactor) : 0.35
    const speed = this.horizontalVelocity.length()
    if (speed > maxSpeed) this.horizontalVelocity.setLength(maxSpeed)

    this.rudderDeflection = THREE.MathUtils.lerp(this.rudderDeflection, turn, 1 - Math.pow(0.055, delta))
    const steerAuthority = rudderPower > 0 ? 0.24 + Math.min(1.8, rudderPower * 0.76) : 0.035
    const speedAssist = 0.35 + Math.min(0.75, this.horizontalVelocity.length() / Math.max(maxSpeed, 0.001))
    const steerAcceleration = this.rudderDeflection * steerAuthority * speedAssist
    this.angularVelocity += steerAcceleration * delta
    this.angularVelocity *= Math.pow(0.32, delta)
    this.steeringLoad = this.rudderDeflection * speedAssist
    this.horizontalVelocity.multiplyScalar(1 - Math.min(0.18, Math.abs(this.steeringLoad) * 0.05))
    this.rotation.y += this.angularVelocity * delta
    this.position.addScaledVector(this.horizontalVelocity, delta)
  }

  private restingWaterOffset(): number {
    const balance = THREE.MathUtils.clamp(this.stats.buoyancyMargin / Math.max(this.stats.totalMass, 1), -0.65, 0.65)
    const submergedDepth = THREE.MathUtils.clamp(0.18 + this.stats.estimatedDraft * 0.32 - balance * 0.24, 0.08, 0.76)
    return -submergedDepth
  }

  private computeForwardLocal(): THREE.Vector3 {
    const rudders = this.modules.filter((module) => module.type === 'rudder')
    if (rudders.length === 0) return new THREE.Vector3(0, 0, -1)

    const center = new THREE.Vector3()
    this.modules.forEach((module) => {
      center.x += module.gridPosition.x
      center.z += module.gridPosition.z
    })
    center.divideScalar(Math.max(1, this.modules.length))

    const stern = new THREE.Vector3()
    rudders.forEach((module) => {
      stern.x += module.gridPosition.x - center.x
      stern.z += module.gridPosition.z - center.z
    })
    stern.divideScalar(rudders.length)
    if (stern.lengthSq() < 0.0001) return new THREE.Vector3(0, 0, -1)

    return stern.normalize().multiplyScalar(-1)
  }

  getSamplePoints(): THREE.Vector3[] {
    return this.modules.map((module) => {
      const def = MODULE_DEFINITIONS[module.type]
      return new THREE.Vector3(
        module.gridPosition.x,
        module.gridPosition.y + 0.5 + def.buoyancy * 0.02,
        module.gridPosition.z,
      ).applyEuler(this.rotation).add(this.position)
    })
  }

  private getStatus(): string {
    if (this.sunk) return '下沉'
    if (this.capsized) return '翻覆风险'
    if (this.detachedBlockCount > 0) return '结构脱落'
    if (this.stats.buoyancyMargin < 0) return '浮力不足'
    if (Math.abs(this.rotation.z) > 0.42) return '发生侧倾'
    if (this.rotation.x < -0.35) return '船头过重'
    if (this.rotation.x > 0.35) return '船尾过重'
    return '稳定漂浮'
  }
}

