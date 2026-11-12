<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/grid.svg?title=skiffr&subtitle=Job+application+autofill+that+learns.+Early+development.&align=left&mode=dark" />
    <img alt="skiffr" src="https://shieldcn.dev/header/grid.svg?title=skiffr&subtitle=Job+application+autofill+that+learns.+Early+development.&align=left&mode=light" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/FindMalek/skiffr/actions/workflows/ci.yml"><img alt="CI status" src="https://shieldcn.dev/github/ci/FindMalek/skiffr.svg?variant=secondary" /></a>
  <a href="https://github.com/FindMalek/skiffr/blob/main/LICENSE"><img alt="License" src="https://shieldcn.dev/github/license/FindMalek/skiffr.svg?variant=secondary" /></a>
  <a href="https://github.com/FindMalek/skiffr/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/stars/FindMalek/skiffr.svg?variant=secondary" /></a>
</p>

skiffr is an open-source Chrome extension for job applications. The goal: fill the form from your own profile, learn from the corrections you make, and never submit anything for you. You host the api and the database yourself.

> **Early development, not released.** There is no extension you can install and use yet. What exists today, separately, on `main`: the api and database, the dashboard, AI field mapping, the learning api (correction log and answer lookup) and a tested fill engine. What is coming: connecting them in the browser, so a page is detected, you are asked, it fills, and your edits are learned. See [status](#status).

## Status

What is on `main` today, and what is not.

| Area | State | Notes |
| --- | --- | --- |
| Api: profile, answer bank, jobs, applications, notes, extension tokens | works | oRPC on bun, Postgres with pgvector, covered by router tests |
| Dashboard | works | sign in, edit your profile, create and revoke extension tokens, notes |
| AI field mapping and answer drafting | works, api only | Groq `openai/gpt-oss-120b`, the extension does not call it yet |
| Extension shell | works, does not fill | Manifest V3, options page (api url, token, test connection), token kept away from content scripts. `Ctrl/Cmd+Shift+F` is registered but fills nothing yet |
| Fill engine | merged, not wired | React and Vue controlled inputs, selects, comboboxes, shadow DOM, same-origin iframes, honeypots. Never submits a form. Tested on fixture pages, not yet called from the extension |
| Form detection and the "autofill this application?" toast | in review | [#45](https://github.com/FindMalek/skiffr/pull/45) |
| Learning: correction log, answer lookup, suggestions | merged, api only, the extension does not send corrections yet | [#49](https://github.com/FindMalek/skiffr/pull/49) |
| Playwright harness for the extension (runs in CI) | merged | [#51](https://github.com/FindMalek/skiffr/pull/51) |
| CI with real Postgres and an extension zip | works | required `ci` check |
| Detect, fill and learn running together in the browser | planned | |
| Job queue with a next-job flow | planned | |
| Gmail job-alert ingestion (LinkedIn, Indeed) | planned | |
| Per-site learned field maps, ATS adapters, learned HTTP replay | planned | |
| CV tailoring through Reactive Resume | planned | edits as JSON Patch, never invents facts |
| Dashboard funnel stats | planned | |

## How it works

This is the design being built, not what the extension does today. The [status](#status) table says which parts run.

```mermaid
flowchart LR
  A[Application page] -->|detect| B[Toast: autofill this application?]
  B -->|yes, or Ctrl/Cmd+Shift+F| C[Fill engine]
  P[(Your profile<br/>and answer bank)] --> C
  C -->|fields filled, you review| D[You fix what is wrong]
  D -->|corrections| L[Learning]
  L -->|better answers next time| P
```

1. **Detect** (planned, [#45](https://github.com/FindMalek/skiffr/pull/45) in review). The extension will recognize an application form and ask before doing anything.
2. **Fill** (engine merged, not wired yet). Each field will be matched to your profile or your answer bank. The fill engine sets values the way a user would, so React and Vue forms register them. It never submits a form and never clicks submit, next or apply buttons. It does not touch password or hidden inputs and ignores honeypot fields. It sets a file only on a resume or CV upload slot, and only when it is handed a file. The checkboxes, radios and custom dropdowns it fills are clicked, along with the dropdown's own options, and nothing else.
3. **Learn** (api merged, extension side planned). When you edit a filled value, the edit will be logged as a correction. The api already looks answers up by exact field fingerprint (label, control type and options), then by normalized label, then by embedding similarity. Similarity is only ever a suggestion, never an automatic fill. The goal is corrections per application trending to zero, with advice on which learned answers to keep.

## Architecture

```text
skiffr/
├─ apps/
│  ├─ web/         marketing site, Next.js
│  ├─ dashboard/   Next.js, better-auth: profile, tokens, notes
│  ├─ api/         oRPC on bun, the only app that touches Postgres
│  ├─ extension/   WXT, React, Manifest V3
│  └─ docs/        fumadocs
├─ packages/
│  ├─ ai/          Vercel AI SDK: field mapping, answer drafts
│  ├─ orpc/        procedures and typed clients
│  ├─ db/          Drizzle schema, migrations, pgvector
│  ├─ common/      zod schemas, constants, utils shared everywhere
│  ├─ auth/        better-auth setup
│  ├─ env/         zod-validated env, one root .env
│  ├─ storage/     S3 compatible storage
│  ├─ ui/          shadcn components, monochrome preset
│  └─ config/      shared tsconfig
├─ docker/         local Postgres with pgvector
└─ turbo.json
```

`apps/api` is the only app that touches the database, auth and model providers. The dashboard and the extension call it through `@skiffr/orpc`. The extension authenticates with a personal access token (`skp_...`), stored hashed on the server, and can only call a short allowlist of procedures.

## Quick start

You need node 24, pnpm, bun and docker.

```bash
pnpm install
cp .env.example .env     # then set BETTER_AUTH_SECRET and ADMIN_PASSWORD, see below
pnpm db:up               # Postgres with pgvector on :5432
pnpm dev --filter='!extension'
```

In `.env`, `BETTER_AUTH_SECRET` must be at least 32 characters (`openssl rand -base64 32` gives 44) or the api refuses to start. `ADMIN_PASSWORD` must be at least 10 characters. If it or `ADMIN_EMAIL` is empty, no admin is created. `DATABASE_URL` already matches the local Postgres from `pnpm db:up`.

`pnpm dev` runs `turbo dev`, which starts every workspace that has a `dev` script: web, api, dashboard, docs and also `extension` (`wxt`, which opens a development browser with the extension loaded). `pnpm dev --filter='!extension'` starts only the four apps below. To run the extension on its own: `pnpm --filter extension dev`.

| App | Url |
| --- | --- |
| `apps/web` | http://localhost:3000 |
| `apps/api` | http://localhost:3001 |
| `apps/dashboard` | http://localhost:3002 |
| `apps/docs` | http://localhost:3003 |

Sign in to the dashboard with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`, save your profile, and create a token on the Extension page.

### Load the extension (development only)

The extension does not fill pages yet, so this is for developers: you can check the options page and the connection to your api. It needs Chrome 142 or newer (the manifest minimum; the token isolation below is the reason), or a Chromium browser of the same age (Arc, Brave, Edge).

```bash
pnpm --filter extension build
```

Open `chrome://extensions`, turn on developer mode, choose "Load unpacked" and pick `apps/extension/.output/chrome-mv3`. In the extension options, set the api url (`http://localhost:3001`) and paste your token, then press test connection. `pnpm --filter extension dev` opens a dev browser with hot reload.

### Install from a CI build

For testers, not users: the build loads, but it does not fill pages yet. Every pull request builds the extension and uploads the artifact `extension-chrome-pr-<number>`, and every push to `main` uploads `extension-chrome-latest`.

1. Open the [CI runs](https://github.com/FindMalek/skiffr/actions/workflows/ci.yml), pick a run and download the artifact (GitHub login required, artifacts expire after 14 days, `latest` after 90).
2. Unzip the download. GitHub wraps the artifact in its own zip, so inside is another zip, `extension-<version>-chrome.zip`.
3. Extract that zip into a new empty folder. Its files (`manifest.json`, `background.js` and so on) are at the top level.
4. In `chrome://extensions`, turn on developer mode, choose "Load unpacked" and pick that folder.

There are no releases, signed packages or Chrome Web Store listing yet.

### Keyboard shortcut

`Ctrl+Shift+F` (`Cmd+Shift+F` on macOS) is registered in the manifest and the background worker forwards it to the page, but it does not fill anything yet: the content script only logs in development builds. It will ask the extension to fill the current page once the fill engine is wired. You can already remap it at `chrome://extensions/shortcuts`.

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | every workspace with a `dev` script: the four apps and the extension dev server. `pnpm dev --filter='!extension'` leaves the extension out |
| `pnpm build` | build everything with turbo |
| `pnpm lint` | `biome ci . && oxlint` over the whole repo |
| `pnpm check` | biome format and fix |
| `pnpm check-types` | typescript across the repo |
| `pnpm test` | tests in every package |
| `pnpm e2e` | build the extension and run the playwright e2e suite in `apps/e2e` |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:studio` | drizzle |
| `pnpm zip` | zip the extension for upload |
| `pnpm ui:add <component>` | add a shadcn component |

Router tests run on pglite. To run them on real Postgres, set `TEST_DATABASE_URL` to a server url whose database name starts with `skiffr_test` (for example `postgres://skiffr:skiffr@localhost:5432/skiffr_test`). Each run creates and drops its own database.

### e2e

`apps/e2e` loads the built extension into Chromium (`channel: "chromium"`, headless) and drives it against fixture ats pages served on `127.0.0.1`, with a mock api that implements the `@skiffr/common` schemas. Run `pnpm e2e` (builds the extension first), or point `E2E_EXTENSION_DIR` at an unzipped release to test that instead: CI does this with the zip from the `extension` job. Install the browser once with `pnpm --filter e2e exec playwright install chromium`. Specs for features that have not landed are `test.fixme` in `apps/e2e/tests/pending.spec.ts`.

## Configuration

One root `.env` feeds every app, `.env.example` lists every key. The ones that matter for the product:

| Key | Needed for | Without it |
| --- | --- | --- |
| `GROQ_API_KEY` | mapping fields and drafting answers (`AI_MODEL` defaults to `groq:openai/gpt-oss-120b`) | the ai endpoints answer "No AI provider key is configured". Profile, answer bank and dashboard keep working, but nothing can be mapped for a new form |
| `OPENAI_API_KEY` | embedding similarity for learned answers (`text-embedding-3-small`) | optional. Similarity suggestions are skipped, exact and label matches still work |
| `DATABASE_URL` | everything | the api does not start |
| `EXTENSION_ORIGINS` | pinning the api to your extension id (`chrome-extension://<id>`, comma separated) | any extension origin may call the api with a valid token |

`AI_MODEL` can also point at `openai:` or `anthropic:` models if you set the matching key.

## Self-hosting

skiffr is built to run on your own server: the api, the Next apps and a Postgres with the `vector` extension, one Dockerfile per app. The Dokploy, Docker and Vercel steps, including the pgvector image and why you must not swap an existing database image in place, are in [`apps/docs/content/docs/deploy.mdx`](apps/docs/content/docs/deploy.mdx) (also served by `apps/docs` at `/docs/deploy`). The Dokploy deploy workflow and its one-shot bootstrap (`scripts/dokploy-bootstrap.mjs`) are in the same page.

## Privacy

Your profile and answers live in your Postgres. The extension does not fill pages yet, so today it only calls your api for the connection test. Below is what the connected flow will send, and what the api already accepts:

- **To your own api:** field labels, names, placeholders, input types and option texts of the form being filled, and the filled and final values of fields you correct (up to 2000 characters each). The extension has no analytics and is built to talk to no server except the api you set.
- **To the language model provider you configured (Groq by default):** the same field descriptors, plus the names of your profile keys, plus the values of a short allowlist of keys: first and last name, city, country, work authorization, links, and a few free-form fields such as headline, skills or availability. Email, phone, address, pay, ids and dates of birth are not in the allowlist and are never sent. Password, hidden and file inputs are dropped before the request. Page text is wrapped as untrusted data in the prompt. When you ask for a drafted answer, it also gets the question, the job description and up to 5 of your earlier answers. Source: `packages/ai/src/shared-keys.ts`.
- **To OpenAI, only if you set `OPENAI_API_KEY` (learning):** the normalized question label, to compute an embedding. Never the answer.
- **Never:** form submission. The fill engine does not submit a form, click submit, next or apply buttons, or touch password or hidden inputs. It sets a file only on a resume or CV slot and only when handed one, and clicks only the controls it fills (checkboxes, radios, custom dropdowns and their own options).
- **Tokens:** the background worker and the extension's options page read the token and call the api. Content scripts on web pages are kept from it by `storage.local.setAccessLevel("TRUSTED_CONTEXTS")`, which the extension relies on, so the manifest requires Chrome 142 or newer (`minimum_chrome_version`). The server stores a SHA-256 hash.
- **Learned answers:** labels for secrets, card and bank data, government and tax ids, birth dates and equal opportunity categories are skipped by the learning code, and so are values that look like a card number (Luhn), an IBAN or a US social security number, whatever the field is called. Stored embeddings never leave the api.
- **The event log:** for every filled field the api keeps one row with the raw label, the filled value and the final value, per user. Rows older than 90 days are deleted, but only when the extension records events or asks for suggestions, and 500 rows at a time. On a quiet account older rows can stay. Rows are removed with the user (foreign key `on delete cascade`). There is no self-service account deletion in the dashboard yet.

The model providers have their own retention terms. If that is not acceptable, leave their keys unset: the product degrades, but nothing is sent to them.

The content script is injected on all pages (`<all_urls>`), because an application form can be on any careers site. See [How skiffr learns](apps/docs/content/docs/learning.mdx) and [Privacy and data flow](apps/docs/content/docs/privacy.mdx) for the longer version.

## Security

Report vulnerabilities privately through GitHub: Security tab, "Report a vulnerability". Please do not open a public issue. Details and scope are in [SECURITY.md](SECURITY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: one issue per pull request with `closes #<n>`, conventional commits `type(scope): subject` with a subject of at most 5 words, squash merges, and the required `ci` check green. Pull request screenshots go to the orphan `pr-screenshots` branch as `<pr-number>/<name>.png`, never into a feature branch. Everyone is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE), copyright (c) 2026 FindMalek.
