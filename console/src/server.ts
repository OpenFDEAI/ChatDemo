/**
 * FDE 现场控制台服务（DESIGN.md §9）。
 *
 * 职责边界：只做「耳朵和手」，不做「脑子」——
 * node:http 静态服务 public/ 单页面板 + WebSocket（路径 /ws）：
 *   文本帧（JSON）：transcript / turn-start / turn-event / state / note / asr-* …
 *   二进制帧：16kHz PCM16 音频（转发给 FunASR）
 *
 * 启动：
 *   tsx src/server.ts --workspace <path> [--demo-url http://localhost:3000]
 *                     [--port 4321] [--adapter mock|claude] [--asr none|funasr]
 */

import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';
import { Session } from './session.js';
import { TurnRunner, type AgentAdapter } from './turn.js';
import { MockAdapter } from './adapters/mock.js';
import { ClaudeAdapter } from './adapters/claude.js';
import { CodexAdapter } from './adapters/codex.js';
import { AdapterRouter } from './adapters/router.js';
import { FunasrAsrAdapter } from './asr/funasr.js';
import { VolcanoAsrAdapter, credentialsPath } from './asr/volcano.js';
import type { AsrAdapter, AudioSink, StatusSource } from './asr/types.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export type EngineName = 'mock' | 'claude' | 'codex';

export interface ConsoleConfig {
  workspace: string;
  demoUrl: string;
  port: number;
  adapter: EngineName;
  asr: 'none' | 'funasr' | 'volcano';
}

export interface EngineStatus {
  available: boolean;
  detail: string;
}

/**
 * 启动时并发探测引擎可用性（DESIGN.md §9.2⑤）：
 * claude = 能否加载 Agent SDK；codex = `codex --version` 是否可执行。
 * 探测的是「装没装」，不是「登没登录」——认证失败在回合内以 error 事件暴露。
 */
export async function probeEngines(): Promise<Record<EngineName, EngineStatus>> {
  const claude = import('@anthropic-ai/claude-agent-sdk').then(
    () => ({ available: true, detail: 'Agent SDK 已安装' }),
    (err: unknown) => ({
      available: false,
      detail: `Agent SDK 加载失败：${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
    }),
  );
  const codexBin = process.env.FDE_CODEX_BIN ?? 'codex';
  const codex = new Promise<EngineStatus>((resolve) => {
    const child = spawn(codexBin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ available: false, detail: 'codex --version 超时' });
    }, 3000);
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        available: false,
        detail:
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? `未找到 ${codexBin}（npm install -g @openai/codex）`
            : err.message.slice(0, 120),
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ available: true, detail: out.trim() || 'codex CLI 就绪' });
      else resolve({ available: false, detail: `codex --version 退出码 ${code}` });
    });
  });
  const [claudeStatus, codexStatus] = await Promise.all([claude, codex]);
  return {
    mock: { available: true, detail: '内置（演练/测试用）' },
    claude: claudeStatus,
    codex: codexStatus,
  };
}

const USAGE = `用法：tsx src/server.ts --workspace <path> [选项]

  --workspace <path>   必填。本次拜访的会话工作区（不存在则自动建骨架）
  --demo-url <url>     Demo dev server 地址（默认 http://localhost:3000）
  --port <n>           控制台端口（默认 4321）
  --adapter <name>     mock | claude | codex（默认 mock；面板上可运行时切换）
  --asr <name>         none | volcano | funasr（默认 none。volcano=火山引擎云端
                       转写，需 VOLC_ASR_APP_KEY/VOLC_ASR_ACCESS_KEY；funasr=
                       本地转写，连 ws://127.0.0.1:10096）
`;

export function parseCliArgs(argv: string[]): ConsoleConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      workspace: { type: 'string' },
      'demo-url': { type: 'string', default: 'http://localhost:3000' },
      port: { type: 'string', default: '4321' },
      adapter: { type: 'string', default: 'mock' },
      asr: { type: 'string', default: 'none' },
    },
  });
  if (!values.workspace) {
    throw new Error(`缺少必填参数 --workspace\n\n${USAGE}`);
  }
  const port = Number.parseInt(values.port ?? '4321', 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`--port 非法：${values.port}\n\n${USAGE}`);
  }
  const adapter = values.adapter ?? 'mock';
  if (adapter !== 'mock' && adapter !== 'claude' && adapter !== 'codex') {
    throw new Error(`--adapter 只支持 mock | claude | codex，收到：${adapter}\n\n${USAGE}`);
  }
  const asr = values.asr ?? 'none';
  if (asr !== 'none' && asr !== 'funasr' && asr !== 'volcano') {
    throw new Error(`--asr 只支持 none | volcano | funasr，收到：${asr}\n\n${USAGE}`);
  }
  return {
    workspace: path.resolve(values.workspace),
    demoUrl: values['demo-url'] ?? 'http://localhost:3000',
    port,
    adapter,
    asr,
  };
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, rel);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    const type = MIME[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
}

export interface RunningConsole {
  server: Server;
  close(): Promise<void>;
}

export async function startConsole(config: ConsoleConfig): Promise<RunningConsole> {
  const session = new Session(config.workspace);
  await session.init();

  // 引擎注册表 + 路由（DESIGN.md §9.2④）：切换在下一回合生效，TurnRunner 零改动。
  const registry = new Map<string, AgentAdapter>([
    ['mock', new MockAdapter()],
    ['claude', new ClaudeAdapter()],
    ['codex', new CodexAdapter()],
  ]);
  const engines = await probeEngines();
  const persisted = (await session.readState()).adapter;
  const initialAdapter: EngineName =
    persisted && registry.has(persisted) && engines[persisted as EngineName]?.available
      ? (persisted as EngineName)
      : config.adapter;
  const router = new AdapterRouter(registry, initialAdapter);
  const runner = new TurnRunner(session, router);

  // 面板拖拽/选择的材料 → POST /upload?name=<文件名> → 工作区 inputs/。
  const MAX_UPLOAD = 30 * 1024 * 1024;
  const handleUpload = (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const name = url.searchParams.get('name') ?? 'file';
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: '文件超过 30MB 上限' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      void session
        .saveInput(name, Buffer.concat(chunks))
        .then(async (saved) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, name: saved }));
          // iPhone 现场传图默认 HEIC，多模态读不了：macOS 上用系统自带
          // sips 自动转出一份 JPG，agent 摄取用 JPG，原图保留。
          if (process.platform === 'darwin' && /\.heic$/i.test(saved)) {
            const src = path.join(config.workspace, 'inputs', saved);
            const jpg = src.replace(/\.heic$/i, '.jpg');
            spawn('sips', ['-s', 'format', 'jpeg', src, '--out', jpg], { stdio: 'ignore' }).on(
              'close',
              () => void broadcastState(),
            );
          }
          await broadcastState();
        })
        .catch((err: unknown) => {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        });
    });
  };

  const server = createServer((req, res) => {
    if (req.method === 'POST' && (req.url ?? '').startsWith('/upload')) {
      handleUpload(req, res);
      return;
    }
    void serveStatic(req, res);
  });
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcast = (msg: Record<string, unknown>): void => {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  };

  const stateMessage = async (): Promise<Record<string, unknown>> => {
    const [spec, candidates, transcript, st, inputs, journal] = await Promise.all([
      session.readSpec(),
      session.readCandidates(),
      session.readTranscript(),
      session.readState(),
      session.listInputs(),
      session.readJournal(),
    ]);
    return {
      type: 'state',
      demoUrl: config.demoUrl,
      adapter: router.active,
      engines,
      asr: config.asr,
      volcCredentials: config.asr === 'volcano' ? new VolcanoAsrAdapter().hasCredentials() : null,
      spec,
      candidates,
      inputs,
      journal,
      transcript,
      consumedOffset: Math.min(st.consumedOffset, transcript.length),
      turnActive: runner.activeId,
      turnQueued: runner.queuedCount,
    };
  };

  const broadcastState = async (): Promise<void> => broadcast(await stateMessage());

  let lastMidTurnBroadcast = 0;
  runner.onEvent((turnId, event) => {
    broadcast({ type: 'turn-event', turnId, event });
    // 回合执行中每 ≥2s 顺带刷一次 state：spec / 材料的中间进展不能等 done
    // 才可见——否则面板看起来像卡住（实测反馈）。
    if (event.type === 'tool' || event.type === 'text') {
      const now = Date.now();
      if (now - lastMidTurnBroadcast > 2000) {
        lastMidTurnBroadcast = now;
        void broadcastState();
      }
    }
  });

  // --- ASR 装配（懒连接：第一次 asr-start 才去连后端） ---
  type ServerAsr = AsrAdapter & AudioSink & StatusSource;
  let serverAsr: ServerAsr | null = null;
  const ensureAsr = (): ServerAsr => {
    if (!serverAsr) {
      serverAsr = config.asr === 'volcano' ? new VolcanoAsrAdapter() : new FunasrAsrAdapter();
      serverAsr.onPartial((text) => broadcast({ type: 'asr-partial', text }));
      serverAsr.onFinal((text) => {
        void session.appendTranscript(text).then(() => broadcastState());
      });
      serverAsr.onStatus((status, detail) => {
        broadcast({ type: 'asr-status', status, ...(detail ? { detail } : {}) });
      });
    }
    return serverAsr;
  };

  wss.on('connection', (socket: WebSocket) => {
    let pendingNote = '';
    void stateMessage().then((msg) => socket.send(JSON.stringify(msg)));

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        // 音频二进制帧 → 服务端 ASR（FunASR / 火山）
        if (config.asr !== 'none' && serverAsr) {
          serverAsr.pushAudio(data as Buffer);
        }
        return;
      }
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data)) as Record<string, unknown>;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'transcript': {
          // 手动输入通道：直接作为 final 转写落盘（逃生通道，始终可用）。
          if (typeof msg.text === 'string') {
            void session.appendTranscript(msg.text).then(() => broadcastState());
          }
          break;
        }
        case 'note': {
          pendingNote = typeof msg.text === 'string' ? msg.text : '';
          break;
        }
        case 'turn-start': {
          const note = typeof msg.note === 'string' && msg.note.trim() ? msg.note : pendingNote;
          pendingNote = '';
          const engine = router.active;
          const { id, done } = runner.enqueue(note);
          broadcast({ type: 'turn-start', turnId: id, queued: runner.queuedCount, adapter: engine });
          void done.then(async (result) => {
            // 回合落账：输入→输出进 SESSION.md，面板「回合记录」卡片渲染。
            const summary = result.events.find(
              (e): e is Extract<typeof e, { type: 'summary' }> => e.type === 'summary',
            );
            const error = result.events.find(
              (e): e is Extract<typeof e, { type: 'error' }> => e.type === 'error',
            );
            await session.appendJournal({
              id: result.id,
              adapter: engine,
              delta: result.input?.transcriptDelta ?? '',
              ...(result.input?.note ? { note: result.input.note } : {}),
              ok: result.ok,
              ...(summary ? { summary: summary.summary } : {}),
              ...(error ? { error: error.message } : {}),
            });
            await broadcastState();
          });
          break;
        }
        case 'set-adapter': {
          // 切换引擎（DESIGN.md §9.2④）：当前回合不中断，下一回合生效。
          const name = typeof msg.adapter === 'string' ? msg.adapter : '';
          if (!registry.has(name)) {
            socket.send(
              JSON.stringify({ type: 'adapter-status', ok: false, message: `未知引擎：${name}` }),
            );
            break;
          }
          if (!engines[name as EngineName]?.available) {
            socket.send(
              JSON.stringify({
                type: 'adapter-status',
                ok: false,
                message: `引擎不可用：${engines[name as EngineName]?.detail ?? name}`,
              }),
            );
            break;
          }
          router.set(name);
          void session.saveAdapter(name).then(() => broadcastState());
          break;
        }
        case 'asr-start': {
          if (config.asr === 'none') {
            socket.send(
              JSON.stringify({
                type: 'asr-status',
                status: 'asr-unavailable',
                detail:
                  '服务端未启用 ASR（--asr none）。请用手动输入，或以 --asr volcano（云端）/ --asr funasr（本地）重启控制台。',
              }),
            );
            break;
          }
          void ensureAsr().start();
          break;
        }
        case 'asr-stop': {
          serverAsr?.stop();
          break;
        }
        case 'asr-credentials': {
          // 面板粘贴火山凭证 → ~/.fde-demo/credentials.json（0600，不进仓库）。
          const appKey = typeof msg.appKey === 'string' ? msg.appKey.trim() : '';
          const accessKey = typeof msg.accessKey === 'string' ? msg.accessKey.trim() : '';
          if (!appKey || !accessKey) {
            socket.send(
              JSON.stringify({
                type: 'asr-status',
                status: 'asr-unavailable',
                detail: 'APP ID 与 Access Token 都不能为空。',
              }),
            );
            break;
          }
          const file = credentialsPath();
          void fs
            .mkdir(path.dirname(file), { recursive: true })
            .then(() =>
              fs.writeFile(
                file,
                `${JSON.stringify({ volcAsrAppKey: appKey, volcAsrAccessKey: accessKey }, null, 2)}\n`,
                { mode: 0o600 },
              ),
            )
            .then(async () => {
              serverAsr = null; // 下次 asr-start 用新凭证重建
              broadcast({
                type: 'asr-status',
                status: 'stopped',
                detail: '火山凭证已保存（~/.fde-demo/credentials.json），点 ● 开始录音。',
              });
              await broadcastState();
            })
            .catch((err: unknown) => {
              socket.send(
                JSON.stringify({
                  type: 'asr-status',
                  status: 'asr-unavailable',
                  detail: `凭证保存失败：${err instanceof Error ? err.message : String(err)}`,
                }),
              );
            });
          break;
        }
        case 'refresh-state': {
          void stateMessage().then((m) => socket.send(JSON.stringify(m)));
          break;
        }
        default:
          break;
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(config.port, resolve));

  return {
    server,
    close: async () => {
      serverAsr?.stop();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}

async function main(): Promise<void> {
  let config: ConsoleConfig;
  try {
    config = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  await startConsole(config);
  console.log(`FDE 现场控制台已启动：
  面板     http://localhost:${config.port}
  工作区   ${config.workspace}
  Demo     ${config.demoUrl}
  adapter  ${config.adapter}（初始值；面板上可在 mock/claude/codex 间切换）
  asr      ${config.asr}${
    config.asr === 'funasr'
      ? '（本地 FunASR，连 ws://127.0.0.1:10096）'
      : config.asr === 'volcano'
        ? '（火山引擎云端转写；凭证缺失时面板可粘贴）'
        : '（浏览器识别测试模式可用，手动输入始终可用）'
  }
`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry === import.meta.url) {
  void main();
}
