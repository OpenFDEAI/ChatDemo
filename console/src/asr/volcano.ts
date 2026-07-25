/**
 * 火山引擎大模型流式语音识别（sauc bigmodel）客户端。
 *
 * 端点 wss://openspeech.bytedance.com/api/v3/sauc/bigmodel，鉴权走 headers：
 * X-Api-App-Key（APP ID）/ X-Api-Access-Key（Access Token）/ X-Api-Resource-Id。
 * v3 二进制帧：4 字节头 + int32 序号（负数=最后一包）+ 4 字节长度 + gzip payload。
 * 凭证从环境变量读取：VOLC_ASR_APP_KEY / VOLC_ASR_ACCESS_KEY
 * （可选 VOLC_ASR_RESOURCE_ID，默认 volc.bigasr.sauc.duration；VOLC_ASR_URL 供测试覆盖）。
 *
 * 云端转写为刻意选择：质量优先（Plaud / 飞书妙记同为云端路径）；
 * 数据敏感客户用 FunASR 本地引擎，录音须会前告知客户的红线不变。
 * 缺凭证 / 连接失败时优雅降级：上报 asr-unavailable，不崩，手动输入始终可用。
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import WebSocket from 'ws';
import type { RawData } from 'ws';
import type { AsrAdapter, AsrStatusKind, AudioSink, StatusSource } from './types.js';

const DEFAULT_URL = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
const DEFAULT_RESOURCE_ID = 'volc.bigasr.sauc.duration';

/** 面板保存的凭证文件（用户目录，不进仓库、不进工作区）。 */
export function credentialsPath(): string {
  return path.join(homedir(), '.fde-demo', 'credentials.json');
}

export interface StoredCredentials {
  volcAsrAppKey?: string;
  volcAsrAccessKey?: string;
}

export function loadStoredCredentials(file: string = credentialsPath()): StoredCredentials {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as StoredCredentials;
  } catch {
    return {};
  }
}
const HANDSHAKE_TIMEOUT_MS = 5000;

const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE_UNITS = 0b0001; // ×4 字节
const MSG_FULL_CLIENT = 0b0001;
const MSG_AUDIO_ONLY = 0b0010;
const MSG_FULL_SERVER = 0b1001;
const MSG_ERROR = 0b1111;
const FLAG_POS_SEQUENCE = 0b0001;
const FLAG_NEG_SEQUENCE = 0b0011; // 最后一包：序号取负
const SERIAL_JSON = 0b0001;
const SERIAL_NONE = 0b0000;
const COMPRESS_GZIP = 0b0001;

/** 组一个 v3 帧。payload 传原始字节，内部做 gzip。导出供测试搭假服务端。 */
export function buildFrame(
  msgType: number,
  flags: number,
  serialization: number,
  sequence: number,
  payload: Uint8Array,
): Buffer {
  const gz = gzipSync(payload);
  const head = Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE_UNITS,
    (msgType << 4) | flags,
    (serialization << 4) | COMPRESS_GZIP,
    0,
  ]);
  const seq = Buffer.alloc(4);
  seq.writeInt32BE(sequence);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(gz.length);
  return Buffer.concat([head, seq, size, gz]);
}

export interface ParsedFrame {
  msgType: number;
  flags: number;
  sequence: number | null;
  errorCode: number | null;
  json: Record<string, unknown> | null;
  raw: Buffer;
}

/** 解析 v3 帧（客户端与服务端帧同构；MSG_ERROR 的序号位是错误码）。 */
export function parseFrame(data: Buffer): ParsedFrame | null {
  if (data.length < 4) return null;
  const headerSize = (data[0]! & 0x0f) * 4;
  const msgType = data[1]! >> 4;
  const flags = data[1]! & 0x0f;
  const serialization = data[2]! >> 4;
  const compression = data[2]! & 0x0f;
  let offset = headerSize;
  let sequence: number | null = null;
  let errorCode: number | null = null;
  if (msgType === MSG_ERROR) {
    errorCode = data.readUInt32BE(offset);
    offset += 4;
  } else if (flags & 0x01) {
    sequence = data.readInt32BE(offset);
    offset += 4;
  }
  const size = data.readUInt32BE(offset);
  offset += 4;
  let payload = data.subarray(offset, offset + size);
  if (compression === COMPRESS_GZIP && payload.length > 0) {
    try {
      payload = gunzipSync(payload);
    } catch {
      return null;
    }
  }
  let json: Record<string, unknown> | null = null;
  if ((serialization === SERIAL_JSON || msgType === MSG_ERROR) && payload.length > 0) {
    try {
      json = JSON.parse(payload.toString()) as Record<string, unknown>;
    } catch {
      json = null;
    }
  }
  return { msgType, flags, sequence, errorCode, json, raw: Buffer.from(payload) };
}

interface Utterance {
  text?: string;
  definite?: boolean;
}

export interface VolcanoOptions {
  url?: string;
  appKey?: string;
  accessKey?: string;
  resourceId?: string;
}

export class VolcanoAsrAdapter implements AsrAdapter, AudioSink, StatusSource {
  private readonly url: string;
  private readonly appKey: string;
  private readonly accessKey: string;
  private readonly resourceId: string;
  private ws: WebSocket | null = null;
  private sequence = 1;
  private emittedFinals = 0;
  private lastText = '';
  private partialCbs: Array<(text: string) => void> = [];
  private finalCbs: Array<(text: string) => void> = [];
  private statusCbs: Array<(status: AsrStatusKind, detail?: string) => void> = [];

  constructor(options: VolcanoOptions = {}) {
    // 凭证解析顺序：显式参数 → 环境变量 → 面板保存的 ~/.fde-demo/credentials.json。
    const stored = loadStoredCredentials();
    this.url = options.url ?? process.env.VOLC_ASR_URL ?? DEFAULT_URL;
    this.appKey =
      options.appKey ?? process.env.VOLC_ASR_APP_KEY ?? stored.volcAsrAppKey ?? '';
    this.accessKey =
      options.accessKey ?? process.env.VOLC_ASR_ACCESS_KEY ?? stored.volcAsrAccessKey ?? '';
    this.resourceId =
      options.resourceId ?? process.env.VOLC_ASR_RESOURCE_ID ?? DEFAULT_RESOURCE_ID;
  }

  /** 是否已有可用凭证（供面板决定是否展示配置表单）。 */
  hasCredentials(): boolean {
    return this.appKey !== '' && this.accessKey !== '';
  }

  onPartial(cb: (text: string) => void): void {
    this.partialCbs.push(cb);
  }

  onFinal(cb: (text: string) => void): void {
    this.finalCbs.push(cb);
  }

  onStatus(cb: (status: AsrStatusKind, detail?: string) => void): void {
    this.statusCbs.push(cb);
  }

  private emitStatus(status: AsrStatusKind, detail?: string): void {
    for (const cb of this.statusCbs) {
      try {
        cb(status, detail);
      } catch {
        // 状态回调异常不影响 ASR 链路。
      }
    }
  }

  start(): Promise<void> {
    if (!this.appKey || !this.accessKey) {
      this.emitStatus(
        'asr-unavailable',
        '缺少火山引擎凭证：在面板「⚙ 配置凭证」里粘贴 APP ID 与 Access Token（或设环境变量 VOLC_ASR_APP_KEY / VOLC_ASR_ACCESS_KEY）。火山控制台 → 语音技术 → 流式语音识别大模型 可开通获取。',
      );
      return Promise.resolve();
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.emitStatus('ready', '火山引擎已连接（云端转写）');
      return Promise.resolve();
    }
    this.sequence = 1;
    this.emittedFinals = 0;
    this.lastText = '';
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url, {
          handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
          headers: {
            'X-Api-App-Key': this.appKey,
            'X-Api-Access-Key': this.accessKey,
            'X-Api-Resource-Id': this.resourceId,
            'X-Api-Request-Id': randomUUID(),
            'X-Api-Connect-Id': randomUUID(),
          },
        });
      } catch (err) {
        this.emitStatus(
          'asr-unavailable',
          `无法连接火山引擎：${err instanceof Error ? err.message : String(err)}`,
        );
        finish();
        return;
      }
      this.ws = ws;
      ws.on('open', () => {
        try {
          const config = {
            user: { uid: 'fde-console' },
            audio: { format: 'pcm', sample_rate: 16000, bits: 16, channel: 1, codec: 'raw' },
            request: { model_name: 'bigmodel', enable_punc: true, enable_itn: true },
          };
          ws.send(
            buildFrame(
              MSG_FULL_CLIENT,
              FLAG_POS_SEQUENCE,
              SERIAL_JSON,
              this.sequence,
              Buffer.from(JSON.stringify(config)),
            ),
          );
          this.emitStatus('ready', '火山引擎已连接（云端转写）');
        } catch (err) {
          this.emitStatus(
            'asr-unavailable',
            `火山引擎配置发送失败：${err instanceof Error ? err.message : String(err)}`,
          );
        }
        finish();
      });
      ws.on('message', (data: RawData) => {
        this.handleMessage(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
      });
      ws.on('error', (err: Error) => {
        if (this.ws === ws) this.ws = null;
        this.emitStatus('asr-unavailable', `火山引擎连接失败：${err.message}（检查凭证与网络）`);
        finish();
      });
      ws.on('close', () => {
        if (this.ws === ws) {
          this.ws = null;
          this.flushRemainder();
          this.emitStatus('stopped');
        }
      });
    });
  }

  private handleMessage(data: Buffer): void {
    const frame = parseFrame(data);
    if (!frame) return;
    if (frame.msgType === MSG_ERROR) {
      const message =
        (frame.json && typeof frame.json.error === 'string' && frame.json.error) ||
        frame.raw.toString().slice(0, 200) ||
        `错误码 ${frame.errorCode}`;
      this.emitStatus('asr-unavailable', `火山引擎识别错误：${message}`);
      return;
    }
    if (frame.msgType !== MSG_FULL_SERVER || !frame.json) return;
    const result = frame.json.result as
      | { text?: string; utterances?: Utterance[] }
      | undefined;
    if (!result) return;
    if (typeof result.text === 'string') this.lastText = result.text;

    const utterances = Array.isArray(result.utterances) ? result.utterances : [];
    const definite = utterances.filter((u) => u.definite === true);
    for (let i = this.emittedFinals; i < definite.length; i++) {
      const text = definite[i]?.text?.trim();
      if (text) for (const cb of this.finalCbs) cb(text);
    }
    if (definite.length > this.emittedFinals) {
      this.emittedFinals = definite.length;
      this.lastText = '';
    }
    const current = utterances.find((u) => u.definite !== true)?.text?.trim();
    if (current) for (const cb of this.partialCbs) cb(current);
  }

  /** 连接关闭时把尚未定稿的文本吐成 final，不丢最后半句。 */
  private flushRemainder(): void {
    const rest = this.lastText.trim();
    if (rest) {
      this.lastText = '';
      for (const cb of this.finalCbs) cb(rest);
    }
  }

  pushAudio(chunk: Uint8Array): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        this.sequence += 1;
        ws.send(buildFrame(MSG_AUDIO_ONLY, FLAG_POS_SEQUENCE, SERIAL_NONE, this.sequence, chunk));
      } catch {
        // 发送失败按不可用处理，等 close/error 事件收敛。
      }
    }
  }

  /** 发负序号空包收尾，留 2s 窗口接回尾包结果后关闭。 */
  stop(): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        this.sequence += 1;
        ws.send(
          buildFrame(MSG_AUDIO_ONLY, FLAG_NEG_SEQUENCE, SERIAL_NONE, -this.sequence, Buffer.alloc(0)),
        );
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }, 2000).unref?.();
    }
  }
}
