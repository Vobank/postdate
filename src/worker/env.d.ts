// Bindings declared in wrangler.jsonc are typed by `wrangler types`.
// Secrets are not part of that file, so the one this worker reads is added here.
interface Env {
  SECRET_KEY?: string;
  /** Set to "closed" to stop new accounts being created once the first one exists. */
  SIGNUPS?: string;
  /** Language the app opens in for a visitor who has not chosen one, e.g. "ru". */
  DEFAULT_LANG?: string;
}
