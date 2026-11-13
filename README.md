<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/grid.svg?title=skiffr&subtitle=Job+application+autofill+that+learns.+Open+source%2C+self-hosted.&align=left&mode=dark" />
    <img alt="skiffr" src="https://shieldcn.dev/header/grid.svg?title=skiffr&subtitle=Job+application+autofill+that+learns.+Open+source%2C+self-hosted.&align=left&mode=light" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/FindMalek/skiffr/actions/workflows/ci.yml"><img alt="CI status" src="https://shieldcn.dev/github/ci/FindMalek/skiffr.svg?variant=secondary" /></a>
  <a href="https://github.com/FindMalek/skiffr/blob/main/LICENSE"><img alt="License" src="https://shieldcn.dev/github/license/FindMalek/skiffr.svg?variant=secondary" /></a>
  <a href="https://github.com/FindMalek/skiffr/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/stars/FindMalek/skiffr.svg?variant=secondary" /></a>
</p>

<p align="center">
  <a href="https://skiffr.findmalek.engineer"><b>App</b></a> ·
  <a href="https://dashboard.skiffr.findmalek.engineer"><b>Dashboard</b></a> ·
  <a href="https://docs.skiffr.findmalek.engineer"><b>Docs</b></a> ·
  <a href="https://api.skiffr.findmalek.engineer/health"><b>API status</b></a>
</p>

skiffr is an open-source Chrome extension for job applications. It spots an application form, asks, fills it from your own profile and answer bank, and never submits anything for you. A dashboard keeps your profile, answers and a queue of jobs to apply to. You host the api and the database yourself: your profile, answers, queue and tokens live in your own Postgres, and only a small listed slice goes to a model provider, and only if you set a key.

> **Early development.** Releases are published automatically from `main`, but there is no Chrome Web Store listing yet: you load the extension by hand (see [quick start](#quick-start)). The extension learns from your edits, with the limits listed under [how it works](#how-it-works).

<p align="center">
  <img alt="The toast asking to autofill an application" width="49%" src="https://raw.githubusercontent.com/FindMalek/skiffr/pr-screenshots/59/57-toast-ask.png" />
  <img alt="The result after a fill, with uncertain fields outlined" width="49%" src="https://raw.githubusercontent.com/FindMalek/skiffr/pr-screenshots/59/57-result-filled.png" />
</p>
<p align="center">
  <img alt="Job queue in the dashboard" width="32%" src="https://raw.githubusercontent.com/FindMalek/skiffr/pr-screenshots/61/14-desktop-light.png" />
  <img alt="Funnel stats in the dashboard" width="32%" src="https://raw.githubusercontent.com/FindMalek/skiffr/pr-screenshots/72/15-stats-data-1280-light.png" />
  <img alt="Watched job sources in the dashboard" width="32%" src="https://raw.githubusercontent.com/FindMalek/skiffr/pr-screenshots/74/13-sources-with-sources-1280-light.png" />
</p>

## Live

The hosted instance runs on a self-hosted Dokploy server and deploys from `main` after CI passes.

| What | Link |
| --- | --- |
| App (landing) | https://skiffr.findmalek.engineer |
| Dashboard (sign in, queue, answers, settings) | https://dashboard.skiffr.findmalek.engineer |
| Docs | https://docs.skiffr.findmalek.engineer |
| API health | https://api.skiffr.findmalek.engineer/health |

It is the maintainer's own development instance, not a service with an uptime promise, and anything you enter there is stored on the maintainer's server. For real use, run your own: see [self-hosting](#self-hosting).

## What it does

**In the browser (the extension)**

- Detects an application form (Greenhouse, Lever, Ashby, Workable, Workday and others, also inside iframes) and shows a small toast: yes, no, or "don't ask on this site". `Ctrl+Shift+F` (`Cmd+Shift+F` on macOS) fills the current page without the toast.
- Fills the form the way a person types, so React and Vue forms accept it: inputs, selects, comboboxes, checkboxes, radios, shadow DOM, same-origin iframes. Honeypots are skipped.
- Answers each field from the best source it has: what you filled on this very form before, then a saved answer for the same question, then a language model that maps the field to a key of your profile. Fields the model is unsure about are filled and outlined in amber for you to check.
- Learns from your edits: after a skiffr fill it records what you corrected, cleared or left as filled, so the next form starts from your answers. Sensitive fields are never recorded.
- Never submits a form, never clicks submit, next or apply, never touches password or hidden inputs.

**In the dashboard**

- **Profile and answer bank.** Edit your profile and your saved answers, with use and correction counts and keep or drop suggestions.
- **Queue.** Jobs you want to apply to, with source, status and an "Open next" flow. You press submit yourself.
- **Gmail connector.** Turns LinkedIn, Indeed and Glassdoor job alert emails into queued jobs. It asks for the `gmail.modify` scope because it also marks processed mail read, takes it out of the inbox and adds a `skiffr/jobs` label. It never deletes or sends mail. [Docs](apps/docs/content/docs/gmail.mdx)
- **Source watcher.** Watches careers pages, RSS or Atom feeds and Greenhouse, Lever, Ashby or Workable boards, and queues new postings. [Docs](apps/docs/content/docs/sources.mdx)
- **Stats.** Applications per day and week, queue funnel, replies, by source, ATS, role and match score, and how well autofill knows you.
- **Extension tokens.** Create and revoke the personal tokens the extension uses.

**On the api**

- A learning api: a correction log, answer lookup (exact fingerprint, then normalized label, then embedding similarity as a suggestion only) and keep or drop suggestions. See [how skiffr learns](apps/docs/content/docs/learning.mdx).

### What needs keys

Everything works without these except the parts that name them. All are optional.

| Key | Needed for | Without it |
| --- | --- | --- |
| `GROQ_API_KEY` ([Groq](https://console.groq.com/keys)) | mapping fields the saved answers do not cover, which can also return a short generated value such as a yes or no or an option pick, shown outlined for you to check (default model `openai/gpt-oss-120b`). The api can also draft answers, but the extension does not call that yet | the ai endpoints say no provider key is configured. Profile, answers, queue and saved-answer fills keep working |
| `OPENAI_API_KEY` ([OpenAI](https://platform.openai.com/api-keys)) | embedding similarity for learned answers | similar-question suggestions are skipped, exact and label matches still work |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_ENCRYPTION_KEY` ([Google Cloud](https://console.cloud.google.com/)) | the Gmail connector | the Gmail page says it is not set up. Setup is in the [Gmail docs](apps/docs/content/docs/gmail.mdx), and it has only been tested against a local stand-in for Google's api |

`AI_MODEL` can also point at `openai:` or `anthropic:` models with the matching key. Every key is listed in the [environment docs](apps/docs/content/docs/environment.mdx). The source watcher needs no keys.

## How it works

```mermaid
flowchart LR
  A[Application page] -->|detect| B[Toast: autofill this application?]
  B -->|yes, or Ctrl/Cmd+Shift+F| C[Fill engine]
  P[(Your profile<br/>and answer bank)] --> C
  M[Language model<br/>optional] --> C
  C -->|fields filled, uncertain ones outlined| D[You review, edit and submit]
  D -->|edits recorded| L[(Learned answers)]
  L --> C
```

Learning from your edits closes this loop: the edit is logged as a correction and the better answer is used first next time. Limits of the learning step today:

- It only records after a skiffr fill, and fields that already had a value at fill time are not recorded.
- It sends when you submit the form, when you leave the page or the tab goes to the background, or after 5 minutes without an edit, at most 3 batches per session. A hidden tab cannot send, so closing a background tab or quitting the browser loses that batch.
- Forms with more than 60 learnable fields only record the first 60.
- Sensitive fields and values are filtered in the content script and again in the worker, so they never reach your api.
- Cross-origin iframes are not recorded yet.

## Architecture

```text
skiffr/
├─ apps/
│  ├─ web/         landing page, Next.js
│  ├─ dashboard/   Next.js, better-auth: profile, answers, queue, stats, Gmail, sources, tokens
│  ├─ api/         oRPC on bun, the only app that touches Postgres
│  ├─ extension/   WXT, React, Manifest V3
│  ├─ e2e/         Playwright suite for the extension
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

`apps/api` is the only app that touches the database, auth and model providers. The dashboard and the extension call it through `@skiffr/orpc`. The extension authenticates with a personal access token (`skp_...`), stored hashed on the server, and can only call a short allowlist of procedures. More in [structure](apps/docs/content/docs/structure.mdx).

## Quick start

Three steps, nothing to build. You need Docker and Chrome (or Edge, Brave, Arc: any Chromium 142 or newer).

### 1. Run one command

```bash
curl -fsSL https://raw.githubusercontent.com/FindMalek/skiffr/main/install.sh | sh
```

It makes a `skiffr/` folder, generates every secret into `skiffr/.env`, starts Postgres, the api, the dashboard, the site and the docs, waits until they are healthy and prints your urls and admin login. It asks nothing and is safe to run again (it never overwrites `.env` or your data). The commands further down (`./skiffr update`, `docker compose ...`) run inside that folder, so `cd skiffr` first. No curl: `git clone https://github.com/FindMalek/skiffr && cd skiffr && ./scripts/setup.sh` does the same from a clone (add `--build` to build the images from the source, which does not include the extension zip: build the extension yourself, see below).

| What | Url |
| --- | --- |
| dashboard (sign in here) | http://localhost:3002 |
| api (what the extension talks to) | http://localhost:3001 |
| site and docs | http://localhost:3000, http://localhost:3003 |

Options: `--port 4000` for other ports, `--domain skiffr.example.com` for your own domain with automatic https, `--version v0.1.0` to pin a release, `--autoupdate` for daily automatic updates. All of them are in the [install guide](apps/docs/content/docs/install.mdx).

### 2. Load the extension (60 seconds)

Chrome cannot install an extension from a file or a script on its own, so this one takes a minute by hand. Your own server serves the extension that matches its version.

1. Download http://localhost:3001/downloads/skiffr-extension.zip and unzip it into a folder you will keep (Chrome does not install zips directly, it loads the unzipped folder).
2. Open `chrome://extensions` (`edge://extensions`, `brave://extensions` and `arc://extensions` work the same) and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder. Pin the skiffr icon from the puzzle menu.

Firefox is not supported yet.

### 3. Connect it and apply

1. Open http://localhost:3002, sign in with the email and password the installer printed (they are in `skiffr/.env` too, `ADMIN_EMAIL` and `ADMIN_PASSWORD`) and fill in your profile.
2. In the dashboard open **Extension** and create a token. Copy it.
3. Right-click the skiffr icon, **Options**. Set the api url to `http://localhost:3001`, paste the token and press **Test connection**.
4. Open a job application form. A toast asks "Autofill this application?". Press **Yes**, check the fields (amber outlines are guesses), fix what is wrong and press submit yourself: skiffr never submits anything for you.

First run checklist: profile saved, token created and tested, one real application form filled. Corrections you make are remembered for the next form.

### When something does not work

| Problem | Fix |
| --- | --- |
| `Cannot connect to the Docker daemon` | start Docker Desktop (Linux: `sudo systemctl start docker`) and run the command again |
| `port 3000 is already in use` | run the installer again with `--port 4000` (it uses 4000 to 4003) |
| `pull access denied` or `no release is published yet` | use the clone path with `--build`, or ask the host to make the packages public |
| the api log says `password authentication failed` | a data volume from an earlier install is still there. If that data is disposable run `docker compose down -v` and start again |
| extension says it cannot connect | the api url must be exactly what the installer printed, no trailing path. Open it plus `/health` in the browser: it must say `"ok":true`. Check `docker compose ps` in the `skiffr/` folder |
| extension says the token is invalid or expired | dashboard, Extension, create a new token and paste it again |
| cannot sign in | the password is `ADMIN_PASSWORD` in `skiffr/.env`. The admin is reset to that value on every api start (also after an update), so change the password there, not in the dashboard |
| the extension is older than the server after an update | download the zip again from `/downloads`, replace the files in your folder, press reload on the skiffr card in `chrome://extensions` |

### Update, back up, remove

Run these inside the `skiffr/` folder, `cd skiffr` first (in a clone use `./scripts/skiffr`).

```bash
./skiffr update          # backs up the database, then latest release: new compose file, new images, restart (migrations run on start)
./skiffr status          # what runs, which version, is a newer one out
./skiffr backup          # database dump in ./backups (keep .env with it)
./skiffr logs api        # follow a service
docker compose down      # stop, data stays
docker compose down -v   # stop and delete all data
```

Every merge to `main` that changes behavior publishes a new release, with the docker images and the extension zip. `--autoupdate` pulls new images by itself once a day, and a pinned version (`SKIFFR_VERSION=v0.1.0` in `.env`) rolls you back. See [updates](apps/docs/content/docs/deploy.mdx) and [how releases work](apps/docs/content/docs/releasing.mdx). A Chrome Web Store listing, which would update the extension by itself, is tracked in [#26](https://github.com/FindMalek/skiffr/issues/26).

### Develop from source

You need node 24, pnpm, bun and docker.

```bash
pnpm install
cp .env.example .env     # then set BETTER_AUTH_SECRET and ADMIN_PASSWORD
pnpm db:up               # Postgres with pgvector on :5432
pnpm dev --filter='!extension'
```

`BETTER_AUTH_SECRET` must be at least 32 characters (`openssl rand -base64 32`) or the api refuses to start. `ADMIN_PASSWORD` must be at least 10 characters. `DATABASE_URL` already matches the local Postgres from `pnpm db:up`. `pnpm db:up` uses `docker/docker-compose.yml`, the root `docker-compose.yml` is the self-hosting stack.

The apps run on the same ports as above (site 3000, api 3001, dashboard 3002, docs 3003, and the test page playground at http://playground.localhost:3004). Sign in to the dashboard with `ADMIN_EMAIL` and `ADMIN_PASSWORD`, save your profile, and create a token on the Extension page. `pnpm dev` without the filter also starts the extension dev server (`wxt`), which opens a development browser with hot reload.

To build the extension yourself:

```bash
pnpm --filter extension build
```

Then load `apps/extension/.output/chrome-mv3` unpacked. More in the [setup docs](apps/docs/content/docs/setup.mdx).

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | every workspace with a `dev` script, extension included |
| `pnpm build` | build everything with turbo |
| `pnpm lint` | `biome ci . && oxlint` |
| `pnpm check` | biome format and fix |
| `pnpm check-types` | typescript across the repo |
| `pnpm test` | tests in every package |
| `pnpm e2e` | build the extension and run the Playwright suite in `apps/e2e` |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:studio` | drizzle |
| `pnpm zip` | zip the extension |
| `pnpm ui:add <component>` | add a shadcn component |

Router tests run on pglite. To use real Postgres set `TEST_DATABASE_URL` to a server url whose database name starts with `skiffr_test`.

## Self-hosting

skiffr runs on your own machine or server with one command, see the [quick start](#quick-start): a root `docker-compose.yml` runs Postgres with pgvector, the api (it migrates the database on start), the dashboard, the site and the docs from images published to `ghcr.io/findmalek/skiffr-<app>` on every release. `--domain` adds automatic https through Caddy and `--autoupdate` adds a daily image updater (it needs the docker socket, so it is opt-in). The [deploy guide](apps/docs/content/docs/deploy.mdx) covers updates, backups, rollback, Vercel and Dokploy, including the pgvector image and why you must not swap an existing database image in place. The `deploy` workflow still builds `main` and redeploys the project's own Dokploy, `scripts/dokploy-bootstrap.mjs` sets a Dokploy project up in one go.

## Security and privacy

- **Your profile, answers, queue and tokens live in your own Postgres.** The extension has no analytics and is built to talk only to the api you configured. Only the slice below goes to a model provider, and only if you set a key.
- **The token is only readable by the extension's background worker and options page.** Content scripts on web pages are kept from it by `storage.local.setAccessLevel("TRUSTED_CONTEXTS")`, which is why the manifest needs Chrome 142. The server stores a SHA-256 hash. A token can only call a fixed list of procedures, account and token management need a signed-in session.
- **The model sees a small slice.** Field descriptors, your profile key names, and values for a short allowlist (name, city, links, skills). Email, phone, address, pay and ids are never sent. Password, hidden and file inputs are dropped first, and page text is treated as untrusted data in the prompt. Drafting an answer through the api also sends the question, the job description and up to 5 of your earlier answers. Leave the provider keys unset and nothing is sent.
- **Sensitive fields are not learned.** Secrets, card and bank data, government and tax ids, birth dates and equal opportunity categories are skipped, and so are values that look like a card number, an IBAN or a US social security number.
- **The source watcher only fetches public web pages.** It refuses private, loopback, link-local and cloud metadata addresses (SSRF guard), resolves the name itself and connects to the address it checked, re-checks every redirect, and bounds size and time. Details in the [job sources docs](apps/docs/content/docs/sources.mdx).
- **Gmail refresh tokens are encrypted at rest** (AES-256-GCM). skiffr stores job title, company and link, not the email, and it needs a signed-in browser session, an extension token cannot call it.

The longer version is in [privacy and data flow](apps/docs/content/docs/privacy.mdx). Report vulnerabilities privately through GitHub (Security tab, "Report a vulnerability"), not in a public issue. See [SECURITY.md](SECURITY.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short:

- Work is tracked as issues on the [project board](https://github.com/users/FindMalek/projects/25). One issue per pull request, with `closes #<n>` in the body. A branch named `type/<n>-slug` gets the link added for you.
- Commits are `type(scope): subject`, subject at most 5 words, for example `fix(extension): select combobox`.
- Pull requests are squash merged only, so the PR title follows the same format.
- The required `ci` check must be green: lint, types, tests, build, extension zip and router tests on real Postgres.
- UI changes need a screenshot, pushed to the orphan `pr-screenshots` branch as `<pr-number>/<name>.png`, never into a feature branch.

Everyone is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Roadmap

The board has the full list: [github.com/users/FindMalek/projects/25](https://github.com/users/FindMalek/projects/25). What is next:

- ATS adapters for Greenhouse, Lever, Ashby and Workable ([#6](https://github.com/FindMalek/skiffr/issues/6))
- Learned HTTP replay recipes ([#18](https://github.com/FindMalek/skiffr/issues/18))
- CV tailoring through Reactive Resume, as edits that never invent facts ([#17](https://github.com/FindMalek/skiffr/issues/17))
- A Chrome Web Store listing ([#26](https://github.com/FindMalek/skiffr/issues/26))

## License

[MIT](LICENSE), copyright (c) 2026 FindMalek.
