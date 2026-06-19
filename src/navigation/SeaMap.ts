import * as THREE from 'three'

export type MapCollision = {
  normal: THREE.Vector3
  penetration: number
  label: string
  restitution: number
}

type Reef = { position: THREE.Vector3; radius: number }
type CircleCollider = {
  shape: 'circle'
  center: THREE.Vector2
  radius: number
  label: string
  restitution: number
}
type BoxCollider = {
  shape: 'box'
  center: THREE.Vector2
  halfSize: THREE.Vector2
  label: string
  restitution: number
}
type MapCollider = CircleCollider | BoxCollider

export class SeaMap {
  readonly start = new THREE.Vector3(0, 0, 12)
  readonly islandGoal = new THREE.Vector3(0, 0, -118)
  private readonly islandCenter = new THREE.Vector3(0, 0, -144)
  private readonly islandCollisionRadius = 19.5
  readonly reefs: Reef[] = [
    { position: new THREE.Vector3(-14, 0, -35), radius: 4.4 },
    { position: new THREE.Vector3(12, 0, -53), radius: 3.8 },
    { position: new THREE.Vector3(-9, 0, -78), radius: 5.2 },
    { position: new THREE.Vector3(17, 0, -105), radius: 4.6 },
    { position: new THREE.Vector3(-18, 0, -119), radius: 3.6 },
  ]
  private readonly colliders: MapCollider[]

  constructor() {
    this.colliders = [
      this.boxCollider(0, 25, 13, 7, '港口防波堤', 0.08),
      this.boxCollider(-7, 12, 1.7, 9, '左侧栈桥', 0.12),
      this.boxCollider(7, 12, 1.7, 9, '右侧栈桥', 0.12),
      this.circleCollider(
        this.islandCenter.x,
        this.islandCenter.z,
        this.islandCollisionRadius,
        '目标岛屿主体',
        0.08,
      ),
      ...this.reefs.map((reef, index) => this.circleCollider(
        reef.position.x,
        reef.position.z,
        reef.radius * 0.92,
        `礁石 ${index + 1}`,
        0.34,
      )),
      ...this.getBuoyPositions().map((position, index) => this.circleCollider(
        position.x,
        position.y,
        0.72,
        `航道浮标 ${index + 1}`,
        0.48,
      )),
    ]
  }

  createVisuals(): THREE.Group {
    const world = new THREE.Group()
    world.name = 'small-sea-map'
    this.addHarbor(world)
    this.addIsland(world)
    this.addShoals(world)
    this.addReefs(world)
    this.addBuoys(world)
    return world
  }

  getDepthAt(x: number, z: number): number {
    const shoalA = Math.hypot(x - 18, z + 66)
    const shoalB = Math.hypot(x + 20, z + 103)
    if (shoalA < 16) return 0.72 + shoalA * 0.035
    if (shoalB < 13) return 0.82 + shoalB * 0.04
    return 5.4
  }

  isInShallowWater(position: THREE.Vector3): boolean {
    return this.getDepthAt(position.x, position.z) < 1.35
  }

  checkCollision(position: THREE.Vector3, shipRadius = 1.7): MapCollision | null {
    for (const collider of this.colliders) {
      if (collider.shape === 'circle') {
        const dx = position.x - collider.center.x
        const dz = position.z - collider.center.y
        const distance = Math.hypot(dx, dz)
        const limit = collider.radius + shipRadius
        if (distance >= limit) continue
        const normal = new THREE.Vector3(dx || 0.01, 0, dz).normalize()
        return {
          normal,
          penetration: limit - distance,
          label: collider.label,
          restitution: collider.restitution,
        }
      }

      const minX = collider.center.x - collider.halfSize.x
      const maxX = collider.center.x + collider.halfSize.x
      const minZ = collider.center.y - collider.halfSize.y
      const maxZ = collider.center.y + collider.halfSize.y
      const closestX = THREE.MathUtils.clamp(position.x, minX, maxX)
      const closestZ = THREE.MathUtils.clamp(position.z, minZ, maxZ)
      let dx = position.x - closestX
      let dz = position.z - closestZ
      let distance = Math.hypot(dx, dz)
      if (distance >= shipRadius) continue

      if (distance < 0.0001) {
        const distances = [
          { value: Math.abs(position.x - minX), normal: new THREE.Vector3(-1, 0, 0) },
          { value: Math.abs(maxX - position.x), normal: new THREE.Vector3(1, 0, 0) },
          { value: Math.abs(position.z - minZ), normal: new THREE.Vector3(0, 0, -1) },
          { value: Math.abs(maxZ - position.z), normal: new THREE.Vector3(0, 0, 1) },
        ].sort((a, b) => a.value - b.value)
        return {
          normal: distances[0].normal,
          penetration: shipRadius + distances[0].value,
          label: collider.label,
          restitution: collider.restitution,
        }
      }

      dx /= distance
      dz /= distance
      return {
        normal: new THREE.Vector3(dx, 0, dz),
        penetration: shipRadius - distance,
        label: collider.label,
        restitution: collider.restitution,
      }
    }
    return null
  }

  checkReefCollision(position: THREE.Vector3, shipRadius = 1.7): MapCollision | null {
    return this.checkCollision(position, shipRadius)
  }

  getDistanceToIsland(position: THREE.Vector3): number {
    return Math.hypot(position.x - this.islandGoal.x, position.z - this.islandGoal.z)
  }

  private addHarbor(world: THREE.Group): void {
    const concrete = new THREE.MeshStandardMaterial({ color: '#222b30', roughness: 0.86 })
    const wood = new THREE.MeshStandardMaterial({ color: '#715139', roughness: 0.82 })
    const quay = new THREE.Mesh(new THREE.BoxGeometry(26, 2.2, 14), concrete)
    quay.position.set(0, -0.8, 25)
    world.add(quay)
    ;[-7, 7].forEach((x) => {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.45, 18), wood)
      pier.position.set(x, 0.18, 12)
      world.add(pier)
    })
    ;[-10, 10].forEach((x) => {
      const lamp = new THREE.PointLight('#7bdcff', 9, 28, 2)
      lamp.position.set(x, 3, 18)
      world.add(lamp)
    })
  }

  private addIsland(world: THREE.Group): void {
    const sand = new THREE.MeshStandardMaterial({ color: '#b7a77b', roughness: 0.96 })
    const rock = new THREE.MeshStandardMaterial({ color: '#37433d', roughness: 0.98 })
    const beach = new THREE.Mesh(new THREE.CylinderGeometry(18, 24, 2.2, 22), sand)
    beach.position.copy(this.islandCenter).setY(-0.8)
    world.add(beach)
    const hill = new THREE.Mesh(new THREE.ConeGeometry(15, 15, 18), rock)
    hill.position.copy(this.islandCenter).add(new THREE.Vector3(3, 6, -4))
    world.add(hill)
    const lighthouse = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 2.2, 12, 12),
      new THREE.MeshStandardMaterial({ color: '#d9ddd8', roughness: 0.65 }),
    )
    lighthouse.position.copy(this.islandCenter).add(new THREE.Vector3(-5, 5.6, 4))
    world.add(lighthouse)
    const beacon = new THREE.PointLight('#77e8ff', 28, 55, 1.7)
    beacon.position.copy(this.islandCenter).add(new THREE.Vector3(-5, 12.2, 4))
    world.add(beacon)
    const goal = new THREE.Mesh(
      new THREE.TorusGeometry(7, 0.22, 10, 48),
      new THREE.MeshBasicMaterial({ color: '#74e2ff', transparent: true, opacity: 0.72 }),
    )
    goal.rotation.x = Math.PI / 2
    goal.position.copy(this.islandGoal).setY(0.25)
    goal.name = 'island-goal-ring'
    world.add(goal)
  }

  private addShoals(world: THREE.Group): void {
    const mat = new THREE.MeshBasicMaterial({ color: '#66d7cb', transparent: true, opacity: 0.16, depthWrite: false })
    ;[
      [18, -66, 32],
      [-20, -103, 26],
    ].forEach(([x, z, size]) => {
      const shoal = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 40), mat)
      shoal.rotation.x = -Math.PI / 2
      shoal.position.set(x, 0.05, z)
      world.add(shoal)
    })
  }

  private addReefs(world: THREE.Group): void {
    const mat = new THREE.MeshStandardMaterial({ color: '#292e2d', roughness: 1 })
    this.reefs.forEach((reef, index) => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(reef.radius, 0), mat)
      rock.scale.set(1, 0.75 + (index % 2) * 0.22, 0.8)
      rock.position.copy(reef.position).setY(1.25)
      rock.rotation.set(index * 0.3, index * 0.6, index * 0.17)
      world.add(rock)
    })
  }

  private addBuoys(world: THREE.Group): void {
    const red = new THREE.MeshStandardMaterial({ color: '#ff6a56', emissive: '#63150f', emissiveIntensity: 0.35 })
    const green = new THREE.MeshStandardMaterial({ color: '#65e6bb', emissive: '#0a5b48', emissiveIntensity: 0.35 })
    this.getBuoyPositions().forEach((position, index) => {
      const side = index % 2
        const buoy = new THREE.Group()
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 1.7, 10), side === 0 ? red : green)
        body.position.y = 0.65
        buoy.add(body)
        const light = new THREE.PointLight(side === 0 ? '#ff6a56' : '#65e6bb', 2.4, 9)
        light.position.y = 1.75
        buoy.add(light)
        buoy.position.set(position.x, 0, position.y)
        world.add(buoy)
    })
  }

  private getBuoyPositions(): THREE.Vector2[] {
    const positions: THREE.Vector2[] = []
    for (let i = 0; i < 8; i += 1) {
      const z = -8 - i * 17
      ;[-7, 7].forEach((x) => {
        positions.push(new THREE.Vector2(x + Math.sin(i * 1.7) * 4.5, z))
      })
    }
    return positions
  }

  private circleCollider(
    x: number,
    z: number,
    radius: number,
    label: string,
    restitution: number,
  ): CircleCollider {
    return { shape: 'circle', center: new THREE.Vector2(x, z), radius, label, restitution }
  }

  private boxCollider(
    x: number,
    z: number,
    halfWidth: number,
    halfLength: number,
    label: string,
    restitution: number,
  ): BoxCollider {
    return { shape: 'box', center: new THREE.Vector2(x, z), halfSize: new THREE.Vector2(halfWidth, halfLength), label, restitution }
  }
}

