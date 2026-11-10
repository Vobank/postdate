# Contributing

Thanks for wanting to help. Small, focused pull requests are the easiest to
review. For anything large, open an issue first so we can agree on the shape.

## Running it locally

```sh
npm install
npm run dev
```

Open <http://localhost:5173>. The worker runs on port 8787 with a local D1
database kept under `.wrangler/`; nothing touches your Cloudflare account.

To make the dispatcher run without waiting for a cron tick:

```sh
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

Before you push:

```sh
npm run typecheck
npm test
```

## Where things are

| Path | What lives there |
| --- | --- |
| `src/shared/` | Code used by both sides: schedule arithmetic, message variables, channel definitions, API types |
| `src/worker/` | The Cloudflare Worker: API, auth, encryption, senders, cron dispatcher |
| `src/client/` | The web app (Preact) |
| `src/client/locales/` | One JSON file per language |
| `scripts/` | The installer (`setup.mjs`), the local launcher (`start.mjs`), deploy and dev helpers, and the installer's own translations (`messages.mjs`) |
| `test/` | Unit tests |

## Adding a channel type

1. Describe its settings in `CHANNELS` in `src/shared/channels.ts`. The
   settings form is generated from that definition. A field of kind `toggle`
   becomes a checkbox; a `select` whose option needs translating gets an
   `option.<value>` string.
2. Write the sender in `src/worker/senders.ts` and add it to `SENDERS`, and
   draw its glyph in `src/client/icons.tsx`.
3. Add `type.<name>`, `type.<name>.help` and any new `field.<key>` strings to
   **every** file in `src/client/locales/`. The tests fail if one is missing.
4. Write its step-by-step guide: `guide.<name>.1`, `guide.<name>.2`, … in every
   locale, and the number of steps in `GUIDE_STEPS` in
   `src/client/views/Channels.tsx`. A guide names a field as `{key}`, which is
   replaced by that field's label.

## Adding or fixing a translation

Each language is one file in `src/client/locales/`. Keys must match `en.json`
and placeholders such as `{field}` must be kept. To add a language, copy
`en.json`, translate it, and list the language in `LANGUAGES` in
`src/client/i18n.ts`. Dates and times are formatted by the browser, so there is
nothing to translate there. The installer has its own short list of strings in
`scripts/messages.mjs`.

Corrections from native speakers are very welcome.

## Changing the database

Tables are created and upgraded by the worker itself (`src/worker/db.ts`).
Append a new entry to `MIGRATIONS`; never edit one that has shipped.
