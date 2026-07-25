/**
 * 引擎路由（DESIGN.md §9.2④）：委托适配器，TurnRunner 零改动。
 *
 * - run() 在「回合真正开始执行时」解析当前引擎——切换对进行中的回合无影响，
 *   下一回合（含已排队的）生效；
 * - 注册表由 server 装配；切换到未注册引擎直接抛错（server 侧先校验可用性）。
 */

import type { AgentAdapter, TurnEvent, TurnInput } from '../turn.js';

export class AdapterRouter implements AgentAdapter {
  private current: string;

  constructor(
    private readonly registry: Map<string, AgentAdapter>,
    initial: string,
  ) {
    if (!registry.has(initial)) throw new Error(`未注册的引擎：${initial}`);
    this.current = initial;
  }

  get active(): string {
    return this.current;
  }

  set(name: string): void {
    if (!this.registry.has(name)) throw new Error(`未注册的引擎：${name}`);
    this.current = name;
  }

  run(input: TurnInput): AsyncIterable<TurnEvent> {
    const adapter = this.registry.get(this.current);
    if (!adapter) throw new Error(`未注册的引擎：${this.current}`);
    return adapter.run(input);
  }
}
