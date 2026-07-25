import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexAdapter, mapCodexEvent } from '../src/adapters/codex.js';
import type { TurnEvent, TurnInput } from '../src/turn.js';

function fakeBin(dir: string, script: string): string {
  const bin = join(dir, 'fake-codex');
  writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

async function collect(adapter: CodexAdapter, input: TurnInput): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of adapter.run(input)) events.push(event);
  return events;
}

const INPUT: TurnInput = { workspace: tmpdir(), transcriptDelta: '客户要工单列表' };

test('codex 成功回合：JSONL 事件映射 + 末条 agent_message 末行为总结 + done 收尾', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fde-codex-'));
  // 事件形状取自 codex-cli 0.145.0 实测（DESIGN.md §9.2②）。
  const bin = fakeBin(
    dir,
    `cat <<'JSONL'
{"type":"thread.started","thread_id":"t-1"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"i0","type":"agent_message","text":"先改 DEMO_SPEC.md。"}}
{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"ls app/","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"i2","type":"file_change","changes":[{"path":"/ws/app/page.tsx","kind":"edit"}],"status":"completed"}}
{"type":"item.completed","item":{"id":"i3","type":"agent_message","text":"改完了。\\n工单列表已按优先级着色"}}
{"type":"turn.completed","usage":{"input_tokens":1}}
JSONL`,
  );
  const events = await collect(new CodexAdapter(bin), INPUT);
  assert.deepEqual(
    events.map((e) => e.type),
    ['status', 'status', 'text', 'tool', 'tool', 'text', 'summary', 'done'],
  );
  const summary = events.find((e) => e.type === 'summary');
  assert.equal(summary && 'summary' in summary ? summary.summary : '', '工单列表已按优先级着色');
  const tools = events.filter((e): e is Extract<TurnEvent, { type: 'tool' }> => e.type === 'tool');
  assert.deepEqual(
    tools.map((t) => t.name),
    ['shell', 'file_change'],
  );
});

test('codex 退出码非零：error 事件、无 done、带降级指引', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fde-codex-'));
  const bin = fakeBin(dir, 'echo "stream error: 429 rate limited" >&2; exit 3');
  const events = await collect(new CodexAdapter(bin), INPUT);
  const last = events.at(-1);
  assert.equal(last?.type, 'error');
  assert.match(last && 'message' in last ? last.message : '', /429 rate limited|退出码 3/);
  assert.match(last && 'message' in last ? last.message : '', /降级路径/);
  assert.equal(events.some((e) => e.type === 'done'), false);
});

test('codex turn.failed：error 事件、无 done', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fde-codex-'));
  const bin = fakeBin(
    dir,
    `cat <<'JSONL'
{"type":"thread.started","thread_id":"t-2"}
{"type":"turn.failed","error":{"message":"model overloaded"}}
JSONL`,
  );
  const events = await collect(new CodexAdapter(bin), INPUT);
  const last = events.at(-1);
  assert.equal(last?.type, 'error');
  assert.match(last && 'message' in last ? last.message : '', /model overloaded/);
  assert.equal(events.some((e) => e.type === 'done'), false);
});

test('codex 未安装（ENOENT）：error 事件给出安装指引', async () => {
  const events = await collect(new CodexAdapter('/nonexistent/codex-bin'), INPUT);
  const last = events.at(-1);
  assert.equal(last?.type, 'error');
  assert.match(last && 'message' in last ? last.message : '', /未找到 codex CLI/);
});

test('mapCodexEvent：未知事件与噪音行被忽略', () => {
  assert.equal(mapCodexEvent({ type: 'turn.started' }).event, null);
  assert.equal(mapCodexEvent({ type: 'item.started', item: { type: 'file_change' } }).event, null);
  assert.equal(mapCodexEvent({ type: 'something.new' }).event, null);
  const err = mapCodexEvent({ type: 'item.completed', item: { type: 'error', message: 'boom' } });
  assert.equal(err.failed, 'boom');
});
