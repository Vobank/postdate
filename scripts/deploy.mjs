// Builds the app and publishes it to Cloudflare, with the choices the installer
// saved (who may sign up, the default language). Run by `npm run deploy`.
import { build, readConfig, workerVars, wrangler } from './lib.mjs';

if (!build()) process.exit(1);

const config = readConfig();
// Without a saved configuration the worker's own defaults apply.
const vars = config ? workerVars(config) : [];
const result = wrangler(['deploy', ...vars], { stdio: 'inherit' });
process.exit(result.status ?? 1);
