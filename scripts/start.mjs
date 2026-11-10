// Runs Postdate on this computer, the way the installer set it up: the worker
// with its database in the folder you chose, and a tick once a minute that
// stands in for Cloudflare's cron trigger so that due messages go out.
//
//   node scripts/start.mjs            start and open the browser
//   node scripts/start.mjs --no-open  start only
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { INSTALL_COMMAND, IS_WINDOWS, ROOT, build, commandLine, openBrowser, readConfig, workerVars } from './lib.mjs';
import { messages } from './messages.mjs';

const config = readConfig();
const t = messages(config?.lang ?? 'en');

if (!config) {
  console.error(t('notSetUp', { command: INSTALL_COMMAND }));
  process.exit(1);
}
if (config.mode === 'cloud') {
  // Nothing runs here; the app lives on Cloudflare.
  if (config.url) openBrowser(config.url);
  console.log(t('doneCloud', { url: config.url ?? '' }));
  process.exit(0);
}

const port = config.port ?? 8787;
const url = `http://localhost:${port}`;

const portFree = await new Promise((done) => {
  const probe = createServer();
  probe.once('error', () => done(false));
  probe.once('listening', () => probe.close(() => done(true)));
  probe.listen(port, '127.0.0.1');
});
if (!portFree) {
  console.error(t('portBusy', { port }));
  process.exit(1);
}

if (!existsSync(join(ROOT, 'dist', 'client', 'index.html')) && !build()) {
  console.error(t('failed'));
  process.exit(1);
}

console.log(t('starting'));
const worker = spawn(
  commandLine('npx', [
    'wrangler', 'dev',
    '--port', String(port),
    '--ip', '127.0.0.1',
    '--persist-to', config.dataDir,
    '--show-interactive-dev-session=false',
    '--log-level', 'error',
    ...workerVars(config),
  ]),
  { cwd: ROOT, shell: true, stdio: ['ignore', 'inherit', 'inherit'] },
);

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // On Windows the worker runs under a shell; take the whole tree down.
  if (IS_WINDOWS && worker.pid) spawnSync('taskkill', ['/pid', String(worker.pid), '/T', '/F'], { stdio: 'ignore' });
  else worker.kill();
  process.exit(code);
}
worker.on('exit', (code) => stop(code ?? 1));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const answers = async (path) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}${path}`)).ok;
  } catch {
    return false;
  }
};

for (let tries = 0; tries < 120 && !(await answers('/api/state')); tries++) {
  await new Promise((done) => setTimeout(done, 500));
}

console.log(`\n${t('running', { url })}`);
console.log(t('keepOpen'));
if (!process.argv.includes('--no-open')) openBrowser(url);

// The dispatcher. On Cloudflare a cron trigger calls it every minute; here it
// is called just after each minute begins, and once right away to catch up on
// whatever came due while Postdate was not running.
// Wrangler has had two names for this address; the older one is the fallback.
const tick = async () => (await answers('/cdn-cgi/local/scheduled')) || (await answers('/cdn-cgi/handler/scheduled'));
void tick();
(function next() {
  setTimeout(() => {
    void tick();
    next();
  }, 60_000 - (Date.now() % 60_000) + 1000);
})();
