import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/session.js';

test('saveInput 落盘到 inputs/ 并出现在 listInputs', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'fde-inputs-'));
  const session = new Session(ws);
  await session.init();

  const saved = await session.saveInput('截图-列表页.png', Buffer.from('fake-png'));
  assert.equal(saved, '截图-列表页.png');
  assert.equal(readFileSync(join(ws, 'inputs', saved), 'utf8'), 'fake-png');

  const list = await session.listInputs();
  assert.deepEqual(list, [{ name: '截图-列表页.png', size: 8 }]);
});

test('saveInput 防路径穿越：../ 被拍平进 inputs/ 内', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'fde-inputs-'));
  const session = new Session(ws);
  await session.init();

  const saved = await session.saveInput('../../evil.sh', Buffer.from('x'));
  assert.equal(saved.includes('/'), false);
  assert.equal(saved.includes('..'), false);
  const list = await session.listInputs();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, saved);
});

test('saveInput 同名覆盖，listInputs 忽略点文件', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'fde-inputs-'));
  const session = new Session(ws);
  await session.init();

  await session.saveInput('api.json', Buffer.from('v1'));
  await session.saveInput('api.json', Buffer.from('v2-longer'));
  await session.saveInput('.DS_Store', Buffer.from('junk'));

  const list = await session.listInputs();
  assert.deepEqual(list, [{ name: 'api.json', size: 9 }]);
});
