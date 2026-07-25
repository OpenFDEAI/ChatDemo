#!/usr/bin/env node
/** fde-demo 入口：确保控制台依赖就绪，然后把参数转交给 console/src/up.ts。 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const consoleDir = path.join(root, 'console');

if (!existsSync(path.join(consoleDir, 'node_modules'))) {
  console.log('[fde-demo] 首次运行：安装控制台依赖…');
  const result = spawnSync('npm', ['install', '--no-fund', '--no-audit'], {
    cwd: consoleDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const tsx = path.join(consoleDir, 'node_modules', '.bin', 'tsx');
const child = spawn(tsx, [path.join(consoleDir, 'src', 'up.ts'), ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('close', (code) => process.exit(code ?? 0));
