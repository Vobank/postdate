// The installer. Asks a few questions in the language you pick, then does the
// rest: builds the app, creates the encryption key, and either prepares this
// computer to run Postdate or publishes it to your Cloudflare account.
//
// Safe to run again: it starts from your previous answers, and an existing
// encryption key or database is never replaced.
//
// Every question can be answered up front, for scripts and for the impatient:
//   node scripts/setup.mjs --lang=ru --mode=local --data=D:\Postdate --port=8787 \
//     --signups=closed --shortcut=no --start=no
// --yes takes the suggested answer for anything not given.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  IS_WINDOWS,
  ROOT,
  CONFIG_FILE,
  START_COMMAND,
  build,
  readConfig,
  run,
  workerVars,
  wrangler,
  writeConfig,
} from './lib.mjs';
import { LANGUAGES, messages } from './messages.mjs';

const flags = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [name, ...value] = arg.replace(/^--/, '').split('=');
    return [name, value.length ? value.join('=') : 'yes'];
  }),
);
const takeDefaults = flags.yes === 'yes' || !process.stdin.isTTY;
const previous = readConfig();
const terminal = createInterface({ input: process.stdin, output: process.stdout });

let t = messages('en');

function fail(text) {
  console.error(`\n${text}`);
  terminal.close();
  process.exit(1);
}

/** A numbered question. `given` is the answer from the command line, if any. */
async function choose(title, options, fallback, given) {
  if (given !== undefined) {
    const match = options.find((option) => option.value === given);
    if (!match) fail(`--${title.flag}: ${options.map((o) => o.value).join(' | ')}`);
    return match.value;
  }
  if (takeDefaults) return fallback;
  console.log(`\n${title.text}`);
  options.forEach((option, index) => {
    console.log(`  ${index + 1}) ${option.label}${option.value === fallback ? '  *' : ''}`);
    if (option.note) console.log(`     ${option.note}`);
  });
  const suggested = options.findIndex((option) => option.value === fallback) + 1;
  for (;;) {
    const answer = (await terminal.question(`> [${suggested}] `)).trim();
    if (!answer) return fallback;
    const picked = options[Number(answer) - 1];
    if (picked) return picked.value;
    console.log(t('badChoice'));
  }
}

async function ask(title, note, fallback, check, given) {
  if (given !== undefined) {
    const problem = check(given);
    if (problem) fail(problem);
    return given;
  }
  if (takeDefaults) return fallback;
  console.log(`\n${title}`);
  if (note) console.log(`  ${note}`);
  for (;;) {
    const answer = (await terminal.question(`> [${fallback}] `)).trim() || fallback;
    const problem = check(answer);
    if (!problem) return answer;
    console.log(problem);
  }
}

async function confirm(question, given) {
  if (given !== undefined) return given !== 'no';
  if (takeDefaults) return true;
  const answer = (await terminal.question(`\n${question} [Y/n] `)).trim().toLowerCase();
  return !/^(n|н|0)/.test(answer);
}

/** The language of the system, if Postdate speaks it. */
function systemLanguage() {
  const wanted = Intl.DateTimeFormat().resolvedOptions().locale;
  const codes = LANGUAGES.map(([code]) => code);
  return codes.find((c) => c === wanted) ?? codes.find((c) => c.split('-')[0] === wanted.split('-')[0]) ?? 'en';
}

/** Makes the folder if needed and proves it can be written to. */
function writable(folder) {
  try {
    mkdirSync(folder, { recursive: true });
    const probe = join(folder, `.postdate-${process.pid}`);
    writeFileSync(probe, '');
    rmSync(probe);
    return true;
  } catch {
    return false;
  }
}

const expandHome = (path) => resolve(ROOT, path.replace(/^~(?=$|[\\/])/, homedir()));

function desktopShortcut() {
  const script = [
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    "$link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Postdate.lnk'))",
    `$link.TargetPath = '${join(ROOT, 'Postdate.cmd').replace(/'/g, "''")}'`,
    `$link.WorkingDirectory = '${ROOT.replace(/'/g, "''")}'`,
    '$link.Save()',
  ].join('; ');
  return run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]).status === 0;
}

// --- The questions ------------------------------------------------------------

const major = Number(process.versions.node.split('.')[0]);
if (major < 22) fail(t('nodeOld', { version: process.versions.node }));

console.log('\n  Postdate\n');
const lang = await choose(
  { text: 'Language · Idioma · Langue · Sprache · Мова · Язык · Dil · 语言 · 言語 · 언어', flag: 'lang' },
  LANGUAGES.map(([value, label]) => ({ value, label })),
  previous?.lang ?? systemLanguage(),
  flags.lang,
);
t = messages(lang);

console.log(`\n${t('title')}`);
if (!takeDefaults) console.log(t('hint'));

const mode = await choose(
  { text: t('whereTitle'), flag: 'mode' },
  [
    { value: 'local', label: t('whereLocal'), note: t('whereLocalNote') },
    { value: 'cloud', label: t('whereCloud'), note: t('whereCloudNote') },
  ],
  previous?.mode ?? 'local',
  flags.mode,
);

/** @type {import('./lib.mjs').Config} */
const config = { lang, mode, signups: 'open' };

if (mode === 'local') {
  const folder = await ask(
    t('dataTitle'),
    t('dataNote'),
    previous?.dataDir ?? join(ROOT, 'data'),
    (answer) => (writable(expandHome(answer)) ? '' : t('dataBad', { path: expandHome(answer) })),
    flags.data,
  );
  config.dataDir = expandHome(folder);

  const port = await ask(
    t('portTitle'),
    '',
    String(previous?.port ?? 8787),
    (answer) => (/^\d+$/.test(answer) && Number(answer) >= 1024 && Number(answer) <= 65535 ? '' : t('portBad')),
    flags.port,
  );
  config.port = Number(port);
}

config.signups = await choose(
  { text: t('signupsTitle'), flag: 'signups' },
  [
    { value: 'open', label: t('signupsOpen') },
    { value: 'closed', label: t('signupsClosed') },
  ],
  previous?.signups ?? (mode === 'local' ? 'open' : 'closed'),
  flags.signups,
);

// --- The work -----------------------------------------------------------------

if (!existsSync(join(ROOT, 'node_modules'))) {
  if (run('npm', ['install'], { stdio: 'inherit' }).status !== 0) fail(t('failed'));
}

console.log(`\n${t('stepBuild')}`);
if (!build()) fail(t('failed'));

if (mode === 'local') {
  // Data from running Postdate before the installer existed moves along, once.
  const earlier = join(ROOT, '.wrangler', 'state');
  if (!existsSync(join(config.dataDir, 'v3')) && existsSync(join(earlier, 'v3'))) {
    cpSync(earlier, config.dataDir, { recursive: true });
    console.log(t('dataCopied', { path: config.dataDir }));
  }

  // Channel passwords and tokens are encrypted with this key. Replacing it
  // would make the saved ones unreadable, so an existing file is left alone.
  const keyFile = join(ROOT, '.dev.vars');
  if (existsSync(keyFile)) {
    console.log(t('keyKept'));
  } else {
    console.log(t('stepKey'));
    writeFileSync(keyFile, `SECRET_KEY=${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  }

  writeConfig(config);
  console.log(t('saved', { path: CONFIG_FILE }));

  if (IS_WINDOWS && (await confirm(t('shortcutAsk'), flags.shortcut)) && desktopShortcut()) {
    console.log(t('shortcutDone'));
  }

  const url = `http://localhost:${config.port}`;
  console.log(`\n${t('doneLocal', { command: START_COMMAND, url })}`);
  console.log(t('firstAccount'));

  const startNow = await confirm(t('startAsk'), flags.start);
  terminal.close();
  if (startNow) {
    const launcher = spawn(process.execPath, [join(ROOT, 'scripts', 'start.mjs')], { cwd: ROOT, stdio: 'inherit' });
    launcher.on('exit', (code) => process.exit(code ?? 0));
  }
} else {
  console.log(`\n${t('stepLogin')}`);
  if (wrangler(['whoami']).status !== 0 && wrangler(['login'], { stdio: 'inherit' }).status !== 0) fail(t('failed'));

  console.log(`\n${t('stepDeploy')}`);
  const deployed = wrangler(['deploy', ...workerVars(config)], { stdio: ['inherit', 'pipe', 'inherit'] });
  process.stdout.write(deployed.stdout ?? '');
  if (deployed.status !== 0) fail(t('failed'));
  config.url = /https:\/\/[^\s]+\.workers\.dev/.exec(deployed.stdout ?? '')?.[0];

  const listed = wrangler(['secret', 'list', '--format', 'json']);
  let hasKey = false;
  try {
    hasKey = JSON.parse(listed.stdout).some((secret) => secret.name === 'SECRET_KEY');
  } catch {
    hasKey = /SECRET_KEY/.test(listed.stdout ?? '');
  }
  if (hasKey) {
    console.log(t('keyKept'));
  } else {
    console.log(t('stepKey'));
    // Generated here and piped straight to Wrangler; never printed or written to disk.
    const put = wrangler(['secret', 'put', 'SECRET_KEY'], {
      input: randomBytes(32).toString('base64'),
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (put.status !== 0) fail(t('failed'));
  }

  writeConfig(config);
  console.log(t('saved', { path: CONFIG_FILE }));
  console.log(`\n${t('doneCloud', { url: config.url ?? 'https://postdate.<you>.workers.dev' })}`);
  console.log(t('firstAccount'));
  terminal.close();
}
