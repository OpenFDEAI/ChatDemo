import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AdapterRouter } from '../src/adapters/router.js';
import type { AgentAdapter, TurnEvent, TurnInput } from '../src/turn.js';

function fakeAdapter(tag: string): AgentAdapter {
  return {
    async *run(): AsyncIterable<TurnEvent> {
      yield { type: 'text', text: tag };
      yield { type: 'done' };
    },
  };
}

const INPUT: TurnInput = { workspace: '/tmp', transcriptDelta: '' };

async function firstText(iter: AsyncIterable<TurnEvent>): Promise<string> {
  for await (const event of iter) {
    if (event.type === 'text') return event.text;
  }
  return '';
}

test('路由在 run 调用时解析当前引擎，切换对下一回合生效', async () => {
  const registry = new Map<string, AgentAdapter>([
    ['a', fakeAdapter('来自A')],
    ['b', fakeAdapter('来自B')],
  ]);
  const router = new AdapterRouter(registry, 'a');
  assert.equal(router.active, 'a');
  assert.equal(await firstText(router.run(INPUT)), '来自A');

  router.set('b');
  assert.equal(router.active, 'b');
  assert.equal(await firstText(router.run(INPUT)), '来自B');
});

test('切换到未注册引擎抛错，且不改变当前选择', () => {
  const registry = new Map<string, AgentAdapter>([['a', fakeAdapter('A')]]);
  const router = new AdapterRouter(registry, 'a');
  assert.throws(() => router.set('ghost'), /未注册的引擎/);
  assert.equal(router.active, 'a');
  assert.throws(() => new AdapterRouter(registry, 'ghost'), /未注册的引擎/);
});
