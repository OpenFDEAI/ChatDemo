/**
 * session 书签测试：追加 → readDelta → markConsumed → 重启后持久。
 * 禁网络，全部在临时目录。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../src/session.js';

async function tmpWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'fde-console-session-'));
}

test('init 在工作区不存在时创建骨架文件', async () => {
  const root = await tmpWorkspace();
  try {
    const ws = path.join(root, 'acme-2026-07-25');
    const session = new Session(ws);
    await session.init();
    const spec = await fs.readFile(path.join(ws, 'DEMO_SPEC.md'), 'utf8');
    assert.match(spec, /## 页面清单/);
    assert.ok(await fs.readFile(path.join(ws, 'TRANSCRIPT.md'), 'utf8'));
    assert.ok(await fs.readFile(path.join(ws, 'CANDIDATES.md'), 'utf8'));
    assert.ok((await fs.stat(path.join(ws, 'inputs'))).isDirectory());
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('init 不覆盖已有文件', async () => {
  const root = await tmpWorkspace();
  try {
    const ws = path.join(root, 'w');
    await fs.mkdir(ws, { recursive: true });
    await fs.writeFile(path.join(ws, 'DEMO_SPEC.md'), '# 已有 spec\n', 'utf8');
    const session = new Session(ws);
    await session.init();
    assert.equal(await session.readSpec(), '# 已有 spec\n');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('书签：追加 → readDelta → markConsumed → 重启后持久', async () => {
  const root = await tmpWorkspace();
  try {
    const ws = path.join(root, 'w');
    const s1 = new Session(ws);
    await s1.init();

    await s1.appendTranscript('订单列表页要能按状态筛选');
    const d1 = await s1.readDelta();
    assert.match(d1.text, /订单列表页要能按状态筛选/);
    assert.match(d1.text, /^\-?\s*.*\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/m, '追加行带时间戳');

    await s1.markConsumed(d1.endOffset);
    assert.equal((await s1.readDelta()).text, '');

    // 「重启」：新的 Session 实例读同一工作区，书签必须还在。
    const s2 = new Session(ws);
    await s2.init();
    assert.equal((await s2.readDelta()).text, '', '重启后已消费增量不重放');

    await s2.appendTranscript('老板要一个总览大屏');
    const d2 = await s2.readDelta();
    assert.match(d2.text, /老板要一个总览大屏/);
    assert.doesNotMatch(d2.text, /订单列表页/, '增量只含未消费部分');

    // 书签落在工作区内 .console-state.json
    const state = JSON.parse(
      await fs.readFile(path.join(ws, '.console-state.json'), 'utf8'),
    ) as { consumedOffset: number };
    assert.equal(state.consumedOffset, d1.endOffset);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('transcript 被截短时偏移自动收敛，不越界', async () => {
  const root = await tmpWorkspace();
  try {
    const ws = path.join(root, 'w');
    const s = new Session(ws);
    await s.init();
    await s.appendTranscript('会被删掉的一大段');
    const d = await s.readDelta();
    await s.markConsumed(d.endOffset);
    await fs.writeFile(path.join(ws, 'TRANSCRIPT.md'), '短\n', 'utf8');
    const d2 = await s.readDelta();
    assert.equal(d2.text, '');
    assert.equal(d2.endOffset, '短\n'.length);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('appendTranscript 忽略空白输入', async () => {
  const root = await tmpWorkspace();
  try {
    const ws = path.join(root, 'w');
    const s = new Session(ws);
    await s.init();
    const before = await s.readTranscript();
    assert.equal(await s.appendTranscript('   \n  '), '');
    assert.equal(await s.readTranscript(), before);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
