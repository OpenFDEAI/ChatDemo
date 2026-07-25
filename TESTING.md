# fde-demo 测试回归手册

两层：自动化回归（每次改动必跑）+ 模拟客户会议（发布前/大改后必跑）。

## 1. 自动化回归

```bash
# ① ingest 脚本单测（仓库根）
npm install && npm test

# ② 控制台单测 + typecheck（书签/回合队列/mock 适配器 e2e/ASR）
cd console && npm install && npm test

# ③ 模板底座可构建
cd skills/fde-demo/templates/base && npm install && npm run build
```

全绿才算过。②③ 都不需要网络之外的外部服务，不需要 API key。

## 2. 模拟客户会议（20 分钟，DESIGN.md v0.1 验收）

> 2026-07-25 已执行一次并验收通过，带截图的全程实录见 REHEARSAL.md，
> 产物在仓库 examples/hongda-rehearsal/。以下为可重复执行的标准流程。

材料准备（`examples/<名称>/inputs/`，参考已执行的 `examples/hongda-rehearsal/`）：3 张任意企业系统截图 + 1 份
OpenAPI（可用 `test/ingest.test.ts` 里的 tickets 样例落盘）。

流程（Claude Code TUI 模式，不依赖控制台）：

1. `start`：「为 演练客户 开一场 demo session」→ 验收：10 分钟内 dev server
   起来、浏览器可见品牌化底座、DEMO_SPEC.md 初版生成；
2. `turn` × 6：依次手敲 6 条要点（建议直接用
   `references/scenarios.md` 剧本 1 的节拍：字段替换 → SLA 着色 → 建议
   派单 → 老板驾驶舱 → 下钻 → 角色切换）→ 每回合验收四件事：
   spec 先有 diff、代码变更可见、截图自检通过、输出了一行可念的总结；
   全程回合 ≤3 分钟，超时必须走占位 + 暂缓项；
3. 期间至少制造一次「客户否决」（如：老板驾驶舱不要图表要数字）→
   验收：已否决 + 理由进 spec，decisions.jsonl 有 rejection 行；
4. `wrap`：验收：spec 终版无 wip 悬空项、WALKTHROUGH.md 生成、
   decisions.jsonl ≥3 行、画廊回填有更新。

## 3. 控制台联调（v0.2 验收，需要 API key / FunASR 时）

1. mock 链路（无外部依赖）：
   `npx tsx src/server.ts --workspace ../examples/hongda-rehearsal --adapter mock`
   → 浏览器 localhost:4321：手动输入两条要点 → [▶ 生成本回合] →
   验收：spec 面板刷新、事件流以 done 结尾、demo iframe 自动刷新；
2. claude 链路：`--adapter claude`（需已登录 Claude Code）→ 同上流程，
   验收回合协议五步在事件流里可见；
3. 语音链路：本地起 FunASR 服务后 `--asr funasr` → 对麦克风说话 →
   验收：转写流出现文本、暂停键立即停止采音；FunASR 未启动时 →
   验收：录音卡片置灰给原因、手动输入可用（逃生通道）。

## 4. 已知边界

- 模型 API 是唯一硬网络依赖（DESIGN.md §2.1）；
- 现场铁律回归点：转写永不直接驱动代码（spec-first）、现场不 clone
  画廊外项目、mock 数据在 spec 里明示。
