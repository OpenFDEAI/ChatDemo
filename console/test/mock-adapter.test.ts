/**
 * mock 适配器端到端：喂两条要点 → DEMO_SPEC.md 被更新、
 * 事件序列以 done 结尾、书签前移、app/ 出现占位变更。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../src/session.js';
import { TurnRunner } from '../src/turn.js';
import { MockAdapter, extractPoints } from '../src/adapters/mock.js';

test('mock 端到端：两条要点 → spec 更新 + done 收尾 + 书签前移 + 占位变更', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fde-console-mock-'));
  try {
    const ws = path.join(root, 'acme');
    const session = new Session(ws);
    await session.init();

    await session.appendTranscript('订单列表页要能按状态筛选');
    await session.appendTranscript('老板要一个总览大屏');

    const runner = new TurnRunner(session, new MockAdapter());
    const result = await runner.enqueue('优先做大屏').done;

    // 事件序列
    assert.equal(result.ok, true);
    const types = result.events.map((e) => e.type);
    assert.equal(types.at(-1), 'done', '事件序列以 done 结尾');
    assert.ok(types.includes('status'));
    assert.ok(types.includes('text'));
    assert.ok(types.includes('summary'));
    assert.ok(
      types.indexOf('summary') < types.indexOf('done'),
      'summary 在 done 之前',
    );

    // DEMO_SPEC.md 页面清单被合并（备注也进来了）
    const spec = await session.readSpec();
    const pagesIdx = spec.indexOf('## 页面清单');
    assert.ok(pagesIdx >= 0);
    const nextHeading = spec.indexOf('\n## ', pagesIdx + 1);
    const pagesSection = spec.slice(pagesIdx, nextHeading === -1 ? spec.length : nextHeading);
    assert.match(pagesSection, /订单列表页要能按状态筛选/);
    assert.match(pagesSection, /老板要一个总览大屏/);
    assert.match(pagesSection, /优先做大屏/);
    assert.match(pagesSection, /\[wip\]/);

    // 书签前移：增量已消费
    assert.equal((await session.readDelta()).text, '');

    // app/ 占位变更文件
    const placeholder = await fs.readFile(path.join(ws, 'app', 'mock-changes.md'), 'utf8');
    assert.match(placeholder, /订单列表页要能按状态筛选/);
    assert.match(placeholder, /老板要一个总览大屏/);

    // 第二回合：无新增量 → 不再重复写入
    const specBefore = await session.readSpec();
    const r2 = await runner.enqueue().done;
    assert.equal(r2.ok, true);
    assert.equal(r2.events.at(-1)?.type, 'done');
    assert.equal(await session.readSpec(), specBefore, '无增量回合不改 spec');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('extractPoints：去时间戳、去列表符号、跳过标题与空行，合并备注', () => {
  const points = extractPoints({
    workspace: '/tmp/x',
    transcriptDelta:
      '# TRANSCRIPT\n\n- [2026-07-25 10:00:00] 要点一\n- [2026-07-25 10:01:00] 要点二\n\n',
    note: '备注一\n\n备注二',
  });
  assert.deepEqual(points, ['要点一', '要点二', '备注一', '备注二']);
});

test('mock：spec 缺失「页面清单」区块时自动补建', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fde-console-mock2-'));
  try {
    const ws = path.join(root, 'w');
    const session = new Session(ws);
    await session.init();
    await fs.writeFile(path.join(ws, 'DEMO_SPEC.md'), '# 手写 spec，没有区块\n', 'utf8');
    await session.appendTranscript('新要点');

    const result = await new TurnRunner(session, new MockAdapter()).enqueue().done;
    assert.equal(result.ok, true);
    const spec = await session.readSpec();
    assert.match(spec, /## 页面清单/);
    assert.match(spec, /新要点/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
