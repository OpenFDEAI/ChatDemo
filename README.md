# FDE chat2demo — 聊出 Demo

**chat2demo: the demo builds while you talk. An on-site workflow for Forward Deployed Engineers, powered by Claude Code & Codex.**

FDE 坐在客户对面，边聊需求边让 Demo 逐步成形：客户的截图和 API 丢进去，
对话的每个停顿处按一下「生成」，3 分钟内一个可见的界面增量。客户当场看到
「你们听懂了、而且做出来了」。

![演练：超时报修单红色置顶](docs/rehearsal/03-r2-overdue-pinned.png)

> 上图来自一场 20 分钟的[模拟客户会议全程实录](REHEARSAL.md)：6 个回合、
> 一次客户否决、一次超预算、四个当场抓出的问题——全部如实记录。

## 它是什么

- **一个 Claude Code Skill**（`skills/fde-demo/`）：把 FDE 现场工作流固化为
  start / turn / wrap 状态机，六条铁律（spec 先行、复用>组装>生成、
  3 分钟回合、截图自检、客户术语、假数据明示）；
- **一个现场控制台**（`console/`）：录音 → 本地转写 → 一键触发回合
  （Claude Agent SDK）→ Demo 自动刷新，带手动输入逃生通道；
- **一套 Demo 模板底座**（`skills/fde-demo/templates/base/`）：Next.js 15，
  `theme.json` 一个文件完成品牌化换肤换术语；
- **一个开源画廊**（`skills/fde-demo/gallery/`）：预验证的开源项目池——
  现场只用跑通过的项目，每次拜访回填，长成社区资产；
- **10 个现场场景剧本**（`skills/fde-demo/references/scenarios.md`）：
  工单、BI、小红书图文、批量设计、客服知识库、合同审查、简历筛选、
  质检、进销存、私域分层——每个带回合节拍与「惊艳点」设计。

## 快速开始

**方式零：一条命令拉起全套（推荐的现场姿势）**

```bash
# 一次性准备：
git clone https://github.com/OpenFDEAI/FDEDemo.git && cd FDEDemo && npm link

# 之后每次拜访客户：新建一个文件夹（VS Code 打开），终端里敲：
fde-demo
```

这条命令会在当前文件夹自动完成：建工作区骨架（spec / transcript / inputs）→
拷贝模板 app 并装依赖（仅首次）→ 起 Demo dev server（自动找空闲端口）→
起现场控制台（自动找空闲端口）→ 自动选可用引擎（claude → codex → mock）→
打开浏览器。然后就是现场三件事：**拖材料进面板、说话/敲要点、点 ▶ 生成回合**；
右列是 Demo 预览，点 URL ↗ 新窗口打开完整页面投屏。Ctrl-C 一键全退。

不想 npm link 的话等价写法：`node /path/to/FDEDemo/bin/fde-demo.mjs`。
录音需要本地 FunASR（`fde-demo --asr funasr`），没有它手动输入始终可用。

**方式一：作为 Claude Code Skill（最简）**

```bash
git clone https://github.com/OpenFDEAI/FDEDemo.git
cp -r FDEDemo/skills/fde-demo ~/.claude/skills/   # 或项目内 .claude/skills/
# Claude Code 里：给它客户截图 + API 文档，说"为 <客户> 开一场 demo session"
```

**方式二：作为 Plugin**

```
/plugin marketplace add OpenFDEAI/FDEDemo
/plugin install fde-demo
```

**方式三：在 Codex 中使用**

```bash
git clone https://github.com/OpenFDEAI/FDEDemo.git && cd FDEDemo
codex   # AGENTS.md 会引导 Codex 加载 skills/fde-demo/SKILL.md 工作流
# 截图用 -i 附带：codex -i 客户截图.png "为 <客户> 开一场 demo session"
```

方法论、模板、摄取脚本与 Codex 完全通用（AGENTS.md 是 Codex 原生机制）。

**方式四：带现场控制台（录音 → 转写 → 一键回合，claude / codex 双引擎）**

```bash
cd FDEDemo/console && npm install
npm start -- --workspace ../examples/my-visit          # mock 模式，无需 API key
npm start -- --workspace ../examples/my-visit --adapter claude --asr funasr
npm start -- --workspace ../examples/my-visit --adapter codex   # Codex 引擎
# 打开 http://localhost:4321；面板上可在 claude / codex / mock 间运行时切换，
# 回合协议共享、状态在工作区文件，切换不丢上下文（一场会议中途也能换引擎）
```

## 回合协议（工作流的核心）

每个回合固定五步，预算 3 分钟：

1. **摄取**：读对话增量（转写或手敲要点）+ 新材料（截图 / API 文档）；
2. **查阶梯**：复用（画廊）> 组装（模板模块）> 生成（最后手段）；
3. **先改 spec 再改代码**：`DEMO_SPEC.md` 是单一事实源，转写永不直接驱动代码；
4. **最小变更 + 截图自检**：投到幕布上的界面永远不能是坏的；
5. **一行总结**：FDE 能直接念给客户听的一句话。

超预算就占位并记入「暂缓项」——宁可占位，不可让客户等。

## 文档

| 文档 | 内容 |
|---|---|
| [REHEARSAL.md](REHEARSAL.md) | 20 分钟模拟客户会议全程实录（带截图与翻车记录） |
| [DESIGN.md](DESIGN.md) | 完整设计方案：形态决策、开源优先管线、控制台架构、调研附录 |
| [TESTING.md](TESTING.md) | 自动化回归 + 模拟客户会议验收手册 |
| [skills/fde-demo/SKILL.md](skills/fde-demo/SKILL.md) | Skill 本体（工作流状态机） |
| [examples/hongda-rehearsal/](examples/hongda-rehearsal/) | 演练产物：spec 终版、台词稿、判断记录、可复跑的 app |

## 现状与路线（诚实版）

- ✅ v0.1 skill 全量 + v0.2 控制台已实现；回归全绿（ingest 4/4、控制台 22/22、
  模板 build ✓）；20 分钟模拟会议验收通过；
- ✅ 双引擎：控制台支持 claude / codex 运行时切换（codex 链路已用
  codex-cli 0.145.0 真机端到端验证：真实回合改动工作区文件并正常收尾）；
- 🕓 待实测：控制台 `--adapter claude` 真机链路、FunASR 语音链路、
  画廊 refine/tremor/open-lovable 条目跑通；
- 🔜 v0.3：画廊机制化、`decisions.jsonl` → FDE Loop（[OpenFDE](https://github.com/Open-FDE/OpenFDE)
  的 Judgment Unit 采集入口）、说话人分离（双通道领夹麦方案）。

## License

MIT © OpenFDE
