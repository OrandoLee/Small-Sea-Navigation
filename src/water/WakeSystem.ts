import * as THREE from 'three'

type Wake = { mesh: THREE.Mesh; age: number }

export class WakeSystem {
  readonly group = new THREE.Group()
  private wakes: Wake[] = []
  private cooldown = 0

  spawn(position: THREE.Vector3, speed: number): void {
    this.cooldown -= 1 / 60
    if (speed < 0.6 || this.cooldown > 0 || this.wakes.length > 36) return
    this.cooldown = Math.max(0.06, 0.22 - speed * 0.012)
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.34 + speed * 0.025, 18),
      new THREE.MeshBasicMaterial({ color: '#d8fbff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.copy(position).setY(0.09)
    this.group.add(mesh)
    this.wakes.push({ mesh, age: 0 })
  }

  splash(position: THREE.Vector3): void {
    for (let i = 0; i < 8; i += 1) this.spawn(position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3)), 8)
  }

  update(delta: number): void {
    this.wakes.forEach((wake) => {
      wake.age += delta
      wake.mesh.scale.setScalar(1 + wake.age * 2.2)
      ;(wake.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 - wake.age * 0.34)
    })
    this.wakes.filter((wake) => wake.age > 1.5).forEach((wake) => this.group.remove(wake.mesh))
    this.wakes = this.wakes.filter((wake) => wake.age <= 1.5)
  }

  clear(): void {
    this.wakes.forEach((wake) => this.group.remove(wake.mesh))
    this.wakes = []
  }
}

