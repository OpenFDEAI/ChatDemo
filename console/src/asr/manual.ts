/**
 * 手动 ASR 适配器：前端文本框直接推 final 文本。
 *
 * 这是永远可用的逃生通道——录音/FunASR 任何一环失灵，
 * FDE 都能靠它手敲要点继续回合（DESIGN.md §9 逃生通道）。
 */

import type { AsrAdapter } from './types.js';

export class ManualAsrAdapter implements AsrAdapter {
  private partialCbs: Array<(text: string) => void> = [];
  private finalCbs: Array<(text: string) => void> = [];

  start(): void {
    // 无硬件、无连接，天然就绪。
  }

  stop(): void {
    // 无资源可释放。
  }

  onPartial(cb: (text: string) => void): void {
    this.partialCbs.push(cb);
  }

  onFinal(cb: (text: string) => void): void {
    this.finalCbs.push(cb);
  }

  /** 前端手动输入的一句话，直接作为 final 转写。空白输入忽略。 */
  pushText(text: string): void {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    for (const cb of this.finalCbs) cb(cleaned);
  }
}
