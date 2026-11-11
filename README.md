<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/grid.svg?title=skiffr&subtitle=Job+application+autofill+that+learns+from+every+form+you+fix&align=left&mode=dark" />
    <img alt="skiffr" src="https://shieldcn.dev/header/grid.svg?title=skiffr&subtitle=Job+application+autofill+that+learns+from+every+form+you+fix&align=left&mode=light" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/FindMalek/skiffr/actions/workflows/ci.yml"><img alt="CI status" src="https://shieldcn.dev/github/ci/FindMalek/skiffr.svg?variant=secondary" /></a>
  <a href="https://github.com/FindMalek/skiffr/blob/main/LICENSE"><img alt="License" src="https://shieldcn.dev/github/license/FindMalek/skiffr.svg?variant=secondary" /></a>
  <a href="https://github.com/FindMalek/skiffr/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/stars/FindMalek/skiffr.svg?variant=secondary" /></a>
</p>

skiffr is an open-source Chrome extension that fills job applications from your own profile, and gets better each time you correct it. You host the api and the database yourself, nothing is submitted for you.

> Pre-release. The backend, dashboard and fill engine are merged, the extension is not connected end to end yet. See [status](#status).

## Status

What is on `main` today, and what is not.

| Area | State | Notes |
| --- | --- | --- |
| Api: profile, answer bank, jobs, applications, notes, extension tokens | works | oRPC on bun, Postgres with pgvector, covered by router tests |
| Dashboard | works | sign in, edit your profile, create and revoke extension tokens, notes |
| AI field mapping and answer drafting | works, api only | Groq `openai/gpt-oss-120b`, the extension does not call it yet |
| Extension shell | works | Manifest V3, options page (api url, token, test connection), token kept away from content scripts, `Ctrl/Cmd+Shift+F` registered |
| Fill engine | merged, not wired | React and Vue controlled inputs, selects, comboboxes, shadow DOM, same-origin iframes, honeypots. Never submits. Tested on fixture pages, not yet called from the extension |
| Form detection and the "autofill this application?" toast | in review | [#45](https://github.com/FindMalek/skiffr/pull/45) |
| Learning: correction log, answer lookup, suggestions | in review | [#49](https://github.com/FindMalek/skiffr/pull/49) |
| Playwright harness for the extension | in review | [#51](https://github.com/FindMalek/skiffr/pull/51) |
| CI with real Postgres and an extension zip | works | required `ci` check |
| Detect, fill and learn running together in the browser | planned | |
| Job queue with a next-job flow | planned | |
| Gmail job-alert ingestion (LinkedIn, Indeed) | planned | |
| Per-site learned field maps, ATS adapters, learned HTTP replay | planned | |
| CV tailoring through Reactive Resume | planned | edits as JSON Patch, never invents facts |
| Dashboard funnel stats | planned | |

## How it works

This is the design. The [status](#status) table says which parts run today.

```mermaid
flowchart LR
  A[Application page] -->|detect| B[Toast: autofill this application?]
  B -->|yes, or Ctrl/Cmd+Shift+F| C[Fill engine]
  P[(Your profile<br/>and answer bank)] --> C
  C -->|fields filled, you review| D[You fix what is wrong]
  D -->|corrections| L[Learning]
  L -->|better answers next time| P
```

1. **Detect.** The extension recognizes an application form on a page and asks before doing anything.
2. **Fill.** Each field is matched to your profile or your answer bank. Known answers are used first, a language model maps what is left. The fill engine sets values the way a user would, so React and Vue forms register them. It skips password, hidden and file inputs, ignores honeypot fields, and never clicks submit.
3. **Learn.** When you edit a filled value, the edit is logged as a correction. Answers are looked up by exact field fingerprint, then by normalized label, then by embedding similarity. Similarity is only ever a suggestion, never an automatic fill. The goal is corrections per application trending to zero, with advice on which learned answers to keep.

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
cp .env.example .env     # set BETTER_AUTH_SECRET (openssl rand -base64 32) and ADMIN_PASSWORD
pnpm db:up               # Postgres with pgvector on :5432
pnpm dev
```

| App | Url |
| --- | --- |
| `apps/web` | http://localhost:3000 |
| `apps/api` | http://localhost:3001 |
| `apps/dashboard` | http://localhost:3002 |
| `apps/docs` | http://localhost:3003 |

Sign in to the dashboard with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`, save your profile, and create a token on the Extension page.

### Load the extension

The extension is not part of `pnpm dev`. It needs Chrome 142 or newer, or a Chromium browser of the same age (Arc, Brave, Edge).

```bash
pnpm --filter extension build
```

Open `chrome://extensions`, turn on developer mode, choose "Load unpacked" and pick `apps/extension/.output/chrome-mv3`. In the extension options, set the api url (`http://localhost:3001`) and paste your token, then press test connection. `pnpm --filter extension dev` opens a dev browser with hot reload.

### Install from a CI build

Every pull request builds a zip, uploaded as the artifact `extension-chrome-pr-<number>`, and every push to `main` uploads `extension-chrome-latest`. Open the [CI runs](https://github.com/FindMalek/skiffr/actions/workflows/ci.yml), pick a run, download the artifact (GitHub login required, artifacts expire after 14 days, `latest` after 90), unzip it and load the folder as unpacked. Signed releases and a Chrome Web Store listing are coming, not available yet.

### Keyboard shortcut

`Ctrl+Shift+F` (`Cmd+Shift+F` on macOS) asks the extension to fill the current page. Remap it at `chrome://extensions/shortcuts`.

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | run every app except the extension |
| `pnpm build` | build everything with turbo |
| `pnpm lint` | biome and oxlint |
| `pnpm check` | biome format and fix |
| `pnpm check-types` | typescript across the repo |
| `pnpm test` | tests in every package |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:studio` | drizzle |
| `pnpm zip` | zip the extension for upload |
| `pnpm ui:add <component>` | add a shadcn component |

Router tests run on pglite. To run them on real Postgres, set `TEST_DATABASE_URL` to a server url whose database name starts with `skiffr_test` (for example `postgres://skiffr:skiffr@localhost:5432/skiffr_test`). Each run creates and drops its own database.

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

skiffr is built to run on your own server: the api, the Next apps and a Postgres with the `vector` extension, one Dockerfile per app. The Dokploy, Docker and Vercel steps, including the pgvector image and why you must not swap an existing database image in place, are in [`apps/docs/content/docs/deploy.mdx`](apps/docs/content/docs/deploy.mdx) (also served by `apps/docs` at `/docs/deploy`).

## Privacy

Your profile and answers live in your Postgres. This is what leaves your machine, exactly:

- **To your own api:** field labels, names, placeholders, input types and option texts of the form being filled, the answers you correct, and your token. The extension has no analytics and talks to no other server.
- **To the language model provider you configured (Groq by default):** the same field descriptors, plus the names of your profile keys, plus the values of a short allowlist of keys: first and last name, city, country, work authorization, links, and a few free-form fields such as headline, skills or availability. Email, phone, address, pay, ids and dates of birth are not in the allowlist and are never sent. Password, hidden and file inputs are dropped before the request. Page text is wrapped as untrusted data in the prompt. When you ask for a drafted answer, it also gets the question, the job description and up to 5 of your earlier answers. Source: `packages/ai/src/shared-keys.ts`.
- **To OpenAI, only if you set `OPENAI_API_KEY` (learning, in review):** the normalized question label, to compute an embedding. Never the answer.
- **Never:** form submission. The fill engine does not submit, click buttons, or touch password or hidden inputs.
- **Tokens:** kept in extension storage restricted to trusted contexts. Only the background worker reads it and calls the api, content scripts on web pages never see it. The server stores a SHA-256 hash.
- **Learned answers:** labels for secrets, card and bank data, government and tax ids, birth dates and equal opportunity categories are skipped by the learning code (in review). Stored embeddings never leave the api.

The model providers have their own retention terms. If that is not acceptable, leave their keys unset: the product degrades, but nothing is sent to them.

The content script is injected on all pages (`<all_urls>`), because an application form can be on any careers site. See [How skiffr learns](apps/docs/content/docs/learning.mdx) and [Privacy and data flow](apps/docs/content/docs/privacy.mdx) for the longer version.

## Security

Report vulnerabilities privately through GitHub: Security tab, "Report a vulnerability". Please do not open a public issue. Details and scope are in [SECURITY.md](SECURITY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: one issue per pull request with `closes #<n>`, conventional commits `type(scope): subject` with a subject of at most 5 words, squash merges, and the required `ci` check green. Pull request screenshots go to the orphan `pr-screenshots` branch as `<pr-number>/<name>.png`, never into a feature branch. Everyone is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE), copyright (c) 2026 FindMalek.
