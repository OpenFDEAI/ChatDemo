/**
 * 真实适配器：经官方 Claude Agent SDK 驱动 Claude Code（DESIGN.md §2.2②、§9②）。
 *
 * - 动态 import('@anthropic-ai/claude-agent-sdk')，用 query({prompt, options:{cwd}}) 起回合；
 * - SDK 消息流映射为 TurnEvent；
 * - prompt 模板要求执行 fde-demo skill 的回合协议：
 *   读增量 → 先改 DEMO_SPEC.md 再改代码 → 截图自检 → 输出一行总结；
 * - SDK 缺失 / 未认证时发 error 事件并给出降级指引（回落 TUI，工作流不中断）。
 */

import type { AgentAdapter, TurnEvent, TurnInput } from '../turn.js';

const FALLBACK_HINT =
  '降级路径：在同一工作区目录直接运行 `claude`（Claude Code TUI），手敲要点继续回合，工作流不中断。';

interface SdkQueryArgs {
  prompt: string;
  options?: Record<string, unknown>;
}

interface SdkModule {
  query(args: SdkQueryArgs): AsyncIterable<Record<string, unknown>>;
}

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

function* mapSdkMessage(message: Record<string, unknown>): Generator<TurnEvent> {
  const type = message.type;
  if (type === 'system') {
    if (message.subtype === 'init') {
      const model = typeof message.model === 'string' ? message.model : 'unknown';
      yield { type: 'status', message: `Claude Code 会话就绪（model: ${model}）` };
    }
    return;
  }
  if (type === 'assistant') {
    const inner = message.message as { content?: unknown } | undefined;
    const content = Array.isArray(inner?.content) ? (inner.content as Array<Record<string, unknown>>) : [];
    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        yield { type: 'text', text: block.text };
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        let detail = '';
        try {
          detail = JSON.stringify(block.input ?? {}).slice(0, 200);
        } catch {
          detail = '';
        }
        yield { type: 'tool', name: block.name, ...(detail ? { detail } : {}) };
      }
    }
    return;
  }
  // 其余消息类型（user / stream_event 等）对面板无意义，忽略。
}

export class ClaudeAdapter implements AgentAdapter {
  async *run(input: TurnInput): AsyncIterable<TurnEvent> {
    let sdk: SdkModule;
    try {
      sdk = (await import('@anthropic-ai/claude-agent-sdk')) as unknown as SdkModule;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error',
        message:
          `无法加载 @anthropic-ai/claude-agent-sdk：${message}。` +
          `请在 console/ 目录执行 npm install 并确认 Claude Code 已认证（运行过 \`claude\` 登录或设置 ANTHROPIC_API_KEY）。${FALLBACK_HINT}`,
      };
      return;
    }

    yield { type: 'status', message: '启动 Claude Code 回合…' };
    try {
      const stream = sdk.query({
        prompt: buildTurnPrompt(input),
        options: {
          cwd: input.workspace,
          // 现场回合需要免交互地改 spec 与代码。
          permissionMode: 'acceptEdits',
          // 加载用户/项目级 .claude 配置与 skills（含 fde-demo）。
          settingSources: ['user', 'project'],
        },
      });
      let finished = false;
      for await (const message of stream) {
        if (message.type === 'result') {
          finished = true;
          const subtype = typeof message.subtype === 'string' ? message.subtype : 'unknown';
          if (subtype === 'success' && message.is_error !== true) {
            const result = typeof message.result === 'string' ? message.result : '';
            const lines = result
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            yield { type: 'summary', summary: lines.at(-1) ?? '回合完成。' };
            yield { type: 'done' };
          } else {
            yield {
              type: 'error',
              message: `Claude 回合未成功（${subtype}）。${FALLBACK_HINT}`,
            };
          }
          break;
        }
        yield* mapSdkMessage(message);
      }
      if (!finished) {
        yield { type: 'error', message: `Claude 回合意外中断（未收到 result）。${FALLBACK_HINT}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'error',
        message:
          `Claude 回合失败：${message}。请确认已认证（运行 \`claude\` 登录或设置 ANTHROPIC_API_KEY）、网络可达。${FALLBACK_HINT}`,
      };
    }
  }
}
