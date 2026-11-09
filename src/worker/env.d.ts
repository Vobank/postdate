// Bindings declared in wrangler.jsonc are typed by `wrangler types`.
// Secrets are not part of that file, so the one this worker reads is added here.
interface Env {
  SECRET_KEY?: string;
}
