# LAB 04：小海域航行 / Small Sea Navigation

项目类型：游戏原型  
项目状态：原型

LAB 04: Small Sea Navigation 是第 5 个 LAB 作品，编号为 LAB 04。它基于第 4 个作品 LAB 03: Modular Shipbuilding 开发，复用了 LAB 03 的造船网格、8 种模块、`ShipBlueprint`、组合刚体、浮力、重心、稳定性、波浪水面、诊断与 iframe 适配基础。

本作不重做 Modular Shipbuilding，而是把问题从“船能否稳定漂浮”推进到“玩家造出的船能否穿过小海域并抵达岛屿”。

## 核心玩法

完整闭环：

```txt
造船 → 下水 → WASD 驾驶 → 避开浅滩与礁石 → 抵达岛屿 → 航行报告 → 返回船坞改造
```

船体设计会直接影响航行：

- 引擎决定推进力；没有引擎时只能极慢移动。
- 船舵决定转向能力；没有船舵时转向非常迟钝。
- 总质量影响加速度与最高速度。
- 浮力余量、船宽、重心和左右配重影响横倾与稳定性。
- 吃水过深会在浅滩减速，持续停留会触发搁浅记录。
- 碰撞礁石会减速、反弹并降低最终评价。

## 已实现功能

### 开场与界面

- 使用 `public/lab.svg` 的入场缩放动画，并平滑过渡到开始界面。
- 开始界面显示实验编号 `004`、项目编号 `LAB-04`。
- 暗色、克制、蓝绿色高光的 LAB 视觉风格。
- 中文建造界面、航行 HUD、玩法说明与航行报告；英文项目标题保持 `Small Sea Navigation`。

### 造船模式（复用 LAB 03）

- 5 × 4 × 7 可调蓝图网格。
- 8 种模块：木质船体、浮力、压载、金属结构、引擎、船舵、大炮、货物。
- 左键放置，右键或 Delete 删除，R 旋转，C 清空。
- 实时统计质量、浮力、吃水、重心、稳定性、引擎与舵能力。
- 连通性与悬空结构分析；不稳定模块在下水后会脱落。

### 航行模式（LAB 04 新增）

- 第三人称跟随镜头；鼠标拖动环绕，滚轮缩放，R 重置视角。
- W/S 推进与倒车，A/D 转向。
- 可信的惯性、水阻、浮力、波浪起伏与转向横倾反馈。
- 船尾尾流、下水水花和速度相关泡沫近似效果。
- 航行 HUD：船速、推力、航向、岛屿距离、稳定性、吃水、碰撞和搁浅次数。

### 小海域地图

- 起始港口与双栈桥。
- 约 160 个世界单位外的目标岛屿、灯塔、发光信标和靠岸光环。
- 两片有明显颜色提示的浅滩区，水深由 `SeaMap.getDepthAt()` 提供。
- 五处礁石碰撞区。
- 红绿浮标组成的建议航道。
- 有雾气、动态波浪、蓝绿色高光的有限海域。

### 航行报告

完成靠岸或主动结束航行后生成面板，记录总用时、最大/平均速度、碰撞、搁浅、最大横倾、最终距离与稳定评分。报告会根据引擎、船舵、吃水、碰撞和横倾给出问题分析与改造建议。

## 本地启动

```bash
npm install
npm run dev
```

访问：`http://127.0.0.1:5173/`

## 构建与预览

```bash
npm run build
npm run preview
```

生产预览路径：`http://127.0.0.1:4173/Small-Sea-Navigation/`

## GitHub Pages 部署

`.github/workflows/deploy.yml` 会在推送到 `main` 后使用 Node LTS 执行 `npm ci`、`npm run build`，并把 `dist` 发布到 `gh-pages` 分支。

`vite.config.ts` 的路径规则：

```ts
base: command === 'serve' ? '/' : '/Small-Sea-Navigation/'
```

本地开发使用 `/`；GitHub Pages 使用仓库子路径 `/Small-Sea-Navigation/`。部署到根域名、Vercel 或 Netlify 时，应把生产 `base` 改为 `/`。

## iframe 嵌入

```html
<div class="demo-frame-wrap">
  <iframe
    src="https://orandolee.github.io/Small-Sea-Navigation/?embed=1"
    title="LAB 04: Small Sea Navigation"
    loading="lazy"
    allow="fullscreen"
    allowfullscreen
  ></iframe>
</div>
```

`?embed=1` 会压缩标题和模块栏，更适合个人网站中的 16:9 iframe。页面点击激活后才捕获键盘输入，并支持父页面消息：

```ts
{ type: 'LAB04_PAUSE' }
{ type: 'LAB04_RESUME' }
{ type: 'LAB04_RESET' }
```

加载完成后 Demo 会发送 `{ type: 'LAB04_READY' }`。

## 操作说明

- 左键：放置模块
- 右键 / Delete：删除模块
- R：建造时旋转模块；航行时重置镜头
- C：清空蓝图
- Launch：下水并开始航行
- W / S：前进 / 倒退
- A / D：左转 / 右转
- 鼠标拖动 / 滚轮：环绕观察 / 调整距离
- ESC：释放键盘控制
- F：发射大炮（保留的 LAB 03 实验能力）

## 主要文件结构

```txt
src/
  app/Lab04App.ts                 应用状态、场景与建造/航行切换
  build/ShipBlueprint.ts          复用的蓝图与船体统计
  modules/                        复用的模块定义与 Mesh 工厂
  physics/                        组合刚体、稳定性与 WaveField
  diagnostics/ReportGenerator.ts  LAB 03 诊断基础
  navigation/SeaMap.ts            海图、水深、礁石与岛屿目标
  navigation/VoyageRecorder.ts    航行数据记录
  navigation/VoyageReportGenerator.ts 航行评价与改造建议
  water/WakeSystem.ts             尾流与水花近似效果
  styles.css                      开场、HUD、报告与响应式样式
public/lab.svg                    LAB 开场标志
```

## 技术说明

浮力模型沿用 LAB 03 的简化组合刚体：每个模块贡献质量、浮力和位置，蓝图计算浮力余量、重心、估算浮心、吃水与稳定评分；下水后波浪高度参与浮力采样和横纵摇。LAB 04 在其上加入质量相关加速度、引擎推力、船舵转向、水阻、浅滩阻力、礁石碰撞与航行记录。

默认限制设备像素比不超过 2，海面使用中等分段网格，岛屿和礁石使用简化几何体；页面隐藏时暂停更新。

## 后续扩展

- 蓝图保存、加载与分享
- 更精细的搁浅脱困和船体损伤
- 多个岛屿、可选航线与天气变化
- 更完整的 GPU 尾流和泡沫系统
- 航行回放与分段数据图表
- 移动端虚拟摇杆与触控建造
