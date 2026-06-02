# Changelog

所有变更按 **vX.Y.Z** 标记。Y 是小功能、Z 是 bug 修、X 是大重构。

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
