/**
 * ASR 适配器接口（DESIGN.md §9①）。
 *
 * 转写产物统一是文本回调：partial（实时预览，不落盘）与 final（落 TRANSCRIPT.md）。
 */

export type AsrStatusKind = 'ready' | 'asr-unavailable' | 'stopped';

export interface AsrAdapter {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
}

/** 需要消费音频流的适配器（如 FunASR）额外实现。 */
export interface AudioSink {
  /** 16kHz / 单声道 / PCM16（小端）二进制块。 */
  pushAudio(chunk: Uint8Array): void;
}

/** 会上报可用性状态的适配器额外实现（用于前端置灰与降级提示）。 */
export interface StatusSource {
  onStatus(cb: (status: AsrStatusKind, detail?: string) => void): void;
}
