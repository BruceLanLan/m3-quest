# AGENT.md — M3 Crossing 的 Goal-Driven Autonomous Build 工作流

> 这是给**任何 LLM Agent**（M3 / Claude / Codex / 任何）的工作契约。
> 读这一份文件，按里面的循环工作，你的产出就是 v5+ 的功能。

---

## 0. 你在做什么

**项目**：M3 Crossing —— 浏览器里的 Octopath-style 动物之森。

**Why 自主**：
- Bruce 不想每次都重复设计指令
- 想让 Agent 看到 goal 之后，**自己拆任务、自己验证、自己 commit**
- 整个 workflow 是*可被复制*的：别的项目也能套

**约束**：
- ❌ 不许泄漏 Bruce 的个人信息 / API key / 任何私域
- ❌ 不许引入 npm / 第三方 CDN / 任何外部依赖（项目承诺零依赖）
- ❌ 不许破坏 v4.1 的存档兼容性（save format 4.1 → 5.0 必须能迁）
- ❌ 不许把游戏拆成多文件、引入打包工具
- ✅ 单 HTML + 单 CSS + 单 JS 三件套
- ✅ 美术程序化生成
- ✅ 每个版本都有 changelog

---

## 1. The Goal（不要变）

> **把 M3 Crossing 做成对标 Switch 动物之森（New Horizons）生活模拟深度的浏览器游戏。**
> 当前在 v4.1，target 是 v7.0。

### 验收维度

| 维度 | v4.1 现状 | v7.0 目标 | gap |
|---|---|---|---|
| 视觉 | Octopath HD-2D ✅ | 维持 | 无 |
| 村民数 | 20 | 30+ | gap 10+ |
| 物品 | ~50 | 300+ | gap 250+ |
| 博物馆 | 21 类 | 60+ 类 | gap 40+ |
| 地形编辑 | 3 工具 | 6 工具（ramp / 坡 / 路径变体） | gap 3 |
| 自定义设计 | 16 emoji | 64×64 像素画板 | gap 大 |
| 反应动作 | 0 | 16+ | gap 全 |
| 季节事件 | 粒子 | 完整节日循环 | gap 大 |
| 多人 | 无 | 梦境地址占位 | gap 全 |
| K.K. 曲库 | 0 | 12+ 歌 | gap 全 |
| 存档版本 | 4.1 | 5.0+ 兼容 | — |

### 决策原则
- 一次 PR 一个**垂直切片**（一个功能从头到尾：UI + 逻辑 + 视觉 + 测试）
- 视觉是 king —— 比 Switch AC 实现粗糙点可以，但**视觉一定要 Octopath 范**
- 性能预算：1280×720 / 60fps / 4-5 代村民 + 200 tile 不会掉

---

## 2. 工作循环（必读）

每个新功能都按这个循环走：

```
┌──────────────┐
│ 1. UNDERSTAND │  读 README / CHANGELOG / 现有 game.js 的对应段
└──────┬───────┘
       ↓
┌──────────────┐
│ 2. SPEC      │  在 PR 描述里写 3-5 行的"我要改什么、为什么、怎么验"
└──────┬───────┘
       ↓
┌──────────────┐
│ 3. CODE      │  改 game.js（必要时也改 index.html / styles.css）
└──────┬───────┘
       ↓
┌──────────────┐
│ 4. VERIFY    │  node /tmp/probe.js  +  浏览器 smoke test
└──────┬───────┘
       ↓
┌──────────────┐
│ 5. CHANGELOG  │  在 CHANGELOG.md 加 vX.Y 一节
└──────┬───────┘
       ↓
┌──────────────┐
│ 6. COMMIT    │  git add . && git commit -m "vX.Y: <feature>" && git push
└──────┬───────┘
       ↓
   loop back to 1
```

### 每个 phase 的具体动作

#### Phase 1: UNDERSTAND
- 跑一次 `grep -n "function <相关模块>" game.js` 摸清现状
- 读对应段的 50-100 行上下文
- 查 CHANGELOG.md 之前有没有相关历史

#### Phase 2: SPEC
在 commit message 里先写这 3 段：
```
Why: <为什么要做，1-2 句>
What: <改了什么，bullets>
Verify: <怎么证明它 work>
```

#### Phase 3: CODE
- 优先扩展 `game.js` 现有段，**不要**新建文件
- 改 `world` 数据结构时同步更新 `saveGame` / `loadGame`
- 改 ITEMS 时**永远**保留旧 id，新加的加新 key（向后兼容）
- 改 `ELEVATION_PX`、`MAX_QUADS` 等常量时**先估算**性能影响

#### Phase 4: VERIFY
**必跑**：
1. `node /tmp/probe.js`（Node stub 探测，2 秒内抓 80% 错误）
2. 起 http server: `python3 -m http.server 8767 --bind 127.0.0.1`
3. browser_navigate 打开游戏，console.clear，2 秒后查 js_errors
4. browser_vision 看画面（要求玩家、岛、HUD 都正常）
5. 触发新功能的关键路径（按键 / 模态 / 工具）再 vision 一次

**任一步 fail → 不 commit，回去修。**

#### Phase 5: CHANGELOG
```markdown
## vX.Y.Z — YYYY-MM-DD

**New:**
- <功能 1>
- <功能 2>

**Improved:**
- <优化 1>

**Fixed:**
- <bug 1>

**Files changed:** game.js +N / -M
```

#### Phase 6: COMMIT
- 一个 PR 一个版本号
- 提交信息格式: `vX.Y: <一句话>`
- 推完后**自己读 GitHub Actions 的 verify.yml 跑过的结果**

---

## 3. 自我禁忌（do NOT）

- ❌ **不要** `git push` 到 master/main 之外（Bruce 的私有流程）
- ❌ **不要**在 commit message / 代码 / 注释里出现 Bruce 的 email / 真实姓名 / 设备名
- ❌ **不要**写一个 `console.log` 含 API key / token / 凭证
- ❌ **不要**把 v4 之前版本的代码删除（`.bak/` 和 `.bak-v3/` 是历史）
- ❌ **不要**引入 `package.json` / `node_modules` / CDN
- ❌ **不要**改 Atlas 像素大小（256 → 128）这种"重构"，会破 sprite 系统
- ❌ **不要**在 render() 里加 await / Promise（破坏 60fps loop）

---

## 4. 推荐的代码路径

| 想做的事 | 改哪里 |
|---|---|
| 加新物品 | `ITEMS` 字典（~2050 行附近） |
| 加新村民 | `VILLAGER_SPECIES` 数组（~1900 行附近） |
| 加新建筑 | `placeShopPlaza()` 函数 + `buildTile()` 字典 |
| 加新模态 | 在 `openAction(act)` 开关里加 case + 写 `openXxx()` |
| 加新工具 | `hotbar` 槽 + `useItem()` switch |
| 加新键 | `keydown` listener 块 |
| 改视觉 | `buildTile()` 字典 + `render()` layer 处理 |
| 加新粒子 | `buildParticle()` + `updateParticles()` + `spawnParticle()` 调用点 |
| 改移动 | `updatePlayer()` + `isWalkable()` |
| 改存档 | `saveGame()` / `loadGame()` — 务必 bump v 字段 |

---

## 5. 必读参考

- **README.md** — 整体设计、目标、文件结构
- **CHANGELOG.md** — 所有版本历史
- **.github/workflows/verify.yml** — CI 验证流程
- **`/tmp/probe.js`** — Node stub probe 模板（在 2d-canvas-games skill 里）
- **building-2d-canvas-games skill** — 早期版本的架构参考
- **M3 Crossing / Bruce 的 AGENT 工作方法论**：参考 `BruceLanLan/agent-harness` 和 `BruceLanLan/autoevolve`

---

## 6. 出错时的降级

- **WebGL 不支持**：v3 之前的 Canvas 2D 实现，在 `.bak-v3/`，不要混用
- **找不到图集空间**：检查 `atlasCursor` —— `MAX_QUADS=8192` 是上限
- **性能掉帧**：先关粒子（`time.weather` → sunny），再关动态阴影
- **存档打不开**：bump `saveGame` 里的 `v` 字段，在 `loadGame` 里加向后兼容分支

---

## 7. 哲学（可忽略但建议读）

> Bruce 喜欢 *kill-and-rebuild* 而不是 *iterative patches*。
> 如果 v5 的方向对不上他的 vision，他可能让你推倒重来。
> **所以**：在 v4 → v5 重构时，**保留 v4 的存档、保留视觉核心、保留 3 文件结构**。
> 可以重写内部结构，但**不能破坏**用户已经在玩的游戏。

— end —
