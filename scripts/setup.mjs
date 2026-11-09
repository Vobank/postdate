// First-time deployment: builds the app, deploys it to your Cloudflare account,
// and makes sure the worker has a SECRET_KEY. Safe to run again; an existing
// key is never replaced, because replacing it would make saved channels unreadable.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

function run(args, options = {}) {
  return spawnSync('npx', ['wrangler', ...args], { shell: true, encoding: 'utf8', ...options });
}

function step(title) {
  console.log(`\n${title}`);
}

step('1/3  Checking the Cloudflare login');
if (run(['whoami']).status !== 0) {
  const login = run(['login'], { stdio: 'inherit' });
  if (login.status !== 0) {
    console.error('Could not sign in to Cloudflare. Run "npx wrangler login" and try again.');
    process.exit(1);
  }
}

step('2/3  Building and deploying');
const build = spawnSync('npm', ['run', 'build'], { shell: true, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const deploy = run(['deploy'], { stdio: ['inherit', 'pipe', 'inherit'] });
process.stdout.write(deploy.stdout ?? '');
if (deploy.status !== 0) {
  console.error('\nThe deploy failed. Fix the error above and run "npm run setup" again.');
  process.exit(deploy.status ?? 1);
}
const url = /https:\/\/[^\s]+\.workers\.dev/.exec(deploy.stdout ?? '')?.[0];

step('3/3  Checking SECRET_KEY');
const listed = run(['secret', 'list', '--format', 'json']);
let hasKey = false;
try {
  hasKey = JSON.parse(listed.stdout).some((secret) => secret.name === 'SECRET_KEY');
} catch {
  hasKey = /SECRET_KEY/.test(listed.stdout ?? '');
}

if (hasKey) {
  console.log('SECRET_KEY is already set. Leaving it as it is.');
} else {
  // Generated here and piped straight to Wrangler; it is never printed or written to disk.
  const put = run(['secret', 'put', 'SECRET_KEY'], {
    input: randomBytes(32).toString('base64'),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (put.status !== 0) {
    console.error('\nCould not store SECRET_KEY. Run "npx wrangler secret put SECRET_KEY" yourself.');
    process.exit(put.status ?? 1);
  }
}

console.log('\nDone.');
if (url) {
  console.log(`Open ${url} now and choose your password.`);
  console.log('Until you do, the first person to open that address can claim the instance.');
} else {
  console.log('Open the workers.dev address printed above and choose your password.');
}
