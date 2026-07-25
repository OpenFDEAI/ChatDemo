/**
 * 手动 ASR 适配器（逃生通道）测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManualAsrAdapter } from '../src/asr/manual.js';

test('manual ASR：pushText 触发 final 回调', () => {
  const asr = new ManualAsrAdapter();
  const finals: string[] = [];
  const partials: string[] = [];
  asr.onFinal((t) => finals.push(t));
  asr.onPartial((t) => partials.push(t));

  asr.start();
  asr.pushText('客户说要先看工单看板');
  asr.pushText('  多余   空白  折叠  ');
  asr.stop();

  assert.deepEqual(finals, ['客户说要先看工单看板', '多余 空白 折叠']);
  assert.deepEqual(partials, [], '手动通道没有 partial');
});

test('manual ASR：空白输入忽略；多个回调都收到', () => {
  const asr = new ManualAsrAdapter();
  const a: string[] = [];
  const b: string[] = [];
  asr.onFinal((t) => a.push(t));
  asr.onFinal((t) => b.push(t));

  asr.pushText('   ');
  asr.pushText('\n\t');
  asr.pushText('有效要点');

  assert.deepEqual(a, ['有效要点']);
  assert.deepEqual(b, ['有效要点']);
});

test('manual ASR：start/stop 幂等，不抛异常', () => {
  const asr = new ManualAsrAdapter();
  assert.doesNotThrow(() => {
    asr.start();
    asr.start();
    asr.stop();
    asr.stop();
  });
});
