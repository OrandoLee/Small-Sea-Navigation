export type VoyageFrameData = {
  speed: number
  distance: number
  roll: number
}

export type VoyageRecord = {
  elapsed: number
  maxSpeed: number
  averageSpeed: number
  maxRoll: number
  collisions: number
  groundings: number
  finalDistance: number
  completed: boolean
}

export class VoyageRecorder {
  private elapsed = 0
  private speedSum = 0
  private samples = 0
  private maxSpeed = 0
  private maxRoll = 0
  private collisions = 0
  private groundings = 0
  private finalDistance = 0

  start(): void {
    this.elapsed = 0
    this.speedSum = 0
    this.samples = 0
    this.maxSpeed = 0
    this.maxRoll = 0
    this.collisions = 0
    this.groundings = 0
    this.finalDistance = 0
  }

  record(delta: number, frame: VoyageFrameData): void {
    this.elapsed += delta
    this.speedSum += frame.speed
    this.samples += 1
    this.maxSpeed = Math.max(this.maxSpeed, frame.speed)
    this.maxRoll = Math.max(this.maxRoll, Math.abs(frame.roll))
    this.finalDistance = frame.distance
  }

  markCollision(): void { this.collisions += 1 }
  markGrounding(): void { this.groundings += 1 }

  stop(completed: boolean): VoyageRecord {
    return {
      elapsed: this.elapsed,
      maxSpeed: this.maxSpeed,
      averageSpeed: this.samples ? this.speedSum / this.samples : 0,
      maxRoll: this.maxRoll,
      collisions: this.collisions,
      groundings: this.groundings,
      finalDistance: this.finalDistance,
      completed,
    }
  }

  snapshot(completed = false): VoyageRecord {
    return this.stop(completed)
  }
}

