/**
 * FunASR runtime 双通道（2pass）协议客户端（DESIGN.md §9①，默认中文引擎）。
 *
 * 协议（FunASR runtime websocket 协议）：
 * 1. 连接 ws://127.0.0.1:10096（服务端需 --certfile 0 关闭 SSL）；
 * 2. 先发 JSON 配置：{"mode":"2pass","chunk_size":[5,10,5],"chunk_interval":10,
 *    "wav_name":..., "wav_format":"pcm","audio_fs":16000,"is_speaking":true,...}；
 * 3. 后发 16kHz 单声道 PCM16 二进制块；
 * 4. 服务端回 {"mode":"2pass-online"|"2pass-offline","text":...,"is_final":...}：
 *    online 为实时 partial，offline（二遍精修）为 final；
 * 5. 结束发 {"is_speaking":false}。
 *
 * 连不上时优雅降级：上报 'asr-unavailable' 状态，不抛异常、不崩进程，
 * 前端把录音卡片置灰，手动输入通道始终可用。
 */

import WebSocket from 'ws';
import type { RawData } from 'ws';
import type { AsrAdapter, AsrStatusKind, AudioSink, StatusSource } from './types.js';

export interface FunasrOptions {
  url?: string;
  hotwords?: string;
}

const DEFAULT_URL = 'ws://127.0.0.1:10096';
const HANDSHAKE_TIMEOUT_MS = 3000;

export class FunasrAsrAdapter implements AsrAdapter, AudioSink, StatusSource {
  private readonly url: string;
  private readonly hotwords: string;
  private ws: WebSocket | null = null;
  private partialCbs: Array<(text: string) => void> = [];
  private finalCbs: Array<(text: string) => void> = [];
  private statusCbs: Array<(status: AsrStatusKind, detail?: string) => void> = [];

  constructor(options: FunasrOptions = {}) {
    this.url = options.url ?? DEFAULT_URL;
    this.hotwords = options.hotwords ?? '';
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

  /** 建立连接并发送 2pass 配置。失败不抛异常，只上报 asr-unavailable。 */
  start(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.emitStatus('ready');
      return Promise.resolve();
    }
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
        ws = new WebSocket(this.url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
      } catch (err) {
        this.emitStatus(
          'asr-unavailable',
          `无法连接 FunASR（${this.url}）：${err instanceof Error ? err.message : String(err)}`,
        );
        finish();
        return;
      }
      this.ws = ws;
      ws.on('open', () => {
        try {
          ws.send(
            JSON.stringify({
              mode: '2pass',
              chunk_size: [5, 10, 5],
              chunk_interval: 10,
              wav_name: 'fde-console',
              wav_format: 'pcm',
              audio_fs: 16000,
              is_speaking: true,
              itn: true,
              hotwords: this.hotwords,
            }),
          );
          this.emitStatus('ready');
        } catch (err) {
          this.emitStatus(
            'asr-unavailable',
            `FunASR 配置发送失败：${err instanceof Error ? err.message : String(err)}`,
          );
        }
        finish();
      });
      ws.on('message', (data: RawData) => this.handleMessage(data));
      ws.on('error', (err: Error) => {
        if (this.ws === ws) this.ws = null;
        this.emitStatus('asr-unavailable', `无法连接 FunASR（${this.url}）：${err.message}`);
        finish();
      });
      ws.on('close', () => {
        if (this.ws === ws) {
          this.ws = null;
          this.emitStatus('stopped');
        }
      });
    });
  }

  private handleMessage(data: RawData): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text) return;
    const mode = typeof parsed.mode === 'string' ? parsed.mode : '';
    // 2pass：offline（二遍精修）结果为 final；纯 online 场景退化为看 is_final。
    const isFinal = mode.includes('offline') || (mode === '' && parsed.is_final === true);
    const cbs = isFinal ? this.finalCbs : this.partialCbs;
    for (const cb of cbs) cb(text);
  }

  /** 16kHz PCM16 音频块；未连接时静默丢弃（此时前端已被置灰）。 */
  pushAudio(chunk: Uint8Array): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(chunk);
      } catch {
        // 发送失败按不可用处理，等 close/error 事件收敛。
      }
    }
  }

  /** 通知服务端语音结束并在宽限期后关闭连接。 */
  stop(): void {
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ is_speaking: false }));
      } catch {
        // ignore
      }
      // 给 offline 二遍结果留 2s 回传窗口。
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
