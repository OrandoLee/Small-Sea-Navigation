import * as THREE from 'three'
import type { ModuleDefinition, PlacedModule } from './ModuleDefinition'
import { MODULE_DEFINITIONS } from './ModuleTypes'

const sharedBox = new THREE.BoxGeometry(0.92, 0.92, 0.92)
const cannonBaseGeo = new THREE.BoxGeometry(0.82, 0.24, 0.58)
const cannonCarriageGeo = new THREE.BoxGeometry(0.7, 0.16, 0.42)
const cannonAxleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.86, 12)
const cannonWheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 20)
const cannonBarrelGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.02, 24)
const cannonMuzzleGeo = new THREE.CylinderGeometry(0.19, 0.17, 0.14, 24)
const cannonBoreGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.018, 18)
const cannonBandGeo = new THREE.TorusGeometry(0.145, 0.018, 8, 24)
const cannonSightGeo = new THREE.ConeGeometry(0.1, 0.28, 4)
const cannonDirectionGeo = new THREE.ConeGeometry(0.12, 0.32, 18)
const cannonDirectionLineGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 12)
const rudderShaftGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.96, 18)
const rudderTillerGeo = new THREE.BoxGeometry(0.54, 0.07, 0.12)
const rudderPinGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.34, 14)
const rudderBladeGeo = createRudderBladeGeometry()

const materialCache = new Map<string, THREE.MeshStandardMaterial>()
const cannonWoodMaterial = new THREE.MeshStandardMaterial({ color: '#5a3821', roughness: 0.78, metalness: 0.05 })
const cannonDarkMaterial = new THREE.MeshStandardMaterial({ color: '#15191d', roughness: 0.42, metalness: 0.72 })
const cannonBoreMaterial = new THREE.MeshBasicMaterial({ color: '#050607' })
const cannonSightMaterial = new THREE.MeshBasicMaterial({ color: '#ffdf5a' })
const cannonDirectionMaterial = new THREE.MeshBasicMaterial({ color: '#ff6b2b', transparent: true, opacity: 0.88, depthWrite: false })

function materialFor(def: ModuleDefinition): THREE.MeshStandardMaterial {
  const key = `${def.type}-${def.color}-${def.emissive ?? ''}`
  const cached = materialCache.get(key)
  if (cached) return cached

  const material = new THREE.MeshStandardMaterial({
    color: def.color,
    emissive: def.emissive ?? '#000000',
    emissiveIntensity: def.emissive ? 0.35 : 0,
    metalness: def.type === 'metal' || def.type === 'engine' || def.type === 'cannon' ? 0.62 : 0.08,
    roughness: def.type === 'wood' || def.type === 'cargo' ? 0.82 : 0.48,
  })
  materialCache.set(key, material)
  return material
}

function createRudderBladeGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-0.22, 0.38)
  shape.lineTo(0.2, 0.3)
  shape.lineTo(0.28, -0.28)
  shape.quadraticCurveTo(0.04, -0.48, -0.18, -0.36)
  shape.lineTo(-0.26, 0.2)
  shape.quadraticCurveTo(-0.26, 0.34, -0.22, 0.38)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: true,
    bevelSize: 0.015,
    bevelThickness: 0.012,
    bevelSegments: 2,
  })
  geometry.translate(0, 0, -0.05)
  return geometry
}

export function createModuleMesh(module: PlacedModule): THREE.Group {
  const def = MODULE_DEFINITIONS[module.type]
  const group = new THREE.Group()
  group.name = `module-${module.id}`
  group.userData.moduleId = module.id

  const coreGeometry = module.type === 'cannon' ? cannonBaseGeo : sharedBox
  const coreMaterial = module.type === 'cannon' ? cannonWoodMaterial : materialFor(def)
  const core = new THREE.Mesh(coreGeometry, coreMaterial)
  core.castShadow = true
  core.receiveShadow = true
  if (module.type === 'cannon') core.position.y = -0.24
  group.add(core)

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(coreGeometry),
    new THREE.LineBasicMaterial({ color: module.type === 'buoyancy' ? '#c7f5ff' : '#d8e6ff', transparent: true, opacity: 0.26 }),
  )
  if (module.type === 'cannon') edge.position.copy(core.position)
  group.add(edge)

  if (module.type === 'engine') {
    const glow = new THREE.Mesh(
      new THREE.BoxGeometry(0.64, 0.18, 0.08),
      new THREE.MeshBasicMaterial({ color: '#58baff' }),
    )
    glow.position.set(0, 0, 0.48)
    group.add(glow)
  }

  if (module.type === 'rudder') {
    const rudderPivot = new THREE.Group()
    rudderPivot.name = 'rudder-pivot'
    rudderPivot.userData.rudderPivot = true
    rudderPivot.position.set(0, -0.03, 0.5)

    const shaft = new THREE.Mesh(rudderShaftGeo, materialFor(def))
    shaft.castShadow = true
    shaft.receiveShadow = true
    rudderPivot.add(shaft)

    const blade = new THREE.Mesh(rudderBladeGeo, materialFor(def))
    blade.position.set(0, -0.08, 0.12)
    blade.castShadow = true
    blade.receiveShadow = true
    rudderPivot.add(blade)

    const tiller = new THREE.Mesh(rudderTillerGeo, materialFor(def))
    tiller.position.set(0, 0.43, -0.08)
    tiller.castShadow = true
    rudderPivot.add(tiller)

    const lowerPin = new THREE.Mesh(rudderPinGeo, materialFor(def))
    lowerPin.rotation.z = Math.PI / 2
    lowerPin.position.set(0, -0.28, -0.04)
    lowerPin.castShadow = true
    rudderPivot.add(lowerPin)

    group.add(rudderPivot)
  }

  if (module.type === 'cannon') {
    const carriage = new THREE.Mesh(cannonCarriageGeo, cannonWoodMaterial)
    carriage.position.y = -0.04
    carriage.castShadow = true
    carriage.receiveShadow = true
    group.add(carriage)

    const axle = new THREE.Mesh(cannonAxleGeo, cannonDarkMaterial)
    axle.rotation.z = Math.PI / 2
    axle.position.y = -0.08
    axle.castShadow = true
    group.add(axle)

    ;[-0.43, 0.43].forEach((x) => {
      const wheel = new THREE.Mesh(cannonWheelGeo, cannonWoodMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, -0.08, 0)
      wheel.castShadow = true
      wheel.receiveShadow = true
      group.add(wheel)
    })

    const barrel = new THREE.Mesh(cannonBarrelGeo, cannonDarkMaterial)
    barrel.rotation.z = Math.PI / 2
    barrel.position.set(0.08, 0.2, 0)
    barrel.castShadow = true
    barrel.receiveShadow = true
    group.add(barrel)

    const muzzle = new THREE.Mesh(cannonMuzzleGeo, cannonDarkMaterial)
    muzzle.rotation.z = Math.PI / 2
    muzzle.position.set(0.62, 0.2, 0)
    muzzle.castShadow = true
    group.add(muzzle)

    const bore = new THREE.Mesh(cannonBoreGeo, cannonBoreMaterial)
    bore.rotation.z = Math.PI / 2
    bore.position.set(0.695, 0.2, 0)
    group.add(bore)

    ;[-0.16, 0.24].forEach((x) => {
      const band = new THREE.Mesh(cannonBandGeo, cannonDarkMaterial)
      band.rotation.y = Math.PI / 2
      band.position.set(x, 0.2, 0)
      group.add(band)
    })

    const frontSight = new THREE.Mesh(cannonSightGeo, cannonSightMaterial)
    frontSight.rotation.z = -Math.PI / 2
    frontSight.position.set(0.6, 0.38, 0)
    frontSight.userData.hideInTestMode = true
    group.add(frontSight)

    const directionLine = new THREE.Mesh(cannonDirectionLineGeo, cannonDirectionMaterial)
    directionLine.rotation.z = Math.PI / 2
    directionLine.position.set(0.96, 0.2, 0)
    directionLine.userData.cannonDirectionMarker = true
    directionLine.userData.hideInTestMode = true
    group.add(directionLine)

    const directionArrow = new THREE.Mesh(cannonDirectionGeo, cannonDirectionMaterial)
    directionArrow.rotation.z = -Math.PI / 2
    directionArrow.position.set(1.28, 0.2, 0)
    directionArrow.userData.cannonDirectionMarker = true
    directionArrow.userData.hideInTestMode = true
    group.add(directionArrow)
  }

  if (module.type === 'cargo') {
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.98, 0.08, 0.14),
      new THREE.MeshStandardMaterial({ color: '#2b1c12', roughness: 0.9 }),
    )
    strap.position.y = 0.3
    group.add(strap)
  }

  group.rotation.y = module.rotation
  return group
}

