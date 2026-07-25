/**
 * `fde-demo` 一键启动器：在任意（新）文件夹拉起全套现场环境。
 *
 * 做的事，按序：
 *   1. 以 --workspace（默认当前目录）为工作区，自动建骨架（spec/transcript/inputs）；
 *   2. 工作区没有 app/ 时，从 skills/fde-demo/templates/base 拷贝模板并 npm install；
 *   3. 起 Demo dev server（从 3000 起自动找空闲端口）；
 *   4. 起现场控制台（从 4321 起自动找空闲端口），引擎自动选择：
 *      显式 --adapter 优先，否则 claude → codex → mock 按可用性取第一个；
 *   5. 打开浏览器（--no-open 关闭）。
 *
 * Ctrl-C 一次性带走 dev server 与控制台。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { probeEngines, startConsole, type EngineName } from './server.js';
import { Session } from './session.js';
import { VolcanoAsrAdapter } from './asr/volcano.js';

const CONSOLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = path.resolve(CONSOLE_DIR, '..', 'skills', 'fde-demo', 'templates', 'base');

const USAGE = `用法：chatdemo [选项]（在拜访工作区目录里直接运行即可）

  --workspace <path>   工作区目录（默认：当前目录）
  --adapter <name>     mock | claude | codex（默认：自动选择可用引擎）
  --asr <name>         none | volcano | funasr（默认 none；volcano=火山云端转写）
  --port <n>           控制台端口起点（默认 4321，被占用自动 +1）
  --demo-port <n>      Demo 端口起点（默认 3000，被占用自动 +1）
  --no-open            不自动打开浏览器
`;

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // 不指定 host：与 http server 同样走通配绑定。macOS 上 127.0.0.1 的
    // 具体绑定可与他进程的通配绑定共存，按 127.0.0.1 探测会误报空闲。
    const probe = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port);
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await portFree(port)) return port;
  }
  throw new Error(`从 ${start} 起找不到空闲端口`);
}

async function waitHttp(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // dev server 还没起来，继续等。
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`等待 ${url} 就绪超时（${Math.round(timeoutMs / 1000)}s）`);
}

function runNpm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} 退出码 ${code}`)),
    );
  });
}

async function ensureApp(workspace: string): Promise<string> {
  const appDir = path.join(workspace, 'app');
  if (!existsSync(appDir)) {
    if (!existsSync(TEMPLATE_DIR)) {
      throw new Error(`找不到模板：${TEMPLATE_DIR}（FDEDemo 仓库不完整？）`);
    }
    console.log('[chatdemo] 工作区没有 app/，从模板底座创建…');
    await fs.cp(TEMPLATE_DIR, appDir, {
      recursive: true,
      filter: (src) =>
        !src.includes(`${path.sep}node_modules`) &&
        !src.includes(`${path.sep}.next`) &&
        !src.endsWith('next-env.d.ts'),
    });
  }
  if (!existsSync(path.join(appDir, 'node_modules'))) {
    console.log('[chatdemo] 安装 Demo 依赖（首次约 1 分钟）…');
    await runNpm(['install', '--no-fund', '--no-audit'], appDir);
  }
  return appDir;
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      workspace: { type: 'string', default: '.' },
      adapter: { type: 'string' },
      asr: { type: 'string' },
      port: { type: 'string', default: '4321' },
      'demo-port': { type: 'string', default: '3000' },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const workspace = path.resolve(values.workspace ?? '.');
  console.log(`[chatdemo] 工作区：${workspace}`);
  await new Session(workspace).init();

  const appDir = await ensureApp(workspace);
  // 每次启动清 .next：dev 缓存跨会话无价值，却是「改动大后 chunk 损坏 → 500」
  // 这类事故的温床（实测两次）。重建只需数秒。
  await fs.rm(path.join(appDir, '.next'), { recursive: true, force: true });
  const demoPort = await findFreePort(Number.parseInt(values['demo-port'] ?? '3000', 10));
  const demoUrl = `http://localhost:${demoPort}`;

  console.log(`[chatdemo] 启动 Demo dev server → ${demoUrl}`);
  // detached：让 npm 及其 fork 出的 next-server 同组，退出时整组带走——
  // 只杀 npm 会留下孤儿 next dev，与下次启动抢写 .next 缓存（实测事故）。
  const dev: ChildProcess = spawn('npm', ['run', 'dev', '--', '-p', String(demoPort)], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  dev.stdout?.on('data', (c: Buffer) => {
    const line = c.toString().trim();
    if (line) console.log(`[demo] ${line.split('\n')[0]}`);
  });
  dev.stderr?.on('data', (c: Buffer) => {
    const line = c.toString().trim();
    if (line) console.error(`[demo] ${line.split('\n')[0]}`);
  });
  const stopDev = (): void => {
    if (dev.pid && !dev.killed) {
      try {
        process.kill(-dev.pid, 'SIGTERM'); // 负 pid = 杀整个进程组
      } catch {
        dev.kill();
      }
    }
  };
  process.on('SIGINT', () => {
    stopDev();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopDev();
    process.exit(0);
  });
  dev.on('close', (code) => {
    if (code !== null && code !== 0) console.error(`[chatdemo] Demo dev server 退出（${code}）`);
  });

  await waitHttp(demoUrl, 120_000);

  let adapter: EngineName;
  if (values.adapter) {
    if (values.adapter !== 'mock' && values.adapter !== 'claude' && values.adapter !== 'codex') {
      throw new Error(`--adapter 只支持 mock | claude | codex\n\n${USAGE}`);
    }
    adapter = values.adapter;
  } else {
    const engines = await probeEngines();
    adapter = engines.claude.available ? 'claude' : engines.codex.available ? 'codex' : 'mock';
    console.log(`[chatdemo] 引擎自动选择：${adapter}（面板上可随时切换）`);
  }
  let asr: 'none' | 'funasr' | 'volcano';
  if (values.asr === 'funasr' || values.asr === 'volcano' || values.asr === 'none') {
    asr = values.asr;
  } else {
    // 未显式指定：有火山凭证就直接开云端转写，少敲一个参数。
    asr = new VolcanoAsrAdapter().hasCredentials() ? 'volcano' : 'none';
    if (asr === 'volcano') console.log('[chatdemo] 检测到火山凭证，语音转写自动启用（volcano）');
  }

  const consolePort = await findFreePort(Number.parseInt(values.port ?? '4321', 10));
  await startConsole({ workspace, demoUrl, port: consolePort, adapter, asr });

  const panelUrl = `http://localhost:${consolePort}`;
  console.log(`
[chatdemo] 全部就绪：
  控制台   ${panelUrl}   ← 录音 / 拖材料 / 引擎切换 / ▶ 生成回合
  Demo     ${demoUrl}   ← 投屏给客户看的页面（面板右列即其预览）
  工作区   ${workspace}
  引擎     ${adapter}${asr === 'none' ? '（录音需 --asr funasr + 本地 FunASR，手动输入始终可用）' : ''}

  Ctrl-C 退出（连带关闭 Demo dev server）。
`);
  if (!values['no-open']) openBrowser(panelUrl);
}

main().catch((err: unknown) => {
  console.error(`[chatdemo] 启动失败：${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
