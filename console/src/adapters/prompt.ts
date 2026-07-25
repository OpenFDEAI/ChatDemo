/**
 * 回合协议 prompt——claude / codex 两引擎共享（DESIGN.md §9.2③）。
 *
 * 协议是协议，不是引擎特性：把回合协议完整写进 prompt，控制台路径就不
 * 依赖任一引擎的 skill / AGENTS.md 发现机制。
 */

import type { TurnInput } from '../turn.js';

export function buildTurnPrompt(input: TurnInput): string {
  const delta = input.transcriptDelta.trim();
  const note = input.note?.trim();
  return [
    '你正在执行 fde-demo skill 的「现场回合协议」（回合制：摄取 → 查开源阶梯 → 先改 spec 再改代码 → 截图自检 → 一行总结）。当前目录即本次拜访的工作区。',
    '',
    '本回合输入（TRANSCRIPT.md 未消费增量）：',
    '<transcript_delta>',
    delta || '（无新增转写）',
    '</transcript_delta>',
    '',
    'FDE 备注：',
    note || '（无）',
    '',
    '请严格按回合协议执行：',
    '1. 摄取：结合上述增量与 inputs/ 下的新材料理解需求；',
    '2. 先改 DEMO_SPEC.md 再改代码：把新需求合并进对应区块（尤其「页面清单」）；transcript 有噪音，永不直接驱动代码变更，以 spec 为准；',
    '3. 最小代码变更：在 app/ 内做能让客户「看得见」的最小改动；单回合预算 ≤3 分钟，超预算的需求写进 spec「暂缓项」并用占位（假数据/静态页）顶上；',
    '4. 截图自检：若环境可用（如 Playwright），截图确认渲染正常；不可用则说明跳过原因；',
    '5. 最后单独输出一行总结：一句 FDE 能直接念给客户听的话，作为你回复的最后一行。',
  ].join('\n');
}
