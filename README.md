<!-- replace your-org with your github owner in the ci and license links below -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/grid.svg?title={{title_url}}&subtitle={{pitch_url}}&align=left&mode=dark" />
    <img alt="Skiffr" src="https://shieldcn.dev/header/grid.svg?title={{title_url}}&subtitle={{pitch_url}}&align=left&mode=light" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/your-org/skiffr/actions/workflows/ci.yml"><img alt="build" src="https://shieldcn.dev/github/ci/your-org/skiffr.svg?variant=secondary" /></a>
  <a href="https://github.com/your-org/skiffr/blob/main/LICENSE"><img alt="license" src="https://shieldcn.dev/github/license/your-org/skiffr.svg?variant=secondary" /></a>
  <img alt="Next.js" src="https://shieldcn.dev/badge/Next.js-16-black.svg?logo=nextdotjs&variant=secondary" />
  <img alt="TypeScript" src="https://shieldcn.dev/badge/TypeScript-5-black.svg?logo=typescript&variant=secondary" />
  <img alt="Bun" src="https://shieldcn.dev/badge/Bun-api-black.svg?logo=bun&variant=secondary" />
  <img alt="Turborepo" src="https://shieldcn.dev/badge/Turborepo-monorepo-black.svg?logo=turborepo&variant=secondary" />
</p>

{{pitch}}

---

## Quickstart

You need node 24, pnpm, bun and docker. The project is already installed and has a `.env` with generated secrets.

```bash
{{run:db:up}}
{{run:dev}}
```

| App | Url | What it is |
| --- | --- | --- |
| `apps/web` | http://localhost:3000 | landing page |
| `apps/api` | http://localhost:3001 | orpc api on bun |
| `apps/dashboard` | http://localhost:3002 | login and app shell |
<!-- @findplate:docs -->
| `apps/docs` | http://localhost:3003 | docs site |
<!-- @end -->

Sign in to the dashboard with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`.

---

## Structure

```text
skiffr/
├─ apps/
│  ├─ web/        landing page
│  ├─ dashboard/  login and app shell
<!-- @findplate:docs -->
│  ├─ docs/       docs site
<!-- @end -->
│  └─ api/        orpc on bun
├─ packages/      ui, common, orpc, db, auth, env, config
├─ docker/        local postgres
└─ turbo.json
```

| Package | What it holds |
| --- | --- |
| `@skiffr/ui` | shadcn components and the theme tokens |
| `@skiffr/common` | zod schemas, constants and utils shared by api, web and dashboard |
| `@skiffr/orpc` | procedures and typed clients |
| `@skiffr/db` | drizzle schema, migrations, seed scenario |
| `@skiffr/auth` | better-auth setup |
| `@skiffr/env` | zod-validated env, one root `.env` |

`apps/api` is the only app that touches the database, auth and providers. `web` and `dashboard` call it through `@skiffr/orpc`.

---

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | run every app |
| `pnpm build` | build everything with turbo |
| `pnpm lint` | biome and oxlint |
| `pnpm check` | biome format and fix |
| `pnpm check-types` | typescript across the repo |
| `pnpm test` | tests in every package |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:studio` | drizzle |
| `pnpm ui:add <component>` | add a shadcn component |
| `pnpm bump-deps` | update every dependency, catalog included, to the latest version |

---

## Deploy

Every app has a `Dockerfile` in `apps/<app>/`, built from the repo root:

```bash
docker build -f apps/web/Dockerfile -t skiffr-web .
```

The Next apps also run on Vercel with the app folder as the root directory. Set the same env keys everywhere, see `.env.example`.

---

## Agents

The Next apps carry an `AGENTS.md` that points coding agents at the bundled Next docs. Keep shared types in `packages/common` and use the theme tokens instead of raw colors.
<!-- @findplate:docs -->

The docs site serves `/llms.txt`, `/llms-full.txt` and every page as markdown at `<page-url>.md`, so agents can read the docs without scraping html.
<!-- @end -->

---

<p align="center"><sub>The name, pitch and social card colors live in <code>apps/web/lib/site.ts</code></sub></p>
