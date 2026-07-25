/**
 * 工作区管理（DESIGN.md §3.2）。
 *
 * 一次客户拜访 = 一个工作区目录：
 *   DEMO_SPEC.md   活的需求台账（单一事实源）
 *   TRANSCRIPT.md  转写流（时间戳追加，增量消费）
 *   CANDIDATES.md  开源候选短名单
 *   inputs/        客户当场给的材料
 *
 * 「已消费偏移」书签持久化在工作区内 .console-state.json，
 * 控制台重启后增量消费不丢不重。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const STATE_FILE = '.console-state.json';
const SPEC_FILE = 'DEMO_SPEC.md';
const TRANSCRIPT_FILE = 'TRANSCRIPT.md';
const CANDIDATES_FILE = 'CANDIDATES.md';

const SPEC_SKELETON = `# Demo Spec

> 单一事实源：每回合先改这里，再改代码（DESIGN.md §6.2）。

## 目标场景

（待补充：给谁演示、证明什么）

## 底座与复用

（待补充：基于哪个开源项目/模板，license）

## 角色与用户

（待补充）

## 数据源

（待补充：哪些接真 API、哪些 mock、字段来源）

## 页面清单

## 打动点

（待补充：老板最想看到的那一屏，倒排优先级）

## 暂缓项

（待补充：现场超预算的需求，会后补）

## 已确认 / 已否决

（待补充：客户当场的表态，含否决理由）
`;

const TRANSCRIPT_SKELETON = `# TRANSCRIPT

`;

const CANDIDATES_SKELETON = `# 开源候选短名单

<!-- repo / ★ / license / 跑通成本 / 匹配度；AGPL 标红，无 license 不碰（DESIGN.md §4.3） -->
`;

export interface TranscriptDelta {
  /** 尚未被回合消费的转写文本（可能为空字符串）。 */
  text: string;
  /** 本次读取时 TRANSCRIPT.md 全文的末尾偏移；回合成功后用它 markConsumed。 */
  endOffset: number;
}

interface ConsoleState {
  consumedOffset: number;
  /** 面板上最后选择的引擎（mock/claude/codex），重启后记住。 */
  adapter?: string;
}

/** `YYYY-MM-DD HH:mm:ss` 本地时间戳。 */
export function timestamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

async function createIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, { flag: 'wx', encoding: 'utf8' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export class Session {
  readonly workspace: string;

  constructor(workspace: string) {
    this.workspace = path.resolve(workspace);
  }

  private file(name: string): string {
    return path.join(this.workspace, name);
  }

  /** 工作区不存在时创建骨架：DEMO_SPEC.md / TRANSCRIPT.md / CANDIDATES.md / inputs/。 */
  async init(): Promise<void> {
    await fs.mkdir(this.workspace, { recursive: true });
    await fs.mkdir(this.file('inputs'), { recursive: true });
    await createIfMissing(this.file(SPEC_FILE), SPEC_SKELETON);
    await createIfMissing(this.file(TRANSCRIPT_FILE), TRANSCRIPT_SKELETON);
    await createIfMissing(this.file(CANDIDATES_FILE), CANDIDATES_SKELETON);
  }

  /** 带时间戳追加一条转写/要点。返回实际写入的行。 */
  async appendTranscript(text: string): Promise<string> {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';
    const line = `- [${timestamp()}] ${cleaned}\n`;
    await fs.appendFile(this.file(TRANSCRIPT_FILE), line, 'utf8');
    return line;
  }

  async readTranscript(): Promise<string> {
    try {
      return await fs.readFile(this.file(TRANSCRIPT_FILE), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }

  async readState(): Promise<ConsoleState> {
    try {
      const raw = await fs.readFile(this.file(STATE_FILE), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ConsoleState>;
      const offset = typeof parsed.consumedOffset === 'number' ? parsed.consumedOffset : 0;
      return {
        consumedOffset: Math.max(0, offset),
        ...(typeof parsed.adapter === 'string' ? { adapter: parsed.adapter } : {}),
      };
    } catch {
      return { consumedOffset: 0 };
    }
  }

  private async writeState(state: ConsoleState): Promise<void> {
    await fs.writeFile(this.file(STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  /** 返回未消费的转写增量。文件被截短/重写时偏移自动收敛，不会越界。 */
  async readDelta(): Promise<TranscriptDelta> {
    const full = await this.readTranscript();
    const { consumedOffset } = await this.readState();
    const from = Math.min(consumedOffset, full.length);
    return { text: full.slice(from), endOffset: full.length };
  }

  /** 回合成功后把书签推进到 endOffset 并持久化（保留其余状态字段）。 */
  async markConsumed(endOffset: number): Promise<void> {
    const current = await this.readState();
    await this.writeState({ ...current, consumedOffset: Math.max(0, endOffset) });
  }

  /** 持久化面板上的引擎选择（保留书签）。 */
  async saveAdapter(name: string): Promise<void> {
    const current = await this.readState();
    await this.writeState({ ...current, adapter: name });
  }

  async readSpec(): Promise<string> {
    try {
      return await fs.readFile(this.file(SPEC_FILE), 'utf8');
    } catch {
      return '';
    }
  }

  async readCandidates(): Promise<string> {
    try {
      return await fs.readFile(this.file(CANDIDATES_FILE), 'utf8');
    } catch {
      return '';
    }
  }
}
