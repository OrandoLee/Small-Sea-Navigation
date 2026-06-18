import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { ShipBlueprint, type StructuralAnalysis } from '../build/ShipBlueprint'
import { MODULE_DEFINITIONS, MODULE_ORDER } from '../modules/ModuleTypes'
import type { GridPosition, ModuleType, PlacedModule } from '../modules/ModuleDefinition'
import { createModuleMesh } from '../modules/ModuleMeshFactory'
import { analyzeStats } from '../physics/StabilityAnalyzer'
import { SEA_STATE_LABELS, SeaState, WaveField } from '../physics/WaveField'
import { RuntimeFrame, ShipControls, ShipRigidBody } from '../physics/ShipRigidBody'
import { SeaMap } from '../navigation/SeaMap'
import { VoyageRecorder, type VoyageRecord } from '../navigation/VoyageRecorder'
import { VoyageReportGenerator } from '../navigation/VoyageReportGenerator'
import { WakeSystem } from '../water/WakeSystem'

type AppMode = 'start' | 'build' | 'test' | 'report'

type PointerDownState = {
  pointerId: number
  button: number
  startX: number
  startY: number
  dragged: boolean
}

type ModuleHit = {
  id: string
  gridPosition: GridPosition
  normal: THREE.Vector3
}

type PointerTarget = {
  id: string
  gridPosition: GridPosition
  occupied: boolean
}

const DRAG_THRESHOLD_PX = 6

type BuildArea = {
  width: number
  height: number
  length: number
}

type DetachedModuleVisual = {
  mesh: THREE.Object3D
  velocity: THREE.Vector3
  angularVelocity: THREE.Vector3
}

type CannonProjectile = {
  slot: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  rotationX: number
  rotationZ: number
  age: number
}

const DEFAULT_BUILD_AREA: BuildArea = {
  width: 5,
  height: 4,
  length: 7,
}

const CANNON_MUZZLE_LOCAL = new THREE.Vector3(0.82, 0.2, 0)
const CANNON_FORWARD_LOCAL = new THREE.Vector3(1, 0, 0)
const CANNON_COOLDOWN_SECONDS = 0.45
const CANNON_PROJECTILE_SPEED = 8.6
const CANNON_PROJECTILE_LIFE = 3.2
const CANNON_PROJECTILE_MAX_INSTANCES = 768
const CANNON_PROJECTILE_GEOMETRY = new THREE.SphereGeometry(0.095, 12, 12)
const CANNON_PROJECTILE_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#1a1714',
  emissive: '#ff8a2a',
  emissiveIntensity: 0.65,
  metalness: 0.55,
  roughness: 0.36,
})

export class Lab04App {
  private readonly embed = new URLSearchParams(window.location.search).get('embed') === '1'
  private readonly blueprint = new ShipBlueprint()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly buildPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly waveField = new WaveField()
  private readonly clock = new THREE.Clock()
  private readonly seaMap = new SeaMap()
  private readonly voyageRecorder = new VoyageRecorder()
  private readonly voyageReportGenerator = new VoyageReportGenerator()
  private readonly wakeSystem = new WakeSystem()

  private renderer!: THREE.WebGLRenderer
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private controls!: OrbitControls
  private canvasWrap!: HTMLDivElement
  private startScreen!: HTMLDivElement
  private hud!: HTMLDivElement
  private palette!: HTMLDivElement
  private rangePanel!: HTMLDivElement
  private reportPanel!: HTMLDivElement
  private activation!: HTMLButtonElement
  private launchButton!: HTMLButtonElement
  private rootEl!: HTMLDivElement
  private waterMesh!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshPhysicalMaterial>
  private shipGroup = new THREE.Group()
  private gridGroup = new THREE.Group()
  private helperGroup = new THREE.Group()
  private mapGroup = new THREE.Group()
  private hoverCube!: THREE.Mesh
  private selectedOutline!: THREE.LineSegments
  private comMarker!: THREE.Mesh
  private cobMarker!: THREE.Mesh
  private moduleMeshes = new Map<string, THREE.Object3D>()
  private selectedType: ModuleType = 'wood'
  private selectedModuleId: string | null = null
  private selectedCell: GridPosition | null = null
  private buildArea: BuildArea = { ...DEFAULT_BUILD_AREA }
  private currentRotation = 0
  private hoveredCell: GridPosition | null = null
  private launchWarningUntil = 0
  private mode: AppMode = 'start'
  private active = false
  private paused = false
  private shipBody: ShipRigidBody | null = null
  private lastFrame: RuntimeFrame | null = null
  private pointerDownState: PointerDownState | null = null
  private pressedKeys = new Set<string>()
  private detachedVisuals = new Map<string, DetachedModuleVisual>()
  private projectiles: CannonProjectile[] = []
  private projectilePool: CannonProjectile[] = []
  private projectileRecycleCursor = 0
  private projectileWasRecycled = false
  private projectileMesh!: THREE.InstancedMesh
  private lastCannonFireTime = -Infinity
  private animationHandle = 0
  private waterUpdateAccumulator = 0
  private voyageRecord: VoyageRecord | null = null
  private navigationStatus = 'Sailing / 航行中'
  private shallowTime = 0
  private reefCooldown = 0
  private groundedActive = false
  private voyageCompleted = false
  private readonly cannonMuzzleScratch = new THREE.Vector3()
  private readonly cannonDirectionScratch = new THREE.Vector3()
  private readonly cannonQuaternionScratch = new THREE.Quaternion()
  private readonly controlsTargetScratch = new THREE.Vector3()
  private readonly projectileMatrixScratch = new THREE.Object3D()

  constructor(private readonly root: HTMLDivElement) {}

  start(): void {
    this.root.className = `lab-root ${this.embed ? 'is-embed' : ''}`
    this.root.innerHTML = this.renderShell()
    this.rootEl = this.root.querySelector('.lab-root-inner')!
    this.canvasWrap = this.root.querySelector('.canvas-wrap')!
    this.startScreen = this.root.querySelector('.start-screen')!
    this.hud = this.root.querySelector('.hud')!
    this.palette = this.root.querySelector('.module-palette')!
    this.rangePanel = this.root.querySelector('.range-panel')!
    this.reportPanel = this.root.querySelector('.report-panel')!
    this.activation = this.root.querySelector('.activation-overlay')!
    this.launchButton = this.root.querySelector('[data-action="launch"]')!

    this.setupScene()
    this.bindUi()
    this.seedBlueprint()
    this.updateAllUi()
    this.animate()

    window.parent?.postMessage({ type: 'LAB04_READY' }, '*')
  }

  private renderShell(): string {
    return `
      <div class="lab-root-inner" tabindex="0">
        <div class="intro-logo" aria-hidden="true">
          <img src="./lab.svg" alt="" />
        </div>

        <section class="start-screen" aria-label="LAB 04 开始界面">
          <div class="start-grid" aria-hidden="true">
            ${Array.from({ length: 12 }).map((_, i) => `<span style="--i:${i}"></span>`).join('')}
          </div>
          <p class="experiment-id">实验编号 / 004</p>
          <div class="start-copy">
            <p class="present">DELEE LAB 呈现</p>
            <h1>SMALL SEA NAVIGATION</h1>
            <p class="lab-outline">LAB-04</p>
            <div class="start-rule"></div>
            <div class="directive">
              <span>行动指令</span>
              <strong>造船后下水，驾驶到远方岛屿。</strong>
            </div>
            <button class="start-button primary" data-action="enter-lab">
              <span>开始行动</span><b>-></b>
            </button>
            <button class="start-button" data-action="toggle-guide">
              <span>玩法说明</span><b>-></b>
            </button>
          </div>
          <aside class="start-guide" aria-label="玩法说明">
            <div class="panel-heading">
              <p>玩法说明 / HOW TO PLAY</p>
              <h3>建造 -> 下水 -> 航行 -> 抵达</h3>
            </div>
            <ol>
              <li><strong>选择模块</strong><span>从模块栏选择船体、浮力、压载、引擎、货物等模块。</span></li>
              <li><strong>搭建船体</strong><span>左键放置模块，右键或 Delete 删除，R 旋转，C 清空蓝图。</span></li>
              <li><strong>下水航行</strong><span>点击 Launch，使用 WASD 驾驶；鼠标拖动观察，滚轮调整距离。</span></li>
              <li><strong>抵达岛屿</strong><span>沿浮标绕开浅滩与礁石，在目标光环中低速靠岸。</span></li>
            </ol>
            <div class="guide-actions">
              <button data-action="enter-lab">开始建造</button>
              <button data-action="close-guide">关闭说明</button>
            </div>
          </aside>
        </section>

        <main class="lab-stage" aria-label="LAB 04 小海域航行实验">
          <div class="canvas-wrap"></div>

          <header class="topbar">
            <div>
              <p>LAB 04 / 小海域航行</p>
              <h2>Small Sea Navigation</h2>
            </div>
            <div class="topbar-actions">
              <button data-action="back-start" title="返回开始界面">开始界面</button>
              <button data-action="clear" title="清空蓝图">清空</button>
              <button data-action="launch" title="下水航行">Launch</button>
              <button data-action="report" title="结束航行并生成报告">航行报告</button>
            </div>
          </header>

          <aside class="module-palette" aria-label="模块栏"></aside>
          <aside class="range-panel" aria-label="建造范围"></aside>
          <aside class="hud" aria-live="polite"></aside>

          <div class="sea-switch" aria-label="海况选择">
            <button data-sea="calm">平静</button>
            <button data-sea="wave" class="is-active">小浪</button>
            <button data-sea="storm">风暴</button>
          </div>

          <div class="dock-actions">
            <button data-action="back-dock">返回船坞</button>
            <button data-action="reset-test">重新出航</button>
          </div>

          <section class="report-panel" aria-label="诊断报告"></section>

          <button class="activation-overlay">
            <span>Click to activate Small Sea Navigation</span>
            <small>点击进入小海域航行</small>
          </button>
        </main>
      </div>
    `
  }

  private setupScene(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.canvasWrap.clientWidth, this.canvasWrap.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.canvasWrap.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#05070a')
    this.scene.fog = new THREE.Fog('#07131b', 70, 260)

    this.camera = new THREE.PerspectiveCamera(46, this.aspect(), 0.1, 420)
    this.camera.position.set(5.8, 5.2, 7.5)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.target.set(0, 0.8, 0)
    this.controls.maxPolarAngle = Math.PI * 0.46
    this.controls.minDistance = 4
    this.controls.maxDistance = 22

    this.scene.add(new THREE.AmbientLight('#9fb6ca', 0.34))
    const key = new THREE.DirectionalLight('#d9f4ff', 2.3)
    key.position.set(6, 8, 5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight('#4aa7ff', 1.25)
    rim.position.set(-6, 3, -5)
    this.scene.add(rim)

    this.createDock()
    this.createWater()
    this.createHelpers()
    this.createProjectileRenderer()
    this.mapGroup = this.seaMap.createVisuals()
    this.mapGroup.visible = false
    this.scene.add(this.mapGroup, this.wakeSystem.group)

    this.scene.add(this.gridGroup, this.shipGroup, this.helperGroup)
    this.waterMesh.visible = false
    this.prewarmProjectileMaterial()

    window.addEventListener('resize', this.onResize)
    document.addEventListener('visibilitychange', () => {
      this.paused = document.hidden
    })
  }

  private createDock(): void {
    this.gridGroup.clear()
    const minX = this.minBuildX()
    const maxX = this.maxBuildX()
    const minZ = this.minBuildZ()
    const maxZ = this.maxBuildZ()
    const width = this.buildArea.width
    const length = this.buildArea.length

    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(width + 5.2, 0.12, length + 5.5),
      new THREE.MeshStandardMaterial({
        color: '#071018',
        metalness: 0.24,
        roughness: 0.68,
      }),
    )
    floor.position.y = -0.1
    floor.receiveShadow = true
    this.gridGroup.add(floor)

    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.3, 0.05, length + 0.3),
      new THREE.MeshStandardMaterial({ color: '#0b2538', emissive: '#00284a', emissiveIntensity: 0.18, transparent: true, opacity: 0.42 }),
    )
    pad.position.y = 0.02
    this.gridGroup.add(pad)

    const grid = new THREE.LineSegments(
      this.createBuildGridGeometry(minX, maxX, minZ, maxZ),
      new THREE.LineBasicMaterial({ color: '#73d7ff', transparent: true, opacity: 0.72 }),
    )
    grid.position.y = 0.075
    this.gridGroup.add(grid)
  }

  private createBuildGridGeometry(minX: number, maxX: number, minZ: number, maxZ: number): THREE.BufferGeometry {
    const points: THREE.Vector3[] = []
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const left = x - 0.5
        const right = x + 0.5
        const front = z - 0.5
        const back = z + 0.5
        points.push(
          new THREE.Vector3(left, 0, front), new THREE.Vector3(right, 0, front),
          new THREE.Vector3(right, 0, front), new THREE.Vector3(right, 0, back),
          new THREE.Vector3(right, 0, back), new THREE.Vector3(left, 0, back),
          new THREE.Vector3(left, 0, back), new THREE.Vector3(left, 0, front),
        )
      }
    }
    return new THREE.BufferGeometry().setFromPoints(points)
  }

  private createWater(): void {
    const geo = new THREE.PlaneGeometry(220, 280, 48, 48)
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#1da7c7',
      emissive: '#003b56',
      emissiveIntensity: 0.12,
      metalness: 0,
      roughness: 0.18,
      transmission: 0.16,
      transparent: true,
      opacity: 0.72,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      side: THREE.DoubleSide,
    })
    this.waterMesh = new THREE.Mesh(geo, mat)
    this.waterMesh.rotation.x = -Math.PI / 2
    this.waterMesh.position.y = 0
    this.waterMesh.receiveShadow = true
    this.scene.add(this.waterMesh)

    const pool = new THREE.Mesh(
      new THREE.BoxGeometry(222, 0.18, 282),
      new THREE.MeshStandardMaterial({ color: '#061018', roughness: 0.7, metalness: 0.4 }),
    )
    pool.position.y = -0.38
    pool.receiveShadow = true
    pool.visible = false
    pool.name = 'pool-base'
    this.scene.add(pool)
  }

  private createHelpers(): void {
    this.hoverCube = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.94, 0.94),
      new THREE.MeshBasicMaterial({ color: '#8ee8ff', transparent: true, opacity: 0.22, depthWrite: false }),
    )
    this.hoverCube.visible = false
    this.scene.add(this.hoverCube)

    this.selectedOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.08, 1.08, 1.08)),
      new THREE.LineBasicMaterial({ color: '#ffe36a', transparent: true, opacity: 0.95 }),
    )
    this.selectedOutline.visible = false
    this.scene.add(this.selectedOutline)

    this.comMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 18, 18),
      new THREE.MeshBasicMaterial({ color: '#ffdd66' }),
    )
    this.cobMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 18, 18),
      new THREE.MeshBasicMaterial({ color: '#79e8ff' }),
    )
    this.helperGroup.add(this.comMarker, this.cobMarker)
  }

  private createProjectileRenderer(): void {
    this.projectileMesh = new THREE.InstancedMesh(
      CANNON_PROJECTILE_GEOMETRY,
      CANNON_PROJECTILE_MATERIAL,
      CANNON_PROJECTILE_MAX_INSTANCES,
    )
    this.projectileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.projectileMesh.frustumCulled = false
    this.projectileMesh.castShadow = false
    this.scene.add(this.projectileMesh)

    for (let i = 0; i < CANNON_PROJECTILE_MAX_INSTANCES; i += 1) {
      this.hideProjectileSlot(i)
      this.projectilePool.push({
        slot: i,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        rotationX: 0,
        rotationZ: 0,
        age: 0,
      })
    }
    this.projectileMesh.instanceMatrix.needsUpdate = true
  }

  private prewarmProjectileMaterial(): void {
    this.renderer.compile(this.scene, this.camera)
  }

  private bindUi(): void {
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const actionEl = target.closest<HTMLElement>('[data-action]')
      if (!actionEl) return
      const action = actionEl.dataset.action
      if (action === 'enter-lab') this.enterBuildMode()
      if (action === 'toggle-guide') this.root.classList.toggle('is-guide-open')
      if (action === 'close-guide') this.root.classList.remove('is-guide-open')
      if (action === 'back-start') this.showStart()
      if (action === 'clear') this.clearBlueprint()
      if (action === 'launch') this.launch()
      if (action === 'report') this.showReport()
      if (action === 'back-dock') this.enterBuildMode()
      if (action === 'reset-test') this.resetTest()
    })

    this.root.addEventListener('click', (event) => {
      const typeButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-module]')
      if (!typeButton) return
      this.selectedType = typeButton.dataset.module as ModuleType
      this.updatePalette()
    })

    this.root.addEventListener('click', (event) => {
      const seaButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-sea]')
      if (!seaButton) return
      this.waveField.seaState = seaButton.dataset.sea as SeaState
      this.root.querySelectorAll('[data-sea]').forEach((button) => button.classList.toggle('is-active', button === seaButton))
    })

    this.root.addEventListener('input', (event) => {
      const rangeInput = (event.target as HTMLElement).closest<HTMLInputElement>('[data-range]')
      if (!rangeInput) return
      this.setBuildArea(rangeInput.dataset.range as keyof BuildArea, Number(rangeInput.value))
    })

    this.activation.addEventListener('click', () => {
      this.active = true
      this.activation.classList.add('is-hidden')
      this.rootEl.focus()
    })

    this.renderer?.domElement.addEventListener('pointermove', this.onPointerMove)
    this.renderer?.domElement.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerCancel)
    this.renderer?.domElement.addEventListener('contextmenu', (event) => event.preventDefault())
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', () => this.pressedKeys.clear())

    window.addEventListener('message', (event) => {
      const type = event.data?.type
      if (type === 'LAB04_PAUSE') this.paused = true
      if (type === 'LAB04_RESUME') this.paused = false
      if (type === 'LAB04_RESET') {
        this.clearBlueprint()
        this.showStart()
      }
    })
  }

  private seedBlueprint(): void {
    const seed: Array<[ModuleType, GridPosition]> = [
      ['buoyancy', { x: -1, y: 0, z: -1 }],
      ['wood', { x: 0, y: 0, z: -1 }],
      ['buoyancy', { x: 1, y: 0, z: -1 }],
      ['wood', { x: -1, y: 0, z: 0 }],
      ['ballast', { x: 0, y: 0, z: 0 }],
      ['wood', { x: 1, y: 0, z: 0 }],
      ['wood', { x: -1, y: 0, z: 1 }],
      ['wood', { x: 0, y: 0, z: 1 }],
      ['wood', { x: 1, y: 0, z: 1 }],
      ['engine', { x: 0, y: 0, z: 2 }],
      ['rudder', { x: 0, y: 1, z: 2 }],
    ]
    seed.forEach(([type, position]) => {
      const module = this.blueprint.addModule(type, position, 0)
      if (module) this.addModuleToScene(module)
    })
  }

  private enterBuildMode(): void {
    this.mode = 'build'
    this.restoreDetachedModules()
    this.clearProjectiles()
    this.root.classList.remove('is-guide-open')
    this.shipBody = null
    this.lastFrame = null
    this.pressedKeys.clear()
    this.startScreen.classList.add('is-hidden')
    this.root.classList.add('is-running')
    this.root.classList.remove('is-testing', 'is-reporting')
    this.gridGroup.visible = true
    this.waterMesh.visible = false
    this.mapGroup.visible = false
    this.wakeSystem.clear()
    this.hoverCube.visible = true
    this.setTestingVisuals(false)
    this.reportPanel.classList.remove('is-visible')
    this.updateSelectionHelper()
    this.updateRudderVisuals(1, 0)
    this.shipGroup.position.set(0, 0, 0)
    this.shipGroup.rotation.set(0, 0, 0)
    this.controls.target.set(0, 0.8, 0)
    this.camera.position.set(5.8, 5.2, 7.5)
    this.updateAllUi()
  }

  private showStart(): void {
    this.mode = 'start'
    this.restoreDetachedModules()
    this.clearProjectiles()
    this.root.classList.remove('is-guide-open')
    this.startScreen.classList.remove('is-hidden')
    this.root.classList.remove('is-running', 'is-testing', 'is-reporting')
    this.setTestingVisuals(false)
    this.mapGroup.visible = false
    this.wakeSystem.clear()
  }

  private launch(): void {
    const stats = this.blueprint.getStats()
    if (stats.blocks === 0 || stats.totalBuoyancy <= 0) {
      this.flashLaunch('请先放置至少一个有浮力的模块')
      return
    }

    const structure = this.blueprint.analyzeStructure()
    if (structure.warnings.length > 0 && Date.now() > this.launchWarningUntil) {
      this.launchWarningUntil = Date.now() + 3600
      this.flashLaunch('结构有坍塌风险，再点 Launch 继续', 2600)
      return
    }

    const allModules = this.blueprint.getModules()
    const stableIdSet = new Set(structure.stableModuleIds)
    const stableModules = allModules.filter((module) => stableIdSet.has(module.id))
    const simulationModules = stableModules.length > 0 ? stableModules : allModules
    const simulationStats = this.blueprint.getStats(simulationModules)

    this.mode = 'test'
    this.root.classList.add('is-testing')
    this.root.classList.remove('is-reporting')
    this.gridGroup.visible = false
    this.waterMesh.visible = true
    this.mapGroup.visible = true
    this.hoverCube.visible = false
    this.setTestingVisuals(true)
    this.reportPanel.classList.remove('is-visible')
    this.shipBody = new ShipRigidBody(simulationStats, simulationModules, structure.unstableModuleIds.length)
    this.clearProjectiles()
    this.updateSelectionHelper(false)
    this.shipBody.reset()
    this.shipBody.position.copy(this.seaMap.start).setY(this.shipBody.position.y)
    this.shipBody.rotation.y = 0
    this.shipGroup.position.copy(this.shipBody.position)
    this.shipGroup.rotation.copy(this.shipBody.rotation)
    this.prepareDetachedModules(structure)
    this.controls.target.copy(this.shipBody.position).add(new THREE.Vector3(0, 0.8, 0))
    this.camera.position.copy(this.shipBody.position).add(new THREE.Vector3(8.5, 6.2, 12.5))
    this.voyageRecorder.start()
    this.voyageRecord = null
    this.voyageCompleted = false
    this.navigationStatus = 'Sailing / 航行中'
    this.shallowTime = 0
    this.reefCooldown = 0
    this.groundedActive = false
    this.wakeSystem.clear()
    this.wakeSystem.splash(this.shipBody.position)
    this.rootEl.focus()
    this.updateAllUi()
  }

  private resetTest(): void {
    if (this.mode !== 'test' && this.mode !== 'report') return
    this.mode = 'test'
    this.root.classList.remove('is-reporting')
    this.reportPanel.classList.remove('is-visible')
    this.pressedKeys.clear()
    this.restoreDetachedModules()
    this.clearProjectiles()
    const structure = this.blueprint.analyzeStructure()
    const allModules = this.blueprint.getModules()
    const stableIdSet = new Set(structure.stableModuleIds)
    const stableModules = allModules.filter((module) => stableIdSet.has(module.id))
    const simulationModules = stableModules.length > 0 ? stableModules : allModules
    this.shipBody = new ShipRigidBody(this.blueprint.getStats(simulationModules), simulationModules, structure.unstableModuleIds.length)
    this.shipBody.reset()
    this.shipBody.position.copy(this.seaMap.start).setY(this.shipBody.position.y)
    this.shipGroup.position.copy(this.shipBody.position)
    this.shipGroup.rotation.copy(this.shipBody.rotation)
    this.prepareDetachedModules(structure)
    this.setTestingVisuals(true)
    this.updateRudderVisuals(1, 0)
    this.lastFrame = null
    this.voyageRecorder.start()
    this.voyageRecord = null
    this.voyageCompleted = false
    this.navigationStatus = 'Sailing / 航行中'
    this.shallowTime = 0
    this.reefCooldown = 0
    this.groundedActive = false
    this.wakeSystem.clear()
    this.wakeSystem.splash(this.shipBody.position)
  }

  private showReport(completed = this.voyageCompleted): void {
    this.mode = 'report'
    this.root.classList.add('is-reporting')
    this.reportPanel.classList.add('is-visible')
    const stats = this.blueprint.getStats()
    const record = this.voyageRecord ?? this.voyageRecorder.stop(completed)
    this.voyageRecord = record
    const report = this.voyageReportGenerator.generate(record, stats)
    this.reportPanel.innerHTML = `
      <div class="panel-heading">
        <p>航行报告 / LAB 04</p>
        <h3>${report.result}</h3>
      </div>
      <div class="report-grid">
        <div><span>总用时</span><strong>${record.elapsed.toFixed(1)}s</strong></div>
        <div><span>最大速度</span><strong>${record.maxSpeed.toFixed(1)}</strong></div>
        <div><span>平均速度</span><strong>${record.averageSpeed.toFixed(1)}</strong></div>
        <div><span>抵达距离</span><strong>${record.finalDistance.toFixed(0)}m</strong></div>
        <div><span>碰撞次数</span><strong>${record.collisions}</strong></div>
        <div><span>搁浅次数</span><strong>${record.groundings}</strong></div>
        <div><span>最大横倾</span><strong>${record.maxRoll.toFixed(1)}°</strong></div>
        <div><span>稳定评分</span><strong>${analyzeStats(stats).score}</strong></div>
      </div>
      <h4>航行评价</h4>
      <p class="report-evaluation">${report.evaluation}</p>
      <h4>问题分析</h4>
      <ul>${report.issues.map((issue) => `<li>${issue}</li>`).join('')}</ul>
      <h4>改造建议</h4>
      <ul>${report.suggestions.map((suggestion) => `<li>${suggestion}</li>`).join('')}</ul>
      <div class="report-actions">
        <button data-action="back-dock">返回船坞</button>
        <button data-action="reset-test">重新出航</button>
      </div>
    `
  }

  private clearBlueprint(): void {
    this.restoreDetachedModules()
    this.clearProjectiles()
    this.launchWarningUntil = 0
    this.blueprint.clear()
    this.moduleMeshes.forEach((mesh) => this.shipGroup.remove(mesh))
    this.moduleMeshes.clear()
    this.clearSelection()
    this.updateAllUi()
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.mode !== 'build') return

    if (this.pointerDownState?.pointerId === event.pointerId) {
      const moved = Math.hypot(event.clientX - this.pointerDownState.startX, event.clientY - this.pointerDownState.startY)
      if (moved > DRAG_THRESHOLD_PX) this.pointerDownState.dragged = true
    }

    this.updatePointer(event)
    if (this.pointerDownState?.dragged) {
      this.hoveredCell = null
      this.hoverCube.visible = false
      return
    }

    const target = this.getPointerTarget()
    this.hoveredCell = target?.gridPosition ?? null
    this.hoverCube.visible = Boolean(target)
    if (target) {
      this.hoverCube.position.set(target.gridPosition.x, target.gridPosition.y + 0.5, target.gridPosition.z)
      this.setHoverStyle(target.occupied)
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.mode !== 'build') return
    this.active = true
    this.activation.classList.add('is-hidden')
    this.rootEl.focus()

    if (event.button !== 0 && event.button !== 2) return
    this.pointerDownState = {
      pointerId: event.pointerId,
      button: event.button,
      startX: event.clientX,
      startY: event.clientY,
      dragged: false,
    }
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (this.mode !== 'build' || this.pointerDownState?.pointerId !== event.pointerId) return

    const pointerState = this.pointerDownState
    this.pointerDownState = null

    const moved = Math.hypot(event.clientX - pointerState.startX, event.clientY - pointerState.startY)
    if (pointerState.dragged || moved > DRAG_THRESHOLD_PX) {
      this.updatePointer(event)
      const target = this.getPointerTarget()
      this.hoveredCell = target?.gridPosition ?? null
      this.hoverCube.visible = Boolean(target)
      if (target) {
        this.hoverCube.position.set(target.gridPosition.x, target.gridPosition.y + 0.5, target.gridPosition.z)
        this.setHoverStyle(target.occupied)
      }
      return
    }

    this.updatePointer(event)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const directModuleHit = this.intersectModule()
    if (pointerState.button === 0 && directModuleHit && this.blueprint.getAt(directModuleHit.gridPosition)?.type === 'rudder') {
      this.selectModule({ id: directModuleHit.id, gridPosition: directModuleHit.gridPosition, occupied: true })
      return
    }

    const target = this.getPointerTarget(pointerState.button === 2)
    if (!target) return

    if (pointerState.button === 2) {
      this.removeAt(target.gridPosition)
      return
    }

    if (target.occupied) {
      this.selectModule(target)
      return
    }

    const module = this.blueprint.addModule(this.selectedType, target.gridPosition, this.currentRotation)
    if (!module) return
    this.addModuleToScene(module)
    this.selectModule({ id: module.id, gridPosition: module.gridPosition, occupied: true })
    this.updateAllUi()
  }

  private onPointerCancel = (event: PointerEvent): void => {
    if (this.pointerDownState?.pointerId === event.pointerId) this.pointerDownState = null
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase()
    if (this.isShipControlKey(key)) {
      this.pressedKeys.add(key)
      if (this.mode === 'test') event.preventDefault()
    }
    if (key === 'f' && this.mode === 'test') {
      event.preventDefault()
      if (!event.repeat && this.active) this.fireCannons()
    }

    if (event.key === 'Escape') {
      this.active = false
      this.activation.classList.remove('is-hidden')
    }
    if (!this.active) return
    if (key === 'c') this.clearBlueprint()
    if (key === 'r') {
      if (this.mode === 'test') {
        this.resetNavigationView()
        return
      }
      if (this.rotateSelectedModule()) return
      this.currentRotation = this.nextQuarterTurn(this.currentRotation)
    }
    if (event.key === 'Delete') {
      if (this.selectedCell) {
        this.removeAt(this.selectedCell)
        return
      }
      if (this.hoveredCell) this.removeAt(this.hoveredCell)
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.key.toLowerCase())
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  private getPointerTarget(preferOccupied = false): PointerTarget | null {
    this.raycaster.setFromCamera(this.pointer, this.camera)

    const moduleHit = this.intersectModule()
    if (moduleHit) {
      const adjacentCell = this.adjacentCellFromHit(moduleHit)
      if (!preferOccupied && adjacentCell && !this.blueprint.getAt(adjacentCell)) {
        return { id: '', gridPosition: adjacentCell, occupied: false }
      }
      return { ...moduleHit, occupied: true }
    }

    const cell = this.intersectGridCell(preferOccupied)
    if (!cell) return null

    const module = this.blueprint.getAt(cell)
    return {
      id: module?.id ?? '',
      gridPosition: cell,
      occupied: Boolean(module),
    }
  }

  private intersectGridCell(preferOccupied = false): GridPosition | null {
    const point = new THREE.Vector3()
    if (!this.raycaster.ray.intersectPlane(this.buildPlane, point)) return null

    const x = Math.round(point.x)
    const z = Math.round(point.z)
    if (x < this.minBuildX() || x > this.maxBuildX() || z < this.minBuildZ() || z > this.maxBuildZ()) return null

    return preferOccupied ? this.topOccupiedCell(x, z) : this.nextFreeCell(x, z)
  }

  private intersectModule(): ModuleHit | null {
    const intersections = this.raycaster.intersectObjects([...this.moduleMeshes.values()], true)
    for (const intersection of intersections) {
      if (!(intersection.object instanceof THREE.Mesh)) continue
      if (intersection.object.userData.cannonDirectionMarker) continue
      const moduleHit = this.moduleHitFromObject(intersection.object)
      if (moduleHit) return { ...moduleHit, normal: this.worldNormal(intersection) }
    }
    return null
  }

  private moduleHitFromObject(object: THREE.Object3D): Omit<ModuleHit, 'normal'> | null {
    let current: THREE.Object3D | null = object
    while (current) {
      const position = current.userData.gridPosition as GridPosition | undefined
      const id = current.userData.moduleId as string | undefined
      if (position && id) return { id, gridPosition: { ...position } }
      current = current.parent
    }
    return null
  }

  private worldNormal(intersection: THREE.Intersection): THREE.Vector3 {
    if (!intersection.face) return new THREE.Vector3()
    return intersection.face.normal
      .clone()
      .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld))
      .normalize()
  }

  private adjacentCellFromHit(hit: ModuleHit): GridPosition | null {
    const { normal, gridPosition } = hit
    const cell = { ...gridPosition }
    if (normal.y > 0.55) cell.y += 1
    else if (normal.y < -0.55) cell.y -= 1
    else if (Math.abs(normal.x) >= Math.abs(normal.z)) cell.x += Math.sign(normal.x)
    else cell.z += Math.sign(normal.z)

    if (!this.isWithinBuildArea(cell)) return null
    return cell
  }

  private nextFreeCell(x: number, z: number): GridPosition | null {
    let y = 0
    for (let candidate = this.buildArea.height - 1; candidate >= 0; candidate -= 1) {
      if (this.blueprint.getAt({ x, y: candidate, z })) {
        y = Math.min(this.buildArea.height - 1, candidate + 1)
        break
      }
    }
    if (y >= this.buildArea.height) return null
    return { x, y, z }
  }

  private topOccupiedCell(x: number, z: number): GridPosition | null {
    for (let y = this.buildArea.height - 1; y >= 0; y -= 1) {
      if (this.blueprint.getAt({ x, y, z })) return { x, y, z }
    }
    return null
  }

  private isWithinBuildArea(cell: GridPosition): boolean {
    return (
      cell.x >= this.minBuildX()
      && cell.x <= this.maxBuildX()
      && cell.z >= this.minBuildZ()
      && cell.z <= this.maxBuildZ()
      && cell.y >= 0
      && cell.y < this.buildArea.height
    )
  }

  private addModuleToScene(module: PlacedModule): void {
    this.launchWarningUntil = 0
    const mesh = createModuleMesh(module)
    mesh.position.set(module.gridPosition.x, module.gridPosition.y + 0.5, module.gridPosition.z)
    mesh.traverse((object) => {
      object.userData.moduleId = module.id
      object.userData.gridPosition = { ...module.gridPosition }
    })
    this.shipGroup.add(mesh)
    this.moduleMeshes.set(module.id, mesh)
  }

  private removeAt(position: GridPosition): void {
    this.launchWarningUntil = 0
    const removed = this.blueprint.removeModule(position)
    if (!removed) return
    const mesh = this.moduleMeshes.get(removed.id)
    if (mesh) this.shipGroup.remove(mesh)
    this.moduleMeshes.delete(removed.id)
    if (this.selectedModuleId === removed.id) this.clearSelection()
    this.updateAllUi()
  }

  private prepareDetachedModules(structure: StructuralAnalysis): void {
    this.restoreDetachedModules()
    if (structure.unstableModuleIds.length === 0) return

    const unstableIds = new Set(structure.unstableModuleIds)
    const center = this.blueprint.getStats().centerOfMass
    this.shipGroup.updateMatrixWorld(true)

    this.moduleMeshes.forEach((mesh, id) => {
      if (!unstableIds.has(id)) return

      const worldPosition = new THREE.Vector3()
      const worldQuaternion = new THREE.Quaternion()
      mesh.getWorldPosition(worldPosition)
      mesh.getWorldQuaternion(worldQuaternion)
      this.shipGroup.remove(mesh)
      this.scene.add(mesh)
      mesh.position.copy(worldPosition)
      mesh.quaternion.copy(worldQuaternion)

      const module = this.blueprint.getModules().find((candidate) => candidate.id === id)
      const xPush = (module?.gridPosition.x ?? 0) - center.x
      const zPush = (module?.gridPosition.z ?? 0) - center.z
      const outward = new THREE.Vector3(xPush, 0, zPush)
      if (outward.lengthSq() < 0.01) outward.set(Math.random() - 0.5, 0, Math.random() - 0.5)
      outward.normalize()

      this.detachedVisuals.set(id, {
        mesh,
        velocity: outward.multiplyScalar(0.65).add(new THREE.Vector3(0, -0.18, 0)),
        angularVelocity: new THREE.Vector3(
          THREE.MathUtils.randFloatSpread(1.8),
          THREE.MathUtils.randFloatSpread(1.2),
          THREE.MathUtils.randFloatSpread(1.8),
        ),
      })
    })
  }

  private restoreDetachedModules(): void {
    if (this.detachedVisuals.size === 0) return

    this.detachedVisuals.forEach(({ mesh }, id) => {
      const module = this.blueprint.getModules().find((candidate) => candidate.id === id)
      if (!module) {
        this.scene.remove(mesh)
        return
      }

      if (mesh.parent) mesh.parent.remove(mesh)
      mesh.position.set(module.gridPosition.x, module.gridPosition.y + 0.5, module.gridPosition.z)
      mesh.rotation.set(0, module.rotation, 0)
      mesh.scale.set(1, 1, 1)
      this.shipGroup.add(mesh)
    })
    this.detachedVisuals.clear()
  }

  private setTestingVisuals(testing: boolean): void {
    this.helperGroup.visible = !testing
    this.moduleMeshes.forEach((mesh) => {
      mesh.traverse((object) => {
        if (object.userData.hideInTestMode || object.userData.cannonDirectionMarker) object.visible = !testing
      })
    })
  }

  private updateDetachedModules(delta: number): void {
    this.detachedVisuals.forEach((visual) => {
      visual.velocity.y -= 4.6 * delta
      visual.velocity.multiplyScalar(Math.pow(0.985, delta))
      visual.mesh.position.addScaledVector(visual.velocity, delta)
      visual.mesh.rotation.x += visual.angularVelocity.x * delta
      visual.mesh.rotation.y += visual.angularVelocity.y * delta
      visual.mesh.rotation.z += visual.angularVelocity.z * delta

      if (visual.mesh.position.y < -1.4) {
        visual.velocity.y *= -0.16
        visual.velocity.x *= 0.72
        visual.velocity.z *= 0.72
        visual.mesh.position.y = -1.4
      }
    })
  }

  private fireCannons(): void {
    if (this.mode !== 'test' || !this.shipBody) return
    if (this.waveField.time - this.lastCannonFireTime < CANNON_COOLDOWN_SECONDS) return

    const shipBody = this.shipBody
    const modules = this.blueprint.getModules()
    let fired = 0

    for (const module of modules) {
      if (module.type !== 'cannon') continue

      const mesh = this.moduleMeshes.get(module.id)
      if (!mesh || mesh.parent !== this.shipGroup) continue

      const muzzle = this.cannonMuzzleScratch.copy(CANNON_MUZZLE_LOCAL)
      mesh.localToWorld(muzzle)
      const direction = this.cannonDirectionScratch
        .copy(CANNON_FORWARD_LOCAL)
        .applyQuaternion(mesh.getWorldQuaternion(this.cannonQuaternionScratch))
        .normalize()

      const projectile = this.acquireProjectile()
      projectile.position.copy(muzzle).addScaledVector(direction, 0.14)
      projectile.velocity.copy(direction).multiplyScalar(CANNON_PROJECTILE_SPEED).add(shipBody.horizontalVelocity)
      projectile.rotationX = 0
      projectile.rotationZ = 0
      projectile.age = 0
      this.updateProjectileSlot(projectile)
      if (!this.projectileWasRecycled) this.projectiles.push(projectile)
      shipBody.horizontalVelocity.addScaledVector(direction, -0.08)
      fired += 1
    }

    if (fired > 0) {
      this.projectileMesh.instanceMatrix.needsUpdate = true
      this.lastCannonFireTime = this.waveField.time
    }
  }

  private updateProjectiles(delta: number): void {
    let changed = false
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i]
      projectile.age += delta
      projectile.velocity.y -= 2.7 * delta
      projectile.position.addScaledVector(projectile.velocity, delta)
      projectile.rotationX += 8 * delta
      projectile.rotationZ += 5 * delta

      const alive = projectile.age < CANNON_PROJECTILE_LIFE && projectile.position.y > -2.8
      if (alive) this.updateProjectileSlot(projectile)
      else this.releaseActiveProjectile(i)
      changed = true
    }
    if (changed) this.projectileMesh.instanceMatrix.needsUpdate = true
  }

  private clearProjectiles(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      this.releaseActiveProjectile(i)
    }
    this.projectileRecycleCursor = 0
    this.projectileMesh.instanceMatrix.needsUpdate = true
    this.lastCannonFireTime = -Infinity
  }

  private acquireProjectile(): CannonProjectile {
    this.projectileWasRecycled = false
    const projectile = this.projectilePool.pop()
    if (projectile) {
      return projectile
    }

    this.projectileWasRecycled = true
    const recycled = this.projectiles[this.projectileRecycleCursor]
    this.projectileRecycleCursor = (this.projectileRecycleCursor + 1) % this.projectiles.length
    return recycled
  }

  private releaseActiveProjectile(index: number): void {
    const projectile = this.projectiles[index]
    const last = this.projectiles.pop()
    if (!projectile || !last) return
    if (last !== projectile) this.projectiles[index] = last
    this.releaseProjectile(projectile)
    if (this.projectileRecycleCursor >= this.projectiles.length) this.projectileRecycleCursor = 0
  }

  private releaseProjectile(projectile: CannonProjectile): void {
    this.hideProjectileSlot(projectile.slot)
    projectile.age = 0
    projectile.position.set(0, 0, 0)
    projectile.velocity.set(0, 0, 0)
    projectile.rotationX = 0
    projectile.rotationZ = 0
    this.projectilePool.push(projectile)
  }

  private updateProjectileSlot(projectile: CannonProjectile): void {
    this.projectileMatrixScratch.position.copy(projectile.position)
    this.projectileMatrixScratch.rotation.set(projectile.rotationX, 0, projectile.rotationZ)
    this.projectileMatrixScratch.scale.setScalar(1)
    this.projectileMatrixScratch.updateMatrix()
    this.projectileMesh.setMatrixAt(projectile.slot, this.projectileMatrixScratch.matrix)
  }

  private hideProjectileSlot(slot: number): void {
    this.projectileMatrixScratch.position.set(0, -1000, 0)
    this.projectileMatrixScratch.rotation.set(0, 0, 0)
    this.projectileMatrixScratch.scale.set(0, 0, 0)
    this.projectileMatrixScratch.updateMatrix()
    this.projectileMesh.setMatrixAt(slot, this.projectileMatrixScratch.matrix)
  }

  private rotateSelectedModule(): boolean {
    if (this.mode !== 'build' || !this.selectedCell || !this.selectedModuleId) return false

    const module = this.blueprint.getAt(this.selectedCell)
    if (!module || module.id !== this.selectedModuleId) return false

    this.launchWarningUntil = 0
    module.rotation = this.nextQuarterTurn(module.rotation)
    this.currentRotation = module.rotation
    const mesh = this.moduleMeshes.get(module.id)
    if (mesh) mesh.rotation.y = module.rotation
    this.updateSelectionHelper()
    return true
  }

  private nextQuarterTurn(rotation: number): number {
    return (rotation + Math.PI / 2) % (Math.PI * 2)
  }

  private selectModule(target: PointerTarget): void {
    const module = this.blueprint.getAt(target.gridPosition)
    if (!module) return
    this.selectedModuleId = target.id
    this.selectedCell = { ...target.gridPosition }
    this.selectedType = module.type
    this.updateSelectionHelper()
    this.updateAllUi()
  }

  private clearSelection(): void {
    this.selectedModuleId = null
    this.selectedCell = null
    this.updateSelectionHelper(false)
  }

  private updateSelectionHelper(visible = this.mode === 'build'): void {
    if (!visible || !this.selectedCell || !this.selectedModuleId || !this.moduleMeshes.has(this.selectedModuleId)) {
      this.selectedOutline.visible = false
      return
    }

    this.selectedOutline.visible = true
    this.selectedOutline.position.set(this.selectedCell.x, this.selectedCell.y + 0.5, this.selectedCell.z)
  }

  private setHoverStyle(occupied: boolean): void {
    const material = this.hoverCube.material as THREE.MeshBasicMaterial
    material.color.set(occupied ? '#ffe36a' : '#8ee8ff')
    material.opacity = occupied ? 0.18 : 0.22
  }

  private setBuildArea(axis: keyof BuildArea, value: number): void {
    const next = { ...this.buildArea, [axis]: value }
    if (axis === 'width' || axis === 'length') next[axis] = this.toOddSize(value)
    next.width = THREE.MathUtils.clamp(next.width, 3, 9)
    next.length = THREE.MathUtils.clamp(next.length, 5, 11)
    next.height = THREE.MathUtils.clamp(next.height, 3, 6)
    this.buildArea = next
    this.createDock()
    this.updateRangeValues()
    this.hoveredCell = null
    this.hoverCube.visible = false
  }

  private toOddSize(value: number): number {
    const rounded = Math.round(value)
    return rounded % 2 === 0 ? rounded + 1 : rounded
  }

  private minBuildX(): number {
    return -Math.floor(this.buildArea.width / 2)
  }

  private maxBuildX(): number {
    return Math.floor(this.buildArea.width / 2)
  }

  private minBuildZ(): number {
    return -Math.floor(this.buildArea.length / 2)
  }

  private maxBuildZ(): number {
    return Math.floor(this.buildArea.length / 2)
  }

  private updateAllUi(): void {
    this.updatePalette()
    this.updateRangePanel()
    this.updateHud()
    this.updateMarkers()
  }

  private updateRangePanel(): void {
    this.rangePanel.innerHTML = `
      <div class="panel-heading">
        <p>建造范围</p>
        <h3>${this.buildArea.width} x ${this.buildArea.length} x ${this.buildArea.height}</h3>
      </div>
      <label>
        <span>宽度</span><strong data-range-value="width">${this.buildArea.width}</strong>
        <input data-range="width" type="range" min="3" max="9" step="2" value="${this.buildArea.width}" />
      </label>
      <label>
        <span>长度</span><strong data-range-value="length">${this.buildArea.length}</strong>
        <input data-range="length" type="range" min="5" max="11" step="2" value="${this.buildArea.length}" />
      </label>
      <label>
        <span>高度</span><strong data-range-value="height">${this.buildArea.height}</strong>
        <input data-range="height" type="range" min="3" max="6" step="1" value="${this.buildArea.height}" />
      </label>
    `
  }

  private updateRangeValues(): void {
    const heading = this.rangePanel.querySelector('.panel-heading h3')
    if (heading) heading.textContent = `${this.buildArea.width} x ${this.buildArea.length} x ${this.buildArea.height}`
    ;(['width', 'length', 'height'] as const).forEach((axis) => {
      const value = this.rangePanel.querySelector<HTMLElement>(`[data-range-value="${axis}"]`)
      if (value) value.textContent = String(this.buildArea[axis])
    })
  }

  private updatePalette(): void {
    this.palette.innerHTML = MODULE_ORDER.map((type) => {
      const def = MODULE_DEFINITIONS[type]
      const active = type === this.selectedType ? 'is-active' : ''
      return `
        <button class="module-card ${active}" data-module="${type}" title="${def.description}">
          <span class="swatch" style="background:${def.color}"></span>
          <strong>${def.name}</strong>
          <small>${def.description}</small>
          <em>质量 ${def.mass.toFixed(1)} / 浮力 ${def.buoyancy.toFixed(1)}</em>
          <i>${def.tags.join(' · ')}</i>
        </button>
      `
    }).join('')
  }

  private updateHud(): void {
    const stats = this.blueprint.getStats()
    const summary = analyzeStats(stats)
    const frame = this.lastFrame
    if (this.mode === 'test') {
      const speed = this.shipBody?.horizontalVelocity.length() ?? 0
      const heading = this.shipBody ? ((THREE.MathUtils.radToDeg(this.shipBody.rotation.y) % 360) + 360) % 360 : 0
      const distance = this.shipBody ? this.seaMap.getDistanceToIsland(this.shipBody.position) : 160
      const throttle = (this.pressedKeys.has('w') ? 100 : 0) - (this.pressedKeys.has('s') ? 100 : 0)
      const liveRecord = this.voyageRecorder.snapshot(false)
      this.hud.innerHTML = `
        <div class="panel-heading">
          <p>航行状态 / NAVIGATION</p>
          <h3>${this.navigationStatus}</h3>
        </div>
        <dl>
          <div><dt>Speed / 船速</dt><dd>${speed.toFixed(1)} kn</dd></div>
          <div><dt>Throttle / 推力</dt><dd>${throttle}%</dd></div>
          <div><dt>Heading / 航向</dt><dd>${heading.toFixed(0)}°</dd></div>
          <div><dt>Distance / 距离岛屿</dt><dd>${distance.toFixed(0)} m</dd></div>
          <div><dt>Stability / 稳定性</dt><dd>${summary.score}</dd></div>
          <div><dt>Draft / 吃水</dt><dd>${stats.estimatedDraft.toFixed(2)} m</dd></div>
          <div><dt>Collisions / 碰撞</dt><dd>${liveRecord.collisions}</dd></div>
          <div><dt>Groundings / 搁浅</dt><dd>${liveRecord.groundings}</dd></div>
        </dl>
        <div class="warnings"><span>WASD 驾驶 · 鼠标环绕 · 滚轮缩放 · R 重置视角</span></div>
      `
      return
    }
    this.hud.innerHTML = `
      <div class="panel-heading">
        <p>建造统计 / 蓝图</p>
        <h3>${summary.status}</h3>
      </div>
      <dl>
        <div><dt>模块数量</dt><dd>${stats.blocks}</dd></div>
        <div><dt>总质量</dt><dd>${stats.totalMass.toFixed(1)}</dd></div>
        <div><dt>总浮力</dt><dd>${stats.totalBuoyancy.toFixed(1)}</dd></div>
        <div><dt>浮力余量</dt><dd>${stats.buoyancyMargin.toFixed(1)}</dd></div>
        <div><dt>吃水深度</dt><dd>${stats.estimatedDraft.toFixed(2)}</dd></div>
        <div><dt>横摇角</dt><dd>${(frame?.roll ?? 0).toFixed(1)}°</dd></div>
        <div><dt>纵摇角</dt><dd>${(frame?.pitch ?? 0).toFixed(1)}°</dd></div>
        <div><dt>最大横摇</dt><dd>${(frame?.maxRoll ?? 0).toFixed(1)}°</dd></div>
        <div><dt>最大纵摇</dt><dd>${(frame?.maxPitch ?? 0).toFixed(1)}°</dd></div>
        <div><dt>上层重量</dt><dd>${(stats.topWeightRatio * 100).toFixed(0)}%</dd></div>
        <div><dt>稳定评分</dt><dd>${summary.score}</dd></div>
      </dl>
      <div class="warnings">
        ${summary.warnings.slice(0, 3).map((warning) => `<span>${warning}</span>`).join('') || '<span>当前设计可以进入下水测试。</span>'}
      </div>
    `
  }

  private updateMarkers(): void {
    const stats = this.blueprint.getStats()
    this.comMarker.visible = stats.blocks > 0
    this.cobMarker.visible = stats.blocks > 0
    this.comMarker.position.set(stats.centerOfMass.x, stats.centerOfMass.y + 0.5, stats.centerOfMass.z)
    this.cobMarker.position.set(stats.estimatedCenterOfBuoyancy.x, stats.estimatedCenterOfBuoyancy.y + 0.2, stats.estimatedCenterOfBuoyancy.z)
  }

  private updateWaterGeometry(): void {
    const position = this.waterMesh.geometry.attributes.position
    const vertex = new THREE.Vector3()
    for (let i = 0; i < position.count; i += 1) {
      vertex.fromBufferAttribute(position, i)
      position.setZ(i, this.waveField.heightAt(vertex.x, -vertex.y))
    }
    position.needsUpdate = true
    this.waterMesh.geometry.computeVertexNormals()
  }

  private resetNavigationView(): void {
    if (!this.shipBody) return
    this.controls.target.copy(this.shipBody.position).add(new THREE.Vector3(0, 0.7, 0))
    const behind = new THREE.Vector3(0, 5.8, 13).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.shipBody.rotation.y)
    this.camera.position.copy(this.shipBody.position).add(behind)
  }

  private updateNavigation(delta: number): void {
    if (!this.shipBody || !this.lastFrame) return
    const stats = this.blueprint.getStats()
    const speed = this.shipBody.horizontalVelocity.length()
    const distance = this.seaMap.getDistanceToIsland(this.shipBody.position)
    const depth = this.seaMap.getDepthAt(this.shipBody.position.x, this.shipBody.position.z)
    const isShallow = depth < Math.max(1.1, stats.estimatedDraft + 0.18)

    this.navigationStatus = speed < 0.45 ? 'Low Speed / 低速' : 'Sailing / 航行中'
    if (distance < 24) this.navigationStatus = 'Near Island / 接近岛屿'

    if (isShallow) {
      this.shallowTime += delta
      this.shipBody.horizontalVelocity.multiplyScalar(Math.pow(0.13, delta))
      this.navigationStatus = this.shallowTime > 2.4 ? 'Grounded / 搁浅' : 'Shallow Water / 浅水'
      if (this.shallowTime > 2.4 && !this.groundedActive) {
        this.voyageRecorder.markGrounding()
        this.groundedActive = true
      }
    } else {
      this.shallowTime = 0
      this.groundedActive = false
    }

    this.reefCooldown = Math.max(0, this.reefCooldown - delta)
    const collision = this.seaMap.checkCollision(this.shipBody.position, this.shipBody.getCollisionRadius())
    if (collision) {
      this.shipBody.position.addScaledVector(collision.normal, collision.penetration + 0.12)
      const impactSpeed = -this.shipBody.horizontalVelocity.dot(collision.normal)
      if (impactSpeed > 0) {
        this.shipBody.horizontalVelocity.addScaledVector(
          collision.normal,
          impactSpeed * (1 + collision.restitution),
        )
      }
      this.shipBody.horizontalVelocity.multiplyScalar(0.42)
      this.shipBody.angularVelocity += (Math.random() - 0.5) * 0.8
      this.navigationStatus = `${collision.label} / 船体撞击`
      if (this.reefCooldown <= 0) {
        this.voyageRecorder.markCollision()
        this.reefCooldown = 1.2
      }
    }

    this.voyageRecorder.record(delta, { speed, distance, roll: this.lastFrame.roll })
    this.wakeSystem.spawn(this.shipBody.position, speed)
    this.wakeSystem.update(delta)

    if (!this.voyageCompleted && distance < 8 && speed < 3.2) {
      this.voyageCompleted = true
      this.navigationStatus = 'Voyage Complete / 航行完成'
      this.voyageRecord = this.voyageRecorder.stop(true)
      this.updateHud()
      this.showReport(true)
    }
  }

  private animate = (): void => {
    this.animationHandle = window.requestAnimationFrame(this.animate)
    const delta = Math.min(this.clock.getDelta(), 0.05)
    if (this.paused) return

    this.waveField.update(delta)
    this.waterUpdateAccumulator += delta
    if (this.waterMesh.visible && this.waterUpdateAccumulator >= 0.05) {
      this.updateWaterGeometry()
      this.waterUpdateAccumulator = 0
    }
    this.updateProjectiles(delta)

    if (this.mode === 'test' && this.shipBody) {
      const shipControls = this.getShipControls()
      this.lastFrame = this.shipBody.update(delta, this.waveField, shipControls)
      this.shipGroup.position.copy(this.shipBody.position)
      this.shipGroup.rotation.copy(this.shipBody.rotation)
      this.updateNavigation(delta)
      this.updateDetachedModules(delta)
      this.controlsTargetScratch.set(this.shipGroup.position.x, this.shipGroup.position.y + 0.45, this.shipGroup.position.z)
      const followShift = this.controlsTargetScratch.clone().sub(this.controls.target).multiplyScalar(0.11)
      this.controls.target.add(followShift)
      this.camera.position.add(followShift)
      this.updateRudderVisuals(delta, shipControls.turn)
      this.updateMarkers()
      if (Math.floor(this.waveField.time * 6) % 3 === 0) this.updateHud()
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private flashLaunch(message: string, duration = 1400): void {
    this.launchButton.textContent = message
    window.setTimeout(() => {
      this.launchButton.textContent = 'Launch'
    }, duration)
  }

  private aspect(): number {
    return Math.max(1, this.canvasWrap.clientWidth) / Math.max(1, this.canvasWrap.clientHeight)
  }

  private onResize = (): void => {
    this.camera.aspect = this.aspect()
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(this.canvasWrap.clientWidth, this.canvasWrap.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }

  private updateRudderVisuals(delta: number, turn: number): void {
    const target = THREE.MathUtils.clamp(turn, -1, 1) * 0.58
    const blend = 1 - Math.pow(0.035, delta)
    this.moduleMeshes.forEach((mesh) => {
      mesh.traverse((object) => {
        if (!object.userData.rudderPivot) return
        object.rotation.y = THREE.MathUtils.lerp(object.rotation.y, target, blend)
      })
    })
  }

  private getShipControls(): ShipControls {
    return {
      throttle: (this.pressedKeys.has('w') ? 1 : 0) + (this.pressedKeys.has('s') ? -1 : 0),
      turn: (this.pressedKeys.has('a') ? 1 : 0) + (this.pressedKeys.has('d') ? -1 : 0),
    }
  }

  private isShipControlKey(key: string): boolean {
    return key === 'w' || key === 'a' || key === 's' || key === 'd'
  }
}
