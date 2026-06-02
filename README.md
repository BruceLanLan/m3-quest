# M3 Crossing · Octopath-style Animal Crossing

> **动物之森 × 八方旅人伪 3D · 单文件 vanilla HTML+WebGL+JS · 零依赖 · Goal-driven autonomous build**

[![version](https://img.shields.io/badge/version-v4.1-7c3aed)](https://github.com/BruceLanLan/m3-quest)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![play](https://img.shields.io/badge/play-live-7c3aed)](https://BruceLanLan.github.io/m3-quest/)

---

## 1. 这是什么

**M3 Crossing** 是一个跑在浏览器里的、像素风的「动物之森 + 八方旅人」单页游戏。
打开网页就能玩，无需安装任何东西、也不需要联网服务（存档走 localStorage）。

它解决两个问题：

| 问题 | 这个项目怎么做 |
|---|---|
| **动物之森 / Stardew** 视觉偏童稚，缺深度 | 用八方旅人那种 *HD-2D*：3/4 axonometric 投影、5 层 Z-depth、动态阴影、4 阶段日夜、深度雾、bloom、粒子 |
| **八方旅人** 没有生活模拟内容 | 上 Switch AC 完整系统：岛屿评级、Nook Miles+、Blathers 博物馆、K.K. 演唱会、营区邀请、神秘岛、Island Designer 地形编辑…… |

所有美术都是**程序化生成**的（运行时画到 Canvas 上，再上传到 WebGL texture atlas），没有任何外部贴图、模型、音频文件。整游戏 3 个文件，~4500 行。

---

## 2. 怎么玩

### 方式 A：直接玩（推荐）
点这个链接： https://BruceLanLan.github.io/m3-quest/
（GitHub Pages 公开 URL，桌面 / 手机 / 平板都能打开）

### 方式 B：本地跑
```bash
git clone https://github.com/BruceLanLan/m3-quest.git
cd m3-quest
python3 -m http.server 8000
# 浏览器打开 http://127.0.0.1:8000/
```

> ⚠️ **不要**直接双击 `index.html` 用 `file://` 打开 —— WebGL 跨域策略会拒
> 绝，必须走 `http://`。`python3 -m http.server` 是最快的本地服务。

### 操作速查
| 键 | 作用 |
|---|---|
| `WASD` / 方向键 | 移动 |
| `E` / `Space` | 互动 / 砍树 / 钓鱼 / 抓虫 / 摆放（terraform mode） |
| `B` | 跑步切换 |
| `X` | 使用当前工具 |
| `R` | 摇树 |
| `L` | 挖（铲子） |
| `T` | 打开 Island Designer（地形编辑器） |
| `Shift+E` | 反向 terraform（降 / 填水 / 拆路） |
| `1-8` | 切工具 |
| `I` 背包 · `M` 地图 · `Y` NookPhone · `J` 博物馆 · `N` Nook Miles+ · `K` 村民 · `Tab` 岛屿评级 · `Esc` 设置/关闭模态 |

---

## 3. 设计思路：为什么这么做

### 3.1 为什么是「单文件 vanilla WebGL」？

我试过 Three.js（v1）— 包太大、API 复杂、像素风不利落。
我试过 Canvas 2D（v3）— 每帧 `drawImage` 太慢，~2000 个 tile 就掉帧。
最终选 **vanilla WebGL + 程序化 sprite atlas**：

- 启动时把所有 sprite 画到一张 2048×2048 atlas 上，一次性上传到 GPU
- 每帧只更新 VBO + 一次 `drawArrays` —— 一个 64×64 岛 + 20 村民 + 100+ tile 跑 60fps 无压力
- 没有打包、没有构建、没有 `node_modules`，打开 `index.html` 就是全部

### 3.2 HD-2D 视觉管线是怎么搭的

```
World (wx, wy, wz)
  ↓ axonometric (2:1)
  ↓ + camera follow (tile units)
  ↓ + day/night color grading (4 phases)
  ↓ + per-vertex lit × per-quad tint
  ↓ + depth fog by distance to camera
  ↓ + bloom on lit-window sprites
  ↓ + dynamic shadows for chars / trees / buildings
  ↓
NDC quad with UV → 1 draw call
```

5 层 Z-depth：ground(0) → grass-overlay(1) → water(2) → building(3) → character(4)。
Y-offset 跟随 elevation：cliff 阶梯每升一级抬高 32px，自动画南向 / 东向 cliff face。

**关键 shader 技巧**：
- `u_sunColor` × `u_lit`（顶点）做日间光强弱
- `u_ambColor` 控制夜间的环境光（蓝紫）
- `u_fog` 按距离混合 sky color —— 远景自然褪色
- `u_glow` 标记亮窗 / 灯笼 —— bloom 用 luminance > 0.6 的像素加亮

### 3.3 Switch AC 系统怎么"够用"

不是抄每个细节，而是把**核心 12 个循环**接上：

| 系统 | Switch AC 怎么做的 | 我们怎么做的 |
|---|---|---|
| 岛屿评级 | 5⭐ 加成综合树/花/村民/友谊/收集 | 同公式，进度条 + 升级条件显示 |
| Nook Miles+ | 5 等级 + 主题任务 | 5 等级 + 12 任务 |
| 博物馆 | 4 个分类、捐赠得奖 | 4 tab、捐赠按钮、Nook Miles 奖励 |
| K.K. 演唱会 | 周六晚 8 点 | 检测时间触发，0 / 100 / 500 Nook Miles |
| 神秘岛 | Dodo Airlines 2000 miles | 随机给物品 |
| 营区 | 邀请新村民 | Campsite 模态 6 NPC 邀请 |
| 商店 | Nook's Cranny 12 商品 | 工具 + 家具 |
| 服装 | Able Sisters 自定义设计 | 16 emoji 花样 + 调色板 |
| 地形编辑 | Island Designer 3 工具 | 3 工具 + 5 路径样式 + 0-3 elevation |
| 节日 | 季节性事件 | 季节粒子 + 季节色（spring 樱花、winter 雪） |
| 村民 | 8-10 个 personality | 20 个 species，4 personality，hobby |
| DIY 制造 | 配方 + 收集材料 | stub（解锁更多工具的合成） |

剩下不做的（梦境地址 / 照片模式 / Reacts）— 是 v5+ 的 backlog。

### 3.4 Goal-driven autonomous build：让 M3 自主迭代

这是这个 repo 真正想沉淀的东西 —— **怎么让一个 LLM Agent 长期按 goal 推进一个代码项目**。

详见 `AGENT.md` —— 它给未来的 Agent 写好了：
- 当前 goal（"对标 Switch AC"）
- 验收标准（怎么判断"v5 完成了 60%"）
- 工作循环（plan → code → verify → commit → repeat）
- 自我禁忌（不要泄露隐私 / 不要 / 不要什么）

---

## 4. 进度

| 版本 | 内容 | 状态 |
|---|---|---|
| v1 | Three.js GTA 版（`.bak/`） | 弃用 |
| v3 | Canvas 2D flat-HD-2D（`.bak-v3/`） | 弃用 |
| v4.0 | WebGL HD-2D 引擎 + Switch AC 主体系统 | ✅ 已完成 |
| **v4.1** | **Island Designer（terraforming）** | ✅ 已完成 |
| v5.0 | 地形编辑延伸（ramp / 分级斜坡 / 树苗生长） + Reacts | 📋 规划中 |
| v5.5 | 自定义设计画板（64×64 pixel editor） | 📋 规划中 |
| v6.0 | 季节性事件系统（樱花节 / 赏月 / 万圣节） + 营火 | 📋 规划中 |
| v7.0 | 多人 / Dream Address 占位 + 存档版本兼容 | 📋 规划中 |

完整 changelog 看 `CHANGELOG.md`。

---

## 5. 文件结构

```
m3-quest/
├── index.html        # 入口 + HUD + 9 个 NookPhone 模态
├── styles.css        # 米黄纸对话框 / 深玻璃 HUD / 紫罗兰 NookPhone
├── game.js           # 3938 行 — 引擎 + 系统 + 模态（一切都在这）
├── AGENT.md          # 给 M3 / 其他 Agent 的"按 goal 自迭代"工作流
├── CHANGELOG.md      # 版本演进日志
├── .gitignore        # 排除本地存档 / 编辑器 noise
└── .github/
    └── workflows/
        └── verify.yml  # 每次 push 自动跑 Node stub probe 验证不破
```

---

## 6. 致谢 / 风格借鉴

- **Octopath Traveler** (Square Enix) — HD-2D 视觉范式
- **Animal Crossing: New Horizons** (Nintendo) — 生活模拟系统
- **Stardew Valley** (ConcernedApe) — 农耕 + 节日循环
- **Baoyu Comic Style** — 角色头像视觉语汇
- 全部用 **Claude / minimax M3** 在 Hermes Agent 环境下完成

---

## 7. 许可

MIT — 代码随便用，不负责。
IP 提示：动物之森 / 八方旅人是 Nintendo / Square Enix 的商标。本项目是粉丝向非商用 demo，不要拿去卖。
