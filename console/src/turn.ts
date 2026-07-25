/**
 * 回合运行器（DESIGN.md §5 回合制节拍）。
 *
 * - 串行队列：同一时刻最多一个回合在跑，后到的排队，不丢弃；
 * - 每回合输入 = TRANSCRIPT.md 未消费增量 + 可选 FDE 备注；
 * - 增量在「回合真正开始执行时」读取（排队期间新到的转写会被后面的回合吃到）；
 * - 只有回合成功才 markConsumed()——失败的回合不吞增量，下回合重试；
 * - `done` 事件在书签持久化之后才发出，前端收到 done 时状态已一致。
 */

import type { Session } from './session.js';

export interface TurnInput {
  /** 会话工作区绝对路径。 */
  workspace: string;
  /** TRANSCRIPT.md 未消费增量（可能为空）。 */
  transcriptDelta: string;
  /** FDE 手动补充的备注（可选）。 */
  note?: string;
}

export type TurnEvent =
  | { type: 'status'; message: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'summary'; summary: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AgentAdapter {
  run(input: TurnInput): AsyncIterable<TurnEvent>;
}

export interface TurnResult {
  id: number;
  ok: boolean;
  events: TurnEvent[];
}

export type TurnListener = (turnId: number, event: TurnEvent) => void;

export class TurnRunner {
  private tail: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private listeners: TurnListener[] = [];
  private queued = 0;
  private active: number | null = null;

  constructor(
    private readonly session: Session,
    private readonly adapter: AgentAdapter,
  ) {}

  onEvent(listener: TurnListener): void {
    this.listeners.push(listener);
  }

  /** 排队中（尚未开始执行）的回合数。 */
  get queuedCount(): number {
    return this.queued;
  }

  /** 正在执行的回合 id；空闲时为 null。 */
  get activeId(): number | null {
    return this.active;
  }

  /**
   * 入队一个回合。立即返回回合 id 与完成 Promise（永不 reject，
   * 失败以 result.ok=false + error 事件表达）。
   */
  enqueue(note?: string): { id: number; done: Promise<TurnResult> } {
    const id = this.nextId++;
    this.queued += 1;
    const done = this.tail.then(() => this.runTurn(id, note));
    // 队列链永不断裂：即使 runTurn 内部意外抛出也不影响后续回合。
    this.tail = done.catch(() => undefined);
    return { id, done };
  }

  private emit(id: number, event: TurnEvent, sink: TurnEvent[]): void {
    sink.push(event);
    for (const listener of this.listeners) {
      try {
        listener(id, event);
      } catch {
        // 监听器异常不允许影响回合队列。
      }
    }
  }

  private async runTurn(id: number, note?: string): Promise<TurnResult> {
    this.queued -= 1;
    this.active = id;
    const events: TurnEvent[] = [];
    let ok = false;
    try {
      const delta = await this.session.readDelta();
      const input: TurnInput = {
        workspace: this.session.workspace,
        transcriptDelta: delta.text,
        ...(note && note.trim() !== '' ? { note: note.trim() } : {}),
      };
      let failed = false;
      for await (const event of this.adapter.run(input)) {
        if (event.type === 'done') {
          // done 由 runner 在 markConsumed 之后统一发出，见下。
          break;
        }
        if (event.type === 'error') failed = true;
        this.emit(id, event, events);
      }
      if (!failed) {
        await this.session.markConsumed(delta.endOffset);
        this.emit(id, { type: 'done' }, events);
        ok = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit(id, { type: 'error', message }, events);
      ok = false;
    } finally {
      this.active = null;
    }
    return { id, ok, events };
  }
}
