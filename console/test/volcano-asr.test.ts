import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import {
  VolcanoAsrAdapter,
  buildFrame,
  parseFrame,
  loadStoredCredentials,
} from '../src/asr/volcano.js';

const MSG_FULL_CLIENT = 0b0001;
const MSG_AUDIO_ONLY = 0b0010;
const MSG_FULL_SERVER = 0b1001;
const MSG_ERROR = 0b1111;
const FLAG_POS_SEQUENCE = 0b0001;
const SERIAL_JSON = 0b0001;

function serverResultFrame(sequence: number, result: Record<string, unknown>): Buffer {
  return buildFrame(
    MSG_FULL_SERVER,
    FLAG_POS_SEQUENCE,
    SERIAL_JSON,
    sequence,
    Buffer.from(JSON.stringify({ result })),
  );
}

test('帧编解码 roundtrip（含 gzip 与负序号）', () => {
  const frame = buildFrame(MSG_FULL_CLIENT, FLAG_POS_SEQUENCE, SERIAL_JSON, 1, Buffer.from('{"a":1}'));
  const parsed = parseFrame(frame);
  assert.equal(parsed?.msgType, MSG_FULL_CLIENT);
  assert.equal(parsed?.sequence, 1);
  assert.deepEqual(parsed?.json, { a: 1 });

  const last = buildFrame(MSG_AUDIO_ONLY, 0b0011, 0, -5, Buffer.alloc(0));
  assert.equal(parseFrame(last)?.sequence, -5);
});

test('缺凭证：start 上报 asr-unavailable，不抛异常', async () => {
  const adapter = new VolcanoAsrAdapter({ appKey: '', accessKey: '' });
  const statuses: Array<{ status: string; detail?: string }> = [];
  adapter.onStatus((status, detail) => statuses.push({ status, ...(detail ? { detail } : {}) }));
  await adapter.start();
  assert.equal(statuses[0]?.status, 'asr-unavailable');
  assert.match(statuses[0]?.detail ?? '', /VOLC_ASR_APP_KEY|凭证/);
  assert.equal(adapter.hasCredentials(), false);
});

test('假服务端：握手帧结构正确，partial/definite 分流，final 不重复', async () => {
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, 'listening');
  const port = (wss.address() as { port: number }).port;

  const received: Buffer[] = [];
  wss.on('connection', (socket, req) => {
    assert.equal(req.headers['x-api-app-key'], 'app-1');
    assert.equal(req.headers['x-api-access-key'], 'key-1');
    assert.equal(req.headers['x-api-resource-id'], 'volc.bigasr.sauc.duration');
    socket.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      received.push(buf);
      const frame = parseFrame(buf);
      if (frame?.msgType === MSG_FULL_CLIENT) {
        socket.send(serverResultFrame(1, { text: '今天', utterances: [{ text: '今天', definite: false }] }));
        socket.send(
          serverResultFrame(2, {
            text: '今天天气不错',
            utterances: [
              { text: '今天天气不错。', definite: true },
              { text: '我们', definite: false },
            ],
          }),
        );
        // 同一 definite 再推一次：不得重复触发 final。
        socket.send(
          serverResultFrame(3, {
            text: '今天天气不错我们继续',
            utterances: [
              { text: '今天天气不错。', definite: true },
              { text: '我们继续', definite: false },
            ],
          }),
        );
      }
    });
  });

  const adapter = new VolcanoAsrAdapter({
    url: `ws://127.0.0.1:${port}`,
    appKey: 'app-1',
    accessKey: 'key-1',
  });
  const partials: string[] = [];
  const finals: string[] = [];
  adapter.onPartial((t) => partials.push(t));
  adapter.onFinal((t) => finals.push(t));
  await adapter.start();
  adapter.pushAudio(new Uint8Array([1, 2, 3, 4]));
  await new Promise((r) => setTimeout(r, 300));

  const handshake = parseFrame(received[0]!);
  assert.equal(handshake?.msgType, MSG_FULL_CLIENT);
  assert.equal(handshake?.sequence, 1);
  const audioCfg = (handshake?.json?.audio ?? {}) as Record<string, unknown>;
  assert.equal(audioCfg.sample_rate, 16000);
  const audioFrame = parseFrame(received[1]!);
  assert.equal(audioFrame?.msgType, MSG_AUDIO_ONLY);
  assert.equal(audioFrame?.sequence, 2);

  assert.deepEqual(finals, ['今天天气不错。']);
  assert.equal(partials.includes('今天'), true);
  assert.equal(partials.includes('我们继续'), true);

  adapter.stop();
  wss.close();
});

test('服务端错误帧：上报 asr-unavailable', async () => {
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, 'listening');
  const port = (wss.address() as { port: number }).port;
  wss.on('connection', (socket) => {
    socket.on('message', () => {
      const errPayload = Buffer.from(JSON.stringify({ error: 'invalid token' }));
      const head = Buffer.from([0x11, (MSG_ERROR << 4) | 0, (SERIAL_JSON << 4) | 0b0001, 0]);
      const code = Buffer.alloc(4);
      code.writeUInt32BE(45000001);
      const gz = buildFrame(MSG_FULL_SERVER, FLAG_POS_SEQUENCE, SERIAL_JSON, 1, errPayload).subarray(12);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(gz.length);
      socket.send(Buffer.concat([head, code, size, gz]));
    });
  });

  const adapter = new VolcanoAsrAdapter({
    url: `ws://127.0.0.1:${port}`,
    appKey: 'app-1',
    accessKey: 'key-1',
  });
  const statuses: string[] = [];
  adapter.onStatus((status, detail) => statuses.push(`${status}:${detail ?? ''}`));
  await adapter.start();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(statuses.some((s) => s.includes('asr-unavailable') && s.includes('invalid token')), true);
  adapter.stop();
  wss.close();
});

test('loadStoredCredentials 读取面板保存的凭证文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fde-volc-'));
  const file = join(dir, 'credentials.json');
  writeFileSync(file, JSON.stringify({ volcAsrAppKey: 'a', volcAsrAccessKey: 'b' }));
  assert.deepEqual(loadStoredCredentials(file), { volcAsrAppKey: 'a', volcAsrAccessKey: 'b' });
  assert.deepEqual(loadStoredCredentials(join(dir, 'nope.json')), {});
});
