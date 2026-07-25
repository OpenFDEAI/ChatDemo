/**
 * Codex 适配器：子进程驱动 `codex exec --json`（DESIGN.md §9.2②）。
 *
 * - 每回合一个独立进程，`--cd <工作区>` + `--sandbox workspace-write`
 *   （默认断网；npm install 类重活属于会前，回合内只改文件）；
 * - JSONL 事件流映射为 TurnEvent。事件形状以 codex-cli 0.145.0 实测为准：
 *     {"type":"thread.started","thread_id":...}
 *     {"type":"item.completed","item":{"type":"agent_message","text":...}}
 *     {"type":"item.completed","item":{"type":"command_execution","command":...}}
 *     {"type":"item.completed","item":{"type":"file_change","changes":[{path,kind}]}}
 *     {"type":"turn.completed","usage":{...}} / {"type":"turn.failed","error":{...}}
 *   未知类型一律忽略——解析必须防御性，CLI 升级不应打崩控制台；
 * - codex 未安装 / 回合失败时发 error 事件并给降级指引（回落 TUI）。
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentAdapter, TurnEvent, TurnInput } from '../turn.js';
import { buildTurnPrompt } from './prompt.js';

const FALLBACK_HINT =
  '降级路径：在同一工作区目录直接运行 `codex`（或 `claude`），手敲要点继续回合，工作流不中断。';

interface CodexItem {
  type?: string;
  text?: string;
  command?: string;
  exit_code?: number;
  status?: string;
  changes?: Array<{ path?: string; kind?: string }>;
  message?: string;
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: CodexItem;
  error?: { message?: string };
}

function summarizeChanges(changes: CodexItem['changes']): string {
  if (!Array.isArray(changes) || changes.length === 0) return '';
  return changes
    .map((c) => `${c.kind ?? 'edit'} ${(c.path ?? '').split('/').slice(-2).join('/')}`)
    .join(', ')
    .slice(0, 200);
}

/** 单条 JSONL 事件 → 面板事件；返回 null 表示忽略。导出以便单测。 */
export function mapCodexEvent(
  event: CodexEvent,
): { event: TurnEvent | null; lastMessage?: string; failed?: string } {
  switch (event.type) {
    case 'thread.started':
      return {
        event: { type: 'status', message: `Codex 会话就绪（thread ${event.thread_id ?? '?'}）` },
      };
    case 'item.completed': {
      const item = event.item ?? {};
      if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
        return { event: { type: 'text', text: item.text }, lastMessage: item.text };
      }
      if (item.type === 'command_execution') {
        const detail = `${item.command ?? ''}`.slice(0, 200);
        return { event: { type: 'tool', name: 'shell', ...(detail ? { detail } : {}) } };
      }
      if (item.type === 'file_change') {
        const detail = summarizeChanges(item.changes);
        return { event: { type: 'tool', name: 'file_change', ...(detail ? { detail } : {}) } };
      }
      if (item.type === 'error') {
        return { event: null, failed: item.message ?? 'Codex 报告了一个错误' };
      }
      return { event: null };
    }
    case 'turn.failed':
      return { event: null, failed: event.error?.message ?? 'Codex 回合失败' };
    default:
      // turn.started / item.started / turn.completed（usage）等对面板无意义。
      return { event: null };
  }
}

export class CodexAdapter implements AgentAdapter {
  constructor(private readonly bin: string = process.env.FDE_CODEX_BIN ?? 'codex') {}

  async *run(input: TurnInput): AsyncIterable<TurnEvent> {
    yield { type: 'status', message: '启动 Codex 回合…' };

    const child = spawn(
      this.bin,
      [
        'exec',
        '--json',
        '--cd',
        input.workspace,
        '--sandbox',
        'workspace-write',
        '--skip-git-repo-check',
        buildTurnPrompt(input),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let spawnError: Error | null = null;
    child.on('error', (err) => {
      spawnError = err;
    });

    let stderrTail = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-500);
    });

    let lastMessage = '';
    let failed: string | null = null;

    const lines = createInterface({ input: child.stdout });
    for await (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      let parsed: CodexEvent;
      try {
        parsed = JSON.parse(trimmed) as CodexEvent;
      } catch {
        continue;
      }
      const mapped = mapCodexEvent(parsed);
      if (mapped.lastMessage) lastMessage = mapped.lastMessage;
      if (mapped.failed) failed = mapped.failed;
      if (mapped.event) yield mapped.event;
    }

    const exitCode = await new Promise<number | null>((resolve) => {
      if (spawnError) {
        resolve(null);
        return;
      }
      child.on('close', (code) => resolve(code));
      if (child.exitCode !== null) resolve(child.exitCode);
    });

    if (spawnError) {
      const reason = (spawnError as NodeJS.ErrnoException).code === 'ENOENT'
        ? `未找到 codex CLI（${this.bin}）。请安装：npm install -g @openai/codex，并完成登录。`
        : `无法启动 codex：${(spawnError as Error).message}。`;
      yield { type: 'error', message: `${reason}${FALLBACK_HINT}` };
      return;
    }

    if (failed !== null || exitCode !== 0) {
      const detail = failed ?? (stderrTail.trim() || `退出码 ${exitCode}`);
      yield { type: 'error', message: `Codex 回合未成功：${detail}。${FALLBACK_HINT}` };
      return;
    }

    const lines2 = lastMessage
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    yield { type: 'summary', summary: lines2.at(-1) ?? '回合完成。' };
    yield { type: 'done' };
  }
}
