# FDE Demo Skill + 现场控制台 — 设计方案（v0.2 草案，评审用）

> 一句话：把 FDE「边跟客户聊、边出 Demo」的现场工作流，做成
> **一个 Claude Code Skill（大脑）+ 一个 localhost 现场控制台（脸）**：
> 控制台管录音/转写/一键生成/自动展示，skill 管工作流方法论与「开源优先」
> 的 Demo 生产阶梯（复用 > 组装 > 生成）。
>
> 状态：草案 v0.2，待评审。定稿后补英文版。文末「开放问题」需要拍板。

**v0.2 相对 v0.1 的三个变化**（均来自评审意见 + GitHub 实际调研）：

1. **形态定论**：不是「skill 还是网页」二选一——skill 是大脑，localhost
   控制台是薄交互层。此前否掉的是「云端网页当 runtime」，localhost 面板
   背后是有全部本地权限的 Node 进程，大脑仍是 Claude Code（见 §2、§9）；
2. **新增「开源优先」管线**：出 Demo 前先决定「复用哪个开源项目 / 参考
   哪个成熟产品」，边聊边搜 GitHub，基于现成项目改而不是从零做（见 §4）；
3. **录音→转写→自动输入→自动展示 全链路确认可行**，每一环都有高星
   开源先例或官方 SDK 支撑（见 §2.2、附录 A）。

**落地状态（2026-07-25）**：v0.1 全量 + v0.2 控制台已实现并通过自动化回归
（agent 套件 37/37、控制台 15/15、ingest 4/4、模板 build ✓、mock 路由含
`{id}` 模式匹配运行时实测 ✓）。skill 同时通过 OpenFDE runtime 的 catalog
校验——一份源码，Claude Code 与 OpenFDE agent 两个运行时可用。待实测项：
claude 适配器真机回合（需登录）、FunASR 语音链路（需本地起服务）、画廊
3 条目跑通验证。20 分钟模拟客户会议已执行并验收通过（1 回合超预算，
原因与规则修订见实录）：全程记录在 REHEARSAL.md，10 个现场场景剧本在
skills/fde-demo/references/scenarios.md，演练工作区与产物在仓库
examples/hongda-rehearsal/。本项目已自 OpenFDE 主仓迁出为独立仓库
OpenFDEAI/FDEDemo（方案与实录中的旧路径 agent/skills/fde-demo 即今
skills/fde-demo）。

---

## 0. 背景与问题

FDE 的核心现场动作是：坐在客户对面，边聊边梳理需求，并在对话过程中让一个
可以点、可以看的 Demo 逐步成形。客户当场看到「你们听懂了、而且做出来了」，
是签下 POC 的最强信号。

这个动作今天完全靠 FDE 个人手艺：开会记要点，回去熬夜搭 Demo，第二次会议
才有东西看。我们要把「当场出 Demo」变成一套可复制的工具化工作流。

三类输入决定 Demo 的形态：

1. **客户系统截图** —— 现有系统长什么样、术语是什么、痛点在哪一屏；
2. **客户 API / 数据样例** —— 数据从哪来，接真还是造假；
3. **既有开源项目与成熟产品**（v0.2 新增）—— 这个需求在 GitHub 上有没有
   现成的轮子？市面上最好的同类产品（如图片设计之于稿定设计）长什么样？

## 1. 目标与非目标

**目标**

- G1 会前 10 分钟内，产出一个带客户品牌（logo / 配色 / 术语）的可运行底座
  ——底座优先来自**预验证的开源项目**，其次才是模板组装；
- G2 现场循环中，每个需求增量 ≤3 分钟落到可见的界面变化；
- G3 全程 spec 先行：需求台账（`DEMO_SPEC.md`）永远与 Demo 同步，可当场投给客户确认；
- G4 现场交互三步走：**录音（开始/暂停）→ 转写自动喂给 Claude Code →
  生成完自动展示网页**，FDE 全程只说话 + 点按钮（v0.2 交付）；
- G5 收尾产出可带走的资产：需求确认单、演示台词、预览链接、判断记录（喂给 FDE Loop）；
- G6 整套东西可安装、可分发，其他 FDE 拿来就能用。

**非目标**

- 不做**云端** Web 产品 / 独立客户端——localhost 控制台是本地薄壳，不是
  又一个 SaaS；大脑永远是 Claude Code（理由见 §2.1）；
- 不做实时打断式交互——agent 不在客户说话时抢话，回合由 FDE 触发（见 §5）；
- v0.1 不依赖语音与控制台——手敲要点即可跑通全流程；
- 不追求 Demo 代码的生产级质量——Demo 的 KPI 是「打动」，不是可维护性。

## 2. 形态决策：Skill 是大脑，控制台是脸

### 2.1 运行时选择（维持 v0.1 结论，表述修正）

| 方案 | 判定 | 理由 |
|------|------|------|
| 云端网页当 runtime | ✗ | 拿不到本地能力：起不了 dev server、访不了内网 API、驱动不了本地 coding agent |
| 独立 Agent Runtime（自研壳） | ✗ | 重复造 Claude Code 已有的一切，永远追不上 |
| MCP Server | ✗ | MCP 是「工具」层；我们要固化的是「工作流 + 方法论」 |
| **Claude Code Skill（大脑）** | ✓ | 工作流 + 领域知识 + 脚本 + 模板的打包格式；runtime 原语现成 |
| **localhost 控制台（交互层，v0.2）** | ✓ | 纯 TUI 不适合现场：录音控制、转写流展示、投屏都需要一个面板；本地 Node 进程有全部权限，经官方 Agent SDK 驱动 Claude Code，不另造大脑 |

### 2.2 「录音 → 自动输入 → 自动展示」三步流程可行性评估

逐环验证过，**全链路可实现**，且大部分环节有可直接改造的开源先例：

| 环节 | 实现路径 | 依据 / 先例 |
|------|----------|-------------|
| ① 录音控制（开始/暂停）+ 本地转写 | 控制台页面 `getUserMedia` 采音 → 本地 ASR 服务。中文默认 **FunASR**（19.5k★，MIT，流式 + VAD + 标点），英文备选 whisper.cpp；说话人分离可上 whisperX（23.2k★，BSD-2） | 先例：`mbailey/voicemode`（MIT，Claude Code 语音对话 MCP 插件，whisper.cpp 本地 + 静音检测）；`slopus/happy`（22.8k★，MIT，Claude Code Web/移动客户端，内置实时语音） |
| ② 转写自动喂给 Claude Code | 官方 **Claude Agent SDK**（TS/Python）：同一个 agent loop，默认加载 `.claude/skills`、CLAUDE.md、插件；支持流式输入、多轮 session、权限回调。控制台 Node 进程用 SDK 起 session，把转写增量作为回合输入 | 官方能力，零 hack。第三方佐证：`The-Vibe-Company/companion`（MIT）、`siteboon/claudecodeui`（12.9k★，AGPL，只借鉴模式）都在 Web UI 里起 Claude Code 会话、流式输出、审批工具 |
| ③ 生成完自动展示 | dev server 常驻热更新；控制台内嵌 demo iframe 自动刷新，或 `open http://localhost:3000` | 全链路里最简单的一环 |

结论：**不需要发明任何新机制**。且按 §4 的「开源优先」原则吃自己的狗粮：
控制台本身就应该从 happy / companion（均 MIT）改造起步或充分借鉴，而不是从零写。

## 3. 总体架构：四件东西

```
┌─ 浏览器 ────────────────────────────────────────────────┐
│  投屏窗口: Demo (localhost:3000) + DEMO_SPEC 预览        │
│  FDE 窗口: 现场控制台 (localhost:4321)                    │
│    [● 录音/⏸ 暂停]  转写流  [▶ 生成本回合]  候选项目面板  │
└──────────────┬──────────────────────────────────────────┘
               │ WebSocket
┌─ 控制台服务（本地 Node 进程，v0.2）──────────────────────┐
│  采音 → 本地 ASR (FunASR / whisper.cpp) → TRANSCRIPT.md  │
│  [生成] → Claude Agent SDK session（加载 fde-demo skill） │
│  回合完成 → 通知前端刷新 demo iframe                      │
└──────────────┬──────────────────────────────────────────┘
               │ 文件系统共享（demos/<客户>-<日期>/）
┌─ Claude Code（大脑）─────────────────────────────────────┐
│  fde-demo skill：回合协议 · 开源优先阶梯 · 摄取管线       │
│  （FDE 随时可另开 TUI 会话在同一工作区手动补刀）          │
└─────────────────────────────────────────────────────────┘
```

### 3.1 Skill 包（工作流的固化）

```
FDEDemo/                          # 独立仓库 OpenFDEAI/FDEDemo
  README.md · DESIGN.md · TESTING.md · REHEARSAL.md
  .claude-plugin/                 # plugin.json + marketplace.json，可 /plugin install
  skills/fde-demo/                # Skill 本体（自包含，可直接拷进 .claude/skills/）
    SKILL.md                      # 工作流状态机：会前 → 现场循环 → 收尾
    references/
      elicit.md                   # 现场提问清单（复用 Elicitation Protocol 方法论）
      spec-format.md              # DEMO_SPEC.md 格式约定
      oss-first.md                # 开源优先阶梯：搜索策略、license 规则、画廊使用
      demo-kit.md                 # 模板库使用说明与模块清单
      scenarios.md                # 10 个现场场景剧本
    templates/base/               # Next.js 底座：theme.json 一文件品牌化（见 §8）
    gallery/                      # Demo 画廊索引：预验证开源项目池（见 §4.4）
    scripts/ingest-api.ts         # OpenAPI / curl 样例 → 类型化 client + mock
  console/                        # v0.2 现场控制台（Node + Agent SDK + 单页前端）
  examples/hongda-rehearsal/      # 模拟客户会议的全部产物（可复跑）
  docs/rehearsal/                 # 实录截图
```

安装：拷贝 `skills/fde-demo` 到 `.claude/skills/`，或
`/plugin marketplace add OpenFDEAI/FDEDemo`。

### 3.2 每次拜访一个工作区

```
demos/<客户>-<日期>/
  DEMO_SPEC.md        # 活的需求台账 —— 单一事实源（格式见 §6.2）
  TRANSCRIPT.md       # 转写流（v0.2）或 FDE 手敲要点（v0.1），增量消费
  CANDIDATES.md       # 开源候选短名单：repo/★/license/跑通成本/匹配度（§4.3）
  inputs/             # 客户当场给的截图、API 文档、数据导出
  app/                # Demo 本体（热更新中）
  decisions.jsonl     # 现场判断时刻 → 会后喂给 FDE Loop 做 INDUCE（§10）
```

## 4. 开源优先管线（v0.2 新增，核心理念）

**原则：复用 > 组装 > 生成。** 出 Demo 的每一步都按这个阶梯自上而下判断：

1. **复用**：有预验证的开源项目直接改（换主题、换术语、接 mock 数据）；
2. **组装**：没有现成项目，用 Demo Kit 预制模块拼（§8）；
3. **生成**：前两级都覆盖不了的，才从零写。

### 4.1 双时机：会前侦察 + 会中速搜

- **会前侦察**（主题已知时，重活在这里干）：深度搜索 GitHub / 成熟产品，
  clone 候选项目**跑通**，做最小品牌化改造，纳入画廊。会前 10 分钟的
  「品牌化底座」优先从这里出；
- **会中速搜**（聊出新需求时）：后台 subagent 并行搜 GitHub + Web，产出
  `CANDIDATES.md` 短名单供 FDE 一眼决策。**现场不 clone 陌生项目**——
  build 失败会烧掉 3 分钟回合预算；除非该项目已在画廊里预验证过。

### 4.2 参考成熟产品（含闭源）

「做图片设计参考稿定设计、做 ERP 参考某成熟模块」这类竞品映射写进
`references/oss-first.md` 的方法论：读参考产品的公开页面与截图，提取
**信息架构、页面结构、领域术语**；`firecrawl/open-lovable` 这类工具可把
参考网站直接转成可编辑的 React 骨架。规则：**只借结构与交互，不抄视觉资产**。

### 4.3 License 规则（CANDIDATES.md 必填字段)

- MIT / Apache-2.0 / BSD：可直接改造演示；
- AGPL / GPL：现场演示可以，进产品必须隔离，短名单里显式标红；
- 无 license：不碰。

### 4.4 Demo 画廊 = OpenFDE 的社区复利资产

按领域 curated 的「预验证开源 Demo 池」：每个条目 = 仓库 + 已跑通的启动
命令 + 品牌化适配点（theme.json 挂哪）+ 适配过的客户场景。每次拜访结束
回填画廊。个人手艺变成组织资产，这正是 OpenFDE 社区叙事里「根据地」的
具体形态之一——画廊本身就值得开源运营。

## 5. 交互设计：回合制节拍

Claude Code 是回合制的。「边聊边做」**不是**持续监听抢话，而是 **FDE 控制
节拍**：对话自然停顿处，点一下控制台的 [▶ 生成本回合]（v0.1 则是在 TUI 敲
一句要点）。这符合 FDE 的工作方式——agent 不该在客户说话时插嘴。

### 5.1 回合协议（每回合固定五步）

1. **摄取**：读 `TRANSCRIPT.md` 增量 + `inputs/` 新文件；
2. **查阶梯**：新需求先过开源优先阶梯（§4）——画廊有货？→ 复用路径；
   无货 → 后台 subagent 速搜进 `CANDIDATES.md`，本回合先用模块组装占位；
3. **先改 spec，再改代码**：新信息合并进 `DEMO_SPEC.md`，展示 diff。
   spec-first 是灵魂：转写有噪音、客户会反复，spec 是缓冲层；
   **transcript 永不直接驱动代码变更**；
4. **最小代码变更 + 截图自检**：应用改动，Playwright 截图确认渲染正常；
5. **一行总结**：输出一句 FDE 能直接念给客户听的话。

### 5.2 延迟预算

会前底座 ≤10 分钟；现场每回合 ≤3 分钟。超预算的需求先占位（假数据/静态页），
写进 spec「暂缓项」，会后补。宁可占位，不可让客户等。

### 5.3 现场物理布局（写进 SKILL.md checklist）

双屏：投屏只投 Demo + DEMO_SPEC 预览；FDE 自己看控制台/终端。客户永远只
看见结果的连续成形，不看见中间过程。

## 6. 现场工作流状态机

### 6.1 三个阶段

| 阶段 | 入口 | 动作 |
|------|------|------|
| 会前 | `/fde-demo start <客户名>` | 建工作区、起 dev server、开浏览器；**先查画廊选底座**（§4.1），无匹配则模板组装；摄取已有材料出品牌化底座 |
| 现场 | 控制台 [▶] 或 `/fde-demo turn` | 回合协议五步（§5.1） |
| 收尾 | `/fde-demo wrap` | 产出资产（G5）；spec 终版即需求确认单，当场让客户点头；**回填画廊**（§4.4） |

### 6.2 DEMO_SPEC.md 格式（单一事实源）

```markdown
# <客户> Demo Spec          <!-- 每回合更新，带时间戳的变更记录 -->
## 目标场景                  <!-- 一句话：给谁演示、证明什么 -->
## 底座与复用                <!-- 基于哪个开源项目/模板，license -->
## 角色与用户
## 数据源                    <!-- 哪些接真 API、哪些 mock、字段来源 -->
## 页面清单                  <!-- 每页一行：状态 done/wip/占位 -->
## 打动点                    <!-- 老板最想看到的那一屏，倒排优先级 -->
## 暂缓项                    <!-- 现场超预算的需求，会后补 -->
## 已确认 / 已否决           <!-- 客户当场的表态，含否决理由 -->
```

### 6.3 引导清单（references/elicit.md）

复用仓库 Elicitation Protocol 的方法论：截图里哪个环节最痛？谁在用这一屏？
数据从哪来？老板最想在哪一屏看到什么数字？「如果 Demo 只能演示一个功能，
您选哪个？」（逼出打动点）。v0.2 新增一问：「您现在用什么产品干这件事？
最像您想要的产品是哪个？」（逼出参考系，直接喂给 §4.2）。

## 7. 输入管线

### 7.1 截图 → 界面

多模态读图复刻布局与主题；**保留截图里的客户术语**（表头、按钮、字段名）
——术语对了，客户才觉得「这是我们的系统」。可借鉴 `abi/screenshot-to-code`
（73.4k★，MIT）的提示工程与管线设计。主色与 logo 写入 `theme.json`。

### 7.2 API / 数据样例 → 数据层（mock-first）

OpenAPI / curl 样例 / 数据导出 → 类型化 client + 同构 mock（返回与真实 API
相同 shape 的逼真假数据）。**默认走 mock**：客户内网 API 在会议室大概率
不通；有凭证且网络可达时一个环境变量切到真实 API。两条管线用并行 subagent
同时跑。

## 8. Demo Kit 模板库（阶梯第二级：组装）

```
templates/base/
  theme.json          # 客户品牌 token：主色、logo、字体、圆角
  data/               # faker 种子数据生成器，按领域参数化
  modules/            # 预制模块：dashboard / list-detail / approval-flow
                      #   / report / copilot-panel / admin(假登录+角色切换)
```

栈：Next.js 15 + Tailwind + shadcn，依赖预装（离线兜底）。无客户品牌时用
中性工业风，不用紫蓝渐变 AI 俗套。模板库自身也遵循复用优先：模块尽量从
成熟开源项目析取改造，而非手写。

## 9. 现场控制台（v0.2 核心交付）

**职责边界：控制台只做「耳朵和手」，不做「脑子」。** 四个功能，再多就是
在重造 Claude Code：

1. **录音控制**：开始 / 暂停按钮；`getUserMedia` 采音 → 本地 ASR
   （默认 FunASR，中文流式 + VAD + 标点；本地推理不上云）→ 转写流实时
   显示并落 `TRANSCRIPT.md`；
2. **回合触发**：[▶ 生成本回合] 把转写增量经 **Claude Agent SDK** session
   喂给 fde-demo skill（SDK 默认加载 `.claude/skills` 与项目配置）；流式
   显示回合进度与「一行总结」；工具审批回调在面板上点；
3. **自动展示**：回合完成自动刷新内嵌 demo iframe（或 `open` 新窗口）；
   旁边常驻 DEMO_SPEC 预览（这块投给客户）；
4. **候选项目面板**：`CANDIDATES.md` 的可视化，FDE 一眼看 ★/license/
   跑通成本，点选即把「基于 X 改造」写进下一回合输入。

实现策略（吃自己狗粮）：先评估 fork `The-Vibe-Company/companion`（MIT，
功能形态最接近：起会话、流式输出、工具审批）；若其代码面大于我们的需求面，
则自研薄面板（Node + Agent SDK + 单页前端，估计数百行），把 happy /
companion 当参考实现。`claudecodeui` 是 AGPL，只看模式不抄代码。

**逃生通道**：控制台任何环节失灵（ASR 崩了、SDK session 挂了），FDE 随时
回落到 v0.1 模式——同一工作区开 Claude Code TUI 手敲要点，工作流不中断。
现场演示必须有这条降级路径。

### 9.1 采音硬件方案

判断标准只有一条：**插上 Mac 后，系统「声音设置 → 输入」里能看到它，
就能进实时链路；看不到，就进不了。**

| 优先级 | 方案 | 判定 | 理由 |
|--------|------|------|------|
| 默认 | MacBook 内置麦克风阵列 | ✓ 先用它 | 1v1 / 1v2 小会议室够用；零成本零摩擦，v0.2 验证链路就用它，别急着买设备 |
| 推荐升级 | 双发射器无线领夹麦（DJI Mic 2 / Mic Mini 类），FDE 与客户各佩一个 | ✓ 正解 | 接收器 USB-C 插 Mac 即标准 USB 音频输入设备，控制台直接选为输入源；**立体声模式下两个发射器分左右声道 = 硬件级说话人分离**（左=FDE，右=客户），软件 diarization 可推迟甚至免去；2.4GHz 专有链路非蓝牙 HFP，音质稳；客户佩麦本身就是明示的录音同意，合规加分 |
| 多人圆桌兜底 | 全向 USB 会议麦（Jabra 类） | ✓ 可选 | 即插即用 USB 声卡；但无声道分离，说话人归属退回软件方案 |
| 不采用（现场） | Plaud / 飞书录音豆类 AI 录音设备 | ✗ 实时链路 | 架构是「本机录音 → App 同步 → 云端转写」闭环，**没有实时 USB 麦克风模式**，转写事后才拿到，接不进「边聊边做」；且云端转写与「本地不上云」红线冲突。**可作会后资产**：备份录音 + 官方纪要与 TRANSCRIPT.md 交叉验证、喂 INDUCE——用它必须另行征得客户同意 |
| 不采用 | 手持采访麦 | ✗ | FDE 双手要操作控制台；手持麦制造「采访感」，破坏平等对话氛围；单通道无分离 |
| 不采用 | 普通蓝牙耳机麦 | ✗ | 蓝牙 HFP 通话协议是窄带音质，ASR 错误率高。要点不是「蓝牙好不好」，是「是否以标准音频输入设备呈现」 |

## 10. 与 FDE Loop 的战略咬合

这个 skill 是 FDE Loop 的**采集入口**：

- `TRANSCRIPT.md` + `DEMO_SPEC.md` 逐回合 diff = OBSERVE + ELICIT 的素材；
- `decisions.jsonl` 记录判断时刻：客户在哪个点眼睛亮了、哪个方案被否及
  理由、FDE 为何这样取舍、**选了哪个开源底座为什么**——会后喂给 INDUCE
  产出 Judgment Unit；
- Demo 是当场交付物，Judgment Unit + 画廊回填是留下来的资产。每次拜访
  都在为组织沉淀可复用的判断与弹药——落在「结果绑定」护城河论点上。

```json
{"ts": "...", "kind": "customer_signal | rejection | fde_call | oss_pick",
 "moment": "客户看到优先级看板时明显兴奋",
 "why": "他们现在靠人肉 Excel 排序", "spec_ref": "打动点#1"}
```

## 11. 路线图与验收

| 版本 | 范围 | 验收标准 |
|------|------|----------|
| **v0.1**（1–2 天） | Skill 底座 + 手敲节拍：工作区脚手架、回合协议（含开源阶梯步骤）、截图/API 摄取、mock 数据层、截图自检、收尾产出、速搜 subagent + CANDIDATES.md、画廊索引格式 + 首批 2–3 个预验证条目 | 本仓库跑一场 20 分钟「模拟客户会议」：3 张截图 + 1 份 OpenAPI + 手敲 6 条要点 → 可点击 Demo + spec 确认单，其中至少一个需求走「基于画廊项目改造」路径 |
| **v0.2**（3–5 天） | 现场控制台：录音开始/暂停 → FunASR 本地转写 → [▶] 经 Agent SDK 触发回合 → demo iframe 自动刷新；候选项目面板；TUI 降级通道 | 同上流程，FDE 全程只说话 + 点按钮，不碰键盘（应急除外） |
| **v0.3** | 画廊机制化（回填流程 + 按领域扩充）、decisions.jsonl → INDUCE 集成、Vercel 一键预览、说话人分离（优先走双通道领夹麦硬件方案 §9.1，软件 whisperX 仅作内置麦兜底） | 收尾 5 分钟内客户拿到可访问 URL；一次拜访产出 ≥1 个 draft JU + ≥1 条画廊回填 |

## 12. 风险与对策

| 风险 | 对策 |
|------|------|
| 现场断网 | 手机热点；模型 API 是唯一硬依赖，其余全部本地（ASR 本地、mock-first、依赖预装） |
| 现场 clone 陌生项目翻车 | 铁律：现场只用画廊里预验证的项目；陌生项目只进短名单不进工作区 |
| 开源 license 污染 | §4.3 规则 + CANDIDATES.md 必填 license 字段 + AGPL 标红 |
| 控制台现场失灵 | §9 逃生通道：随时回落 TUI 手敲模式 |
| 转写噪音 / 中英混杂 | spec-first 缓冲；transcript 永不直接驱动代码 |
| 回合超时冷场 | ≤3 分钟预算 + 占位策略 + FDE 有台词可念 |
| 投屏暴露中间过程 | 双屏布局：投 Demo + spec，控制台留在 FDE 屏 |
| 录音合规 | 会前告知客户 + 本地转写不上云，写进 SKILL.md 强制检查项 |
| Demo 被当成承诺 | spec 里「暂缓项 / mock 标注」当场明示哪些是假的 |

## 13. 开放问题（评审时请拍板）

1. ~~控制台起点~~ **已定并交付**：自研薄面板（`console/`，Node + ws +
   Agent SDK + 原生单页前端）；skill 已迁出为独立仓库 `OpenFDEAI/FDEDemo`，
   实测同时通过 Claude Code 与 OpenFDE runtime 两套校验。
2. **ASR 选型确认**：默认 FunASR（中文主场，MIT），whisper.cpp 备选；
   说话人分离（whisperX）放 v0.3 是否可接受？
3. **画廊首批领域**：先铺哪 2–3 个领域的预验证项目？（建议从最近实际
   客户管线倒推，如：报表/BI、工单、图片生成类。）
4. **模板栈确认**：Next.js 15 + shadcn 是否定稿？是否需要无 Node 的纯静态
   兜底模板？
5. **收尾部署**：Vercel 预览链接 v0.3 才做？mock 字段名出外网是否需要
   脱敏开关？
6. **文档语言**：定稿后出英文版（仓库惯例英文为主），SKILL.md 本体直接
   写英文、示例双语——是否同意？

---

## 附录 A · GitHub 调研清单（2026-07 实查）

**最重要的发现：搜不到成气候的「demo agent / demo skill」开源项目**——
「FDE 现场边聊边出 Demo」这个品类基本空白。相邻品类的轮子很全（正好复用），
但组合成 FDE 工作流的没有。这既验证了本方案没有现成替代品，也是 OpenFDE
的机会窗口。

| 方向 | 项目 | ★ | License | 与本方案的关系 |
|------|------|----|---------|----------------|
| 直接对标 | —（未发现） | — | — | 品类空白，机会窗口 |
| 截图→代码 | abi/screenshot-to-code | 73.4k | MIT | §7.1 摄取管线参考，可析取复用 |
| | leigest519/ScreenCoder | 2.9k | Apache-2.0 | 同上，可编辑 HTML/CSS 输出 |
| App builder | dyad-sh/dyad | — | 开源 | 本地 AI app builder，Demo Kit 参考 |
| | stackblitz-labs/bolt.diy | — | MIT | 自托管 Bolt，生成管线参考 |
| | firecrawl/open-lovable | — | MIT | **参考产品网站 → 可编辑 React**，直接服务 §4.2 |
| 语音→Claude Code | mbailey/voicemode | 1.3k | MIT | MCP 插件路线；whisper.cpp 本地 + 静音检测 |
| ASR 引擎 | modelscope/FunASR | 19.5k | MIT | 控制台默认引擎：中文流式 + VAD + 标点 |
| | m-bain/whisperX | 23.2k | BSD-2 | 词级时间戳 + 说话人分离（v0.3） |
| | openai/whisper | 105.5k | MIT | 英文场景基线 |
| Claude Code 客户端 | slopus/happy | 22.8k | MIT | Web/移动客户端 + 实时语音；控制台最强先例 |
| | The-Vibe-Company/companion | 2.4k | MIT | 起会话/流式输出/工具审批；候选 fork 起点 |
| | siteboon/claudecodeui | 12.9k | AGPL-3.0 | 模式佐证；**AGPL 只看不抄** |
| 官方 SDK | Claude Agent SDK（TS/Python） | 官方 | — | §9「自动输入」正解：同一 agent loop，加载 skills，流式输入，多轮 session |

（★ 数为 2026-07 实查快照；「开源」= license 未逐一核对，使用前须确认。）
