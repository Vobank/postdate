// Shared by the installer, the launcher and the deploy script.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The project folder, wherever the script was started from. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = join(ROOT, 'postdate.config.json');
export const IS_WINDOWS = process.platform === 'win32';

/**
 * What the installer decided. Kept out of git: it describes this copy only.
 * @typedef {{ lang: string, mode: 'local' | 'cloud', dataDir?: string, port?: number,
 *   signups: 'open' | 'closed', url?: string }} Config
 */

/** @returns {Config | null} */
export function readConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {Config} config */
export function writeConfig(config) {
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

/** Settings the worker reads as plain variables, as `--var` arguments for Wrangler. */
export function workerVars(config) {
  return ['--var', `SIGNUPS:${config.signups}`, '--var', `DEFAULT_LANG:${config.lang}`];
}

const quote = (arg) => (/[\s"&|<>^()]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

/** One string for the shell, with the arguments that need it quoted. */
export const commandLine = (command, args) => [command, ...args.map(quote)].join(' ');

/** Runs a command in the project folder and waits for it. */
export function run(command, args, options = {}) {
  return spawnSync(commandLine(command, args), { cwd: ROOT, shell: true, encoding: 'utf8', ...options });
}

export const wrangler = (args, options) => run('npx', ['wrangler', ...args], options);

/** Builds the web app. Returns true when it worked. */
export function build() {
  return run('npm', ['run', 'build'], { stdio: 'inherit' }).status === 0;
}

/** The start command a person would type on this system. */
export const START_COMMAND = IS_WINDOWS ? 'Postdate.cmd' : './postdate.sh';
export const INSTALL_COMMAND = IS_WINDOWS ? 'install.cmd' : './install.sh';

/** Opens an address in the default browser. Failing to is not an error. */
export function openBrowser(url) {
  const [command, args] = IS_WINDOWS
    ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  spawnSync(command, args, { stdio: 'ignore', shell: false });
}
