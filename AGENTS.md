# FDEDemo — Codex 运行说明

本仓库是「边聊边出 Demo」的 FDE 现场工作流。**开始任何工作前，先完整阅读
`skills/fde-demo/SKILL.md` 并严格按其执行**——它是唯一权威的工作流定义
（start / turn / wrap 三阶段状态机）。本文件只做入口指引。

## 铁律速记（详见 SKILL.md，冲突时以 SKILL.md 为准）

1. spec 先行：一切变更先进 `DEMO_SPEC.md` 再进代码，对话记录永不直接驱动代码；
2. 复用 > 组装 > 生成：先查 `skills/fde-demo/gallery/`，再拼
   `skills/fde-demo/templates/base` 模块，从零写是最后手段；现场不 clone
   画廊之外的陌生项目；
3. 每回合 ≤3 分钟，超预算就占位并记入 spec 暂缓项；
4. 每次代码变更后截图自检（可用无头浏览器），坏界面不许出现在投屏上；
5. 界面术语跟客户走（从截图与对话中摄取），面向客户的输出一律中文；
6. mock 数据与暂缓项在 spec 中明示，Demo 不得被误当交付承诺。

## 工作区约定

每次客户拜访一个目录：`examples/<客户>-<日期>/`，内含 DEMO_SPEC.md /
TRANSCRIPT.md / CANDIDATES.md / inputs/ / app/ / decisions.jsonl。
已执行的完整范例见 `examples/hongda-rehearsal/`。

## 在其他项目中使用

把 `skills/fde-demo/` 目录与本文件拷到目标工作区根目录即可，SKILL.md 内
所有引用均为相对路径、自包含。

## 已知限制（Codex）

- `console/` 现场控制台的回合驱动目前只有 Claude Agent SDK 适配器
  （`--adapter claude`）和 mock 适配器；Codex 适配器（走 `codex exec` 或
  `@openai/codex-sdk`）尚未实现——接口已预留在
  `console/src/turn.ts` 的 `AgentAdapter`。在 Codex 中请直接以对话回合制
  使用本工作流（FDE 在停顿处输入要点）。
