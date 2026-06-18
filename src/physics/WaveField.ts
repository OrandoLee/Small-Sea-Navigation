export type SeaState = 'calm' | 'wave' | 'storm'

export const SEA_STATE_LABELS: Record<SeaState, string> = {
  calm: '平静',
  wave: '小浪',
  storm: '风暴测试',
}

export class WaveField {
  seaState: SeaState = 'wave'
  time = 0

  update(delta: number): void {
    this.time += delta
  }

  heightAt(x: number, z: number): number {
    const presets = {
      calm: { amp: 0.04, speed: 0.7 },
      wave: { amp: 0.18, speed: 1.15 },
      storm: { amp: 0.42, speed: 1.85 },
    }[this.seaState]

    return (
      Math.sin(x * 0.75 + this.time * presets.speed) * presets.amp +
      Math.sin(z * 0.46 + this.time * presets.speed * 0.86) * presets.amp * 0.72 +
      Math.sin((x + z) * 0.32 + this.time * presets.speed * 1.3) * presets.amp * 0.4
    )
  }

  severity(): number {
    return this.seaState === 'calm' ? 0.35 : this.seaState === 'wave' ? 1 : 1.85
  }
}

