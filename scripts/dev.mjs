// Runs the worker (port 8787) and the Vite dev server (port 5173) side by side.
// Open http://localhost:5173 — Vite proxies /api to the worker.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

// Wrangler refuses to start without the assets directory, even an empty one.
mkdirSync('dist/client', { recursive: true });

if (!existsSync('.dev.vars')) {
  copyFileSync('.dev.vars.example', '.dev.vars');
  console.log('Created .dev.vars from .dev.vars.example (local development only).');
}

const children = [
  spawn('npx', ['wrangler', 'dev', '--port', '8787', '--test-scheduled'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true }),
];

const stop = () => {
  for (const child of children) child.kill();
};
for (const child of children) child.on('exit', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
