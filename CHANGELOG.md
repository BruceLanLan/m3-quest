# Changelog

所有变更按 **vX.Y.Z** 标记。Y 是小功能、Z 是 bug 修、X 是大重构。

---

## v5.1.5 — 2026-06-02

**GTA: Slingshot weapon (shoot villagers, +wanted)**

**New:**
- Slingshot now shoots in player's facing direction
- Hits a villager within 3 tiles in the line of fire
- Target villager knocked for 3 seconds, wanted +1, +2 Nook Miles
- Sheriff (dog) is immune to slingshots
- Starting inventory now includes slingshot, axe, net (was just shovel + rod)

**Files changed:** game.js +28 / -1

---

## v5.1.4 — 2026-06-02

**GTA: Rob Nook's Cranny (steal bells, trigger 3-star wanted, villagers flee)**

**New:**
- Hold R + interact with Nook's Cranny → steal 1000 + 500*wanted bells
- +3 wanted stars (5 max)
- 60s cooldown per robbery
- All non-dog villagers scared for 5 seconds (pause wander)
- Dog sheriff immediately chases (wanted >= 3)

**Files changed:** game.js +23 / -0

---

## v5.1.3 — 2026-06-02

**Painterly tile textures (grass tufts, water foam, tree depth, sand variation)**

**New:**
- Grass: 12 tuft clusters (3-blade each) + 6 darker tufts + 4 small wild flowers per tile
- Water: 3-layer depth (deep base + mid tone + animated shimmer), 5 foam dots at shore, 3 reflective spots
- Sand: 3-color variation (light/mid/dark), 3 shell-like dots, foam at water edge
- Tree: 5-layer foliage with sun-from-top-right highlights (light pixels) + 8 dapple spots
- Tree-fruit: 7 apples (up from 5) + 4 apple highlights
- Bush: 4-layer with sun highlight pixels + 4 dapple spots
- Flowers: 4-petal cross shape (was 2px dot) with light center + 6 grass tufts around
- New palette: sandL = #fef3c7 (light sand)

**Visual change:** Ground tiles now look like living terrain, not flat color. Water has depth, trees have volume, sand has variation.

**Files changed:** game.js +85 / -22

---

## v5.1.2 — 2026-06-02

**Improved character sprites (eyes, hands, mouth, ears, body shading, 4-frame walk)**

**New:**
- All 20 species + player re-rendered with bigger eyes (5x5 with iris + pupil + highlight)
- Added mouth, ears with ear-inner color, hands visible on arms
- Body shading on right side (sun direction)
- Head top highlight
- Arms swing when walking
- Legs step with 4-frame walk cycle
- Shirt buttons (2 white dots)

**Files changed:** game.js +84 / -44

---

## v5.1 — 2026-06-02

**Painterly Color Grading Pass (visual depth from flat to Octopath)**

**New:**
- Fragment shader color grading pipeline:
  - S-curve contrast +18% + smoothstep (Octopath-style deep blacks)
  - Split-toning: cool blue shadows (0.92, 0.96, 1.10), warm orange highlights (1.12, 1.05, 0.92)
  - Saturation -12% (less kiddy, more painterly)
  - Vignette darkening at screen corners
- Added v_ndcX varying to vertex shader for vignette

**Visual change:** Game now looks more painterly, less kid-game. Trees, water, grass, buildings all share the same Octopath-like color treatment.

**Files changed:** game.js +22 / -0

---

## v5.0 — 2026-06-02

**HD-2D Octopath Tier Rebuild — buildings 3D, world rendering fixed**

**New (step 1):**
- 19 建筑 sprite 重画为 32x48 cell (1.5x TILE_H)
- 建筑 cell 分层：透明 top 16px + 屋顶 + 墙身 + 草基底
- Building extrude 32px，1.5x 渲染高度
- 树 + 装饰 + 角色 + 建筑 + 庄稼 + 物品 全部支持 elevation 偏移

**New (step 3 — GTA 元素):**
- 玩家 sprint (B 键) 撞村民 → knockback 推开 1.2 tile + 玩家被罚款 50 bells + wanted +1
- 玩家 sprint 撞建筑 → wanted +1 + 罚款 100 bells（冷却 2 秒）
- 警员 AI：当 wanted ≥ 3，dog species（戴 sheriff hat 的警员）会主动追玩家
- 警员接触玩家 → 罚款 500 × wanted、押回广场、wanted 清零（冷却 3 秒）
- 撞到的村民有 2 秒 knockback 冷却，期间不游走
- GTA 元素完整：5 星 wanted 等级系统、警员存在、可被逮捕

**Fixed:**
- v4.2 → v5.0 render 崩溃：`p is not defined` ReferenceError
  - tree sprite render line 引用未定义的 `p.scale`，实际应为 `pTree.scale`
  - decoration line 同样的 `p.scale` → 改 `pD.scale`
  - building shadow line 同样的 `p.scale` → 改 `pBase.scale`
  - building main sprite line 4 处 `p.scale` → 改 `pBase.scale`
  - bug 修好后游戏可以正常渲染整个世界

**Files changed:** game.js +94 / -5

---

## v4.2 — 2026-06-02

**HD-2D Painterly Pass（视觉重做）**

**New:**
- 建筑 3D 凸出：每个建筑渲染 2 次（暗色墙身 + 亮色屋顶凸出 4px），阴影跟随太阳方向
- 树风动：所有树按 sin 周期摆动 ±1.2px，阴影跟随半幅
- 花/草丛风动：±0.7px 摆动
- 太阳方向阴影：`dayColor()` 返回 `sunDir`，阴影长度与时段相关
- 大气 haze shader：屏幕顶部更冷（mix 进 fogColor），底部微暖
- Tile 边缘 AO：地面 tile 边角最多暗 18%，模拟 Octopath 的 grout 效果
- v_ndcY varying：把 NDC y 传到 fragment shader 用

**Files changed:** game.js +110 / -10

---

## v4.1.2 — 2026-06-02

**UX 修复**

**Fixed:**
- loading 一直转：boot 自动检测存档 + 按 Enter/点击屏幕直接进游戏
- v4.0 → v4.1 缓存：HTML 加 `?v=4.1.2` query string + no-cache meta

**Files changed:** index.html +6

---

## v4.1 — 2026-06-02

**Island Designer（地形编辑）**

**New:**
- 3 个 terraform 工具：⛰ 高地建设器、💧 河水建设器、🛤 路径建设器
- 5 种路径样式：草路 / 石板路 / 砖路 / 灰石路 / 木栈道
- 0-3 级海拔系统（cliff 阶梯），每级 32px 视觉偏移
- 自动绘制南向 / 东向悬崖面（边邻居海拔更低时）
- 2 种新悬崖坡道 sprite（cliff-ramp-n、cliff-ramp-e）
- NookPhone 集成 Island Designer APP
- 全部数据持久化（save format v4.1）

**Improved:**
- 全局 Escape 处理：先关模态再开设置（不再双触发）
- 所有渲染层（地面 / 装饰 / 建筑 / 庄稼 / 物品 / 角色）跟随 elevation 偏移
- 移动约束：跨海拔移动仅允许 ±1 步
- E 键智能判断：有 NPC/建筑在旁时优先互动，无目标时执行 terraform

**Fixed:**
- v4.0 → v4.1 升级后存档兼容（save format 加 v 字段）
- loading 一直转：新增「按 Enter / 点击屏幕 直接进游戏」交互
- 空白存档时按 resume 卡死：补全 startLoop 调用

**Files changed:** game.js +312 / -8

---

## v4.0 — 2026-06-02

**Octopath-style HD-2D 引擎 + Switch AC 主体系统**

**New:**
- WebGL HD-2D 引擎（vanilla，无依赖）
- 真 3/4 axonometric 投影（2:1 ratio）
- 5 层 Z-depth：ground(0) → grass(1) → water(2) → building(3) → character(4)
- 动态太阳光照（4 阶段：dawn / day / dusk / night）
- 深度雾化（远景褪入天空色）
- 椭圆阴影在玩家 / 村民 / 树 / 石头 / 建筑下
- 粒子系统：雨 / 雪 / 樱花 / 萤火虫 / 落叶 / 泡泡 / 火花 / 尘埃
- 亮窗自动 bloom（glow uniform）
- 8 按钮 NookPhone 轮盘 + 9 个模态（背包 / 地图 / 电话 / 评级 / 博物馆 / Miles+ / 村民 / 设置）
- 20 个 villagers 4 personality 2 hobby
- Nook's Cranny / Able Sisters / Museum / Resident Services / Bank / Pawn / Tower / K.K. Slider / Dodo Airlines / Campsite
- 12 个主任务 + Nook Miles+ 5 等级
- 1-5⭐ 岛屿评级系统（树 / 花 / 村民 / 友谊 / 收集 / 垃圾 6 维评估）
- Blathers 博物馆 4 分类目录（bugs / fish / fossils / art）
- 神秘岛旅行、营区邀请、DIY 合成桩
- 5 种地形 + 6 种作物阶段 + 9 种树 + 5 种花

**Files changed:** index.html / styles.css / game.js（4500 行全新）

---

## v3 — 2026-06-01

**Canvas 2D flat-HD-2D 第一版**

完整游戏系统但用 2D context 渲染，每帧 2000+ 个 tile 卡顿。弃用，备份在 `.bak-v3/`。

---

## v1 — 2026-05-31

**Three.js GTA 风格**

最初按你描述做的 GTA 版（`.bak/`），但 3D 风格跑不进动物之森的"宠物养成"调性。弃用。
