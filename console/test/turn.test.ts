/**
 * 回合队列测试：串行（同一时刻最多一个回合）、排队不丢弃、失败不吞增量。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session } from '../src/session.js';
import { TurnRunner, type AgentAdapter, type TurnEvent, type TurnInput } from '../src/turn.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function tmpSession(): Promise<{ session: Session; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fde-console-turn-'));
  const session = new Session(path.join(root, 'w'));
  await session.init();
  return { session, root };
}

/** 慢速假适配器：记录并发度与执行顺序。 */
class GateAdapter implements AgentAdapter {
  active = 0;
  maxActive = 0;
  ran: string[] = [];

  async *run(input: TurnInput): AsyncIterable<TurnEvent> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    yield { type: 'status', message: 'working' };
    await sleep(25);
    this.ran.push(input.note ?? '(no-note)');
    this.active -= 1;
    yield { type: 'summary', summary: `done ${input.note ?? ''}` };
    yield { type: 'done' };
  }
}

test('回合队列：串行执行、排队不丢弃、顺序保持', async () => {
  const { session, root } = await tmpSession();
  try {
    const adapter = new GateAdapter();
    const runner = new TurnRunner(session, adapter);

    const t1 = runner.enqueue('回合一');
    const t2 = runner.enqueue('回合二');
    const t3 = runner.enqueue('回合三');
    assert.ok(runner.queuedCount >= 2, '后两个回合在排队');

    const results = await Promise.all([t1.done, t2.done, t3.done]);

    assert.equal(adapter.maxActive, 1, '同一时刻最多一个回合');
    assert.deepEqual(adapter.ran, ['回合一', '回合二', '回合三'], '不丢弃且按入队顺序');
    for (const r of results) {
      assert.equal(r.ok, true);
      assert.equal(r.events.at(-1)?.type, 'done', '事件序列以 done 结尾');
    }
    assert.deepEqual(
      results.map((r) => r.id),
      [1, 2, 3],
    );
    assert.equal(runner.queuedCount, 0);
    assert.equal(runner.activeId, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('排队期间新增的转写被后续回合消费（增量在执行时读取）', async () => {
  const { session, root } = await tmpSession();
  try {
    const seen: string[] = [];
    const adapter: AgentAdapter = {
      async *run(input: TurnInput): AsyncIterable<TurnEvent> {
        await sleep(20);
        seen.push(input.transcriptDelta);
        yield { type: 'done' };
      },
    };
    const runner = new TurnRunner(session, adapter);

    await session.appendTranscript('第一批要点');
    const t1 = runner.enqueue();
    const t2 = runner.enqueue();
    // 回合一执行期间新到的转写
    await sleep(5);
    await session.appendTranscript('第二批要点');
    await Promise.all([t1.done, t2.done]);

    assert.equal(seen.length, 2);
    assert.match(seen[0] ?? '', /第一批要点/);
    assert.match(seen[1] ?? '', /第二批要点/);
    assert.doesNotMatch(seen[1] ?? '', /第一批要点/, '回合一消费过的不重放');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('失败回合不 markConsumed，增量留给下一回合；队列不断裂', async () => {
  const { session, root } = await tmpSession();
  try {
    let calls = 0;
    const adapter: AgentAdapter = {
      async *run(input: TurnInput): AsyncIterable<TurnEvent> {
        calls += 1;
        if (calls === 1) {
          yield { type: 'error', message: '模拟失败' };
          return;
        }
        assert.match(input.transcriptDelta, /关键要点/, '失败回合的增量被重试');
        yield { type: 'done' };
      },
    };
    const runner = new TurnRunner(session, adapter);
    await session.appendTranscript('关键要点');

    const r1 = await runner.enqueue().done;
    assert.equal(r1.ok, false);
    assert.equal(r1.events.at(-1)?.type, 'error');
    assert.match((await session.readDelta()).text, /关键要点/, '失败不吞增量');

    const r2 = await runner.enqueue().done;
    assert.equal(r2.ok, true);
    assert.equal((await session.readDelta()).text, '', '成功后书签前移');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('适配器抛异常：发 error 事件、不 markConsumed、后续回合照常', async () => {
  const { session, root } = await tmpSession();
  try {
    let calls = 0;
    const adapter: AgentAdapter = {
      // eslint-disable-next-line require-yield
      async *run(): AsyncIterable<TurnEvent> {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        yield { type: 'done' };
      },
    };
    const runner = new TurnRunner(session, adapter);
    await session.appendTranscript('要点 X');

    const events: TurnEvent[] = [];
    runner.onEvent((_id, ev) => events.push(ev));

    const r1 = await runner.enqueue().done;
    assert.equal(r1.ok, false);
    assert.equal(events.at(-1)?.type, 'error');
    assert.match((await session.readDelta()).text, /要点 X/);

    const r2 = await runner.enqueue().done;
    assert.equal(r2.ok, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
