# Security

## Reporting a problem

Please do not open a public issue for a vulnerability. Use GitHub's
**Security → Report a vulnerability** on this repository instead, and include
steps to reproduce. You should get a reply within a few days.

## How Postdate protects an instance

- **One owner.** An instance has a single password, chosen on first visit. It
  is stored as a salted PBKDF2-SHA256 hash (100 000 iterations, the most the
  Workers runtime allows).
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Strict`
  cookie. Only a SHA-256 hash of the token is stored. Changing the password
  ends every session.
- **Sign-in throttling.** Eight wrong passwords from one address within fifteen
  minutes lock that address out until the window passes.
- **Cross-site requests** are refused: every state-changing call needs a custom
  header and a same-origin `Origin`.
- **Channel credentials** (SMTP passwords, bot tokens, webhook URLs) are
  encrypted with AES-256-GCM before they reach the database. The key is derived
  from the `SECRET_KEY` Worker secret, which lives outside the database, so a
  database export on its own does not reveal them. Secrets are never sent back
  to the browser after saving.
- **The browser** gets a strict Content-Security-Policy: scripts and styles
  from the same origin only, no inline code, no framing.

## Things to know

- **Claim your instance straight after deploying.** Until a password is set,
  the first visitor can set one.
- Message texts and recipient addresses are stored unencrypted in your D1
  database, because the dispatcher has to read them to send them.
- Anyone who has your Cloudflare account has everything. Protect it with
  two-factor authentication.
- If you lose `SECRET_KEY`, saved channels cannot be decrypted. Set a new key,
  then delete and re-create the channels.

## Locked out?

Remove the password and the open sessions, then visit the site to set a new one:

```sh
npx wrangler d1 execute postdate --remote --command "DELETE FROM settings WHERE key = 'password'; DELETE FROM sessions;"
```
