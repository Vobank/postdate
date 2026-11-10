# Security

## Reporting a problem

Please do not open a public issue for a vulnerability. Use GitHub's
**Security → Report a vulnerability** on this repository instead, and include
steps to reproduce. You should get a reply within a few days.

## How Postdate protects an instance

- **Accounts.** People sign in with an email and a password. Passwords are
  stored as salted PBKDF2-SHA256 hashes (100 000 iterations, the most the
  Workers runtime allows). Every channel and message belongs to one account,
  and every request is limited to the rows of the account that made it.
- **Sessions** are random 256-bit tokens in an `HttpOnly`, `SameSite=Strict`
  cookie. Only a SHA-256 hash of the token is stored. Changing the password
  ends every session of that account.
- **Sign-in throttling.** Eight wrong passwords from one address within fifteen
  minutes lock that address out until the window passes. One address can
  create at most five accounts in the same window.
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

- **Sign-ups are open by default.** Anyone who knows the address can create an
  account and send through channels they set up themselves. Set the `SIGNUPS`
  variable to `closed` to stop new accounts; the first account can always be
  created.
- **Emails are not verified.** An email is a sign-in name, nothing more:
  Postdate never sends to it, and cannot reset a password through it.
- **Upgrading from 0.2.** Messages and channels from before accounts existed go
  to the first account created, so create yours straight after deploying. The
  old instance password no longer signs anyone in.
- Message texts and recipient addresses are stored unencrypted in your D1
  database, because the dispatcher has to read them to send them.
- Anyone who has your Cloudflare account has everything. Protect it with
  two-factor authentication.
- A backup downloaded from Settings contains message texts and recipients, but
  none of the channel secrets. Treat the file like the messages themselves.
- If you lose `SECRET_KEY`, saved channels cannot be decrypted. Set a new key,
  then delete and re-create the channels.

## Locked out?

There is no password reset by email. Whoever runs the instance can move an
account's messages and channels to a fresh one: create a new account in the
browser, then hand it the old account's rows and remove the old account.

```sh
npx wrangler d1 execute postdate --remote --command "
  UPDATE channels SET user_id = (SELECT id FROM users WHERE email = 'new@example.com')
    WHERE user_id = (SELECT id FROM users WHERE email = 'old@example.com');
  UPDATE messages SET user_id = (SELECT id FROM users WHERE email = 'new@example.com')
    WHERE user_id = (SELECT id FROM users WHERE email = 'old@example.com');
  DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'old@example.com');
  DELETE FROM users WHERE email = 'old@example.com';"
```
