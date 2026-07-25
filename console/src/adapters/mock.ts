/**
 * Mock 适配器：测试与无 API key 演示用。
 *
 * 行为（模拟回合协议的可观测效果，不调模型）：
 * 1. 从 transcript 增量 + 备注提取要点；
 * 2. 合并进 DEMO_SPEC.md 的「## 页面清单」区块（spec-first）；
 * 3. 在工作区 app/ 下写一个占位变更文件；
 * 4. 按顺序发 status / text / tool / summary / done 事件。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { timestamp } from '../session.js';
import type { AgentAdapter, TurnEvent, TurnInput } from '../turn.js';

const SPEC_FILE = 'DEMO_SPEC.md';
const PAGES_HEADING = '## 页面清单';

/** 从转写增量与备注提取要点行：去时间戳、去列表符号、去标题、去空行。 */
export function extractPoints(input: TurnInput): string[] {
  const points: string[] = [];
  const push = (raw: string): void => {
    let s = raw.trim();
    if (!s || s.startsWith('#') || s.startsWith('<!--')) return;
    s = s.replace(/^[-*]\s+/, '');
    s = s.replace(/^\[[^\]]*\]\s*/, '');
    s = s.trim();
    if (s) points.push(s);
  };
  for (const line of input.transcriptDelta.split('\n')) push(line);
  if (input.note) for (const line of input.note.split('\n')) push(line);
  return points;
}

/** 把要点作为 wip 条目合并进 DEMO_SPEC.md 的「页面清单」区块；区块缺失则补建。 */
async function mergeIntoSpec(workspace: string, points: string[]): Promise<void> {
  const specPath = path.join(workspace, SPEC_FILE);
  let spec = '';
  try {
    spec = await fs.readFile(specPath, 'utf8');
  } catch {
    spec = '# Demo Spec\n';
  }
  const bullets = points.map((p) => `- [wip] ${p} <!-- ${timestamp()} 现场转写 -->`).join('\n');
  const idx = spec.indexOf(PAGES_HEADING);
  if (idx === -1) {
    spec = `${spec.trimEnd()}\n\n${PAGES_HEADING}\n\n${bullets}\n`;
  } else {
    const sectionStart = idx + PAGES_HEADING.length;
    let insertAt = spec.indexOf('\n## ', sectionStart);
    if (insertAt === -1) insertAt = spec.length;
    const before = spec.slice(0, insertAt).trimEnd();
    const after = spec.slice(insertAt);
    spec = `${before}\n${bullets}\n${after}`;
  }
  await fs.writeFile(specPath, spec, 'utf8');
}

/** 在 app/ 下追加占位变更文件，模拟「最小代码变更」。返回相对路径。 */
async function writePlaceholder(workspace: string, points: string[]): Promise<string> {
  const appDir = path.join(workspace, 'app');
  await fs.mkdir(appDir, { recursive: true });
  const rel = path.join('app', 'mock-changes.md');
  const block =
    `## 回合 ${timestamp()}\n\n` +
    points.map((p) => `- TODO(demo): ${p}`).join('\n') +
    '\n\n';
  await fs.appendFile(path.join(workspace, rel), block, 'utf8');
  return rel;
}

export class MockAdapter implements AgentAdapter {
  async *run(input: TurnInput): AsyncIterable<TurnEvent> {
    yield { type: 'status', message: '（mock）读取转写增量与备注…' };
    const points = extractPoints(input);
    if (points.length === 0) {
      yield { type: 'text', text: '本回合无新增要点，Demo 保持不变。' };
      yield { type: 'summary', summary: '本回合无新增要点，Demo 保持不变。' };
      yield { type: 'done' };
      return;
    }
    yield {
      type: 'text',
      text: `提取到 ${points.length} 条要点：\n${points.map((p) => `- ${p}`).join('\n')}`,
    };
    await mergeIntoSpec(input.workspace, points);
    yield { type: 'tool', name: 'edit', detail: 'DEMO_SPEC.md · 页面清单' };
    const rel = await writePlaceholder(input.workspace, points);
    yield { type: 'tool', name: 'write', detail: rel };
    yield {
      type: 'summary',
      summary: `已把 ${points.length} 条新需求记入页面清单并落到 Demo 占位——您在屏幕上看到的清单就是我们刚才聊出来的。`,
    };
    yield { type: 'done' };
  }
}
