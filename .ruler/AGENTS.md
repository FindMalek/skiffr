# Skiffr agent rules

Single source for every coding agent. Edit this file, then run `pnpm agents` to regenerate `CLAUDE.md`, `AGENTS.md`, `.cursor/`, `opencode.json`, `.zed/` and the other agent files. Never edit the generated files by hand.

## Stack

- pnpm workspace + turborepo, TypeScript everywhere, biome (format and lint) plus oxlint
- Next.js app router: `apps/web` (landing) and `apps/dashboard` (better-auth login and app shell)
- `apps/api`: oRPC on bun, the only app that touches the database, auth, storage and providers
- `packages/orpc` contracts and clients, `packages/db` drizzle schema and migrations, `packages/auth` better-auth, `packages/env` zod-validated env, `packages/ui` shadcn components and theme
- The frontends only call the api. Never import `@skiffr/db` from `web` or `dashboard`.

## Commands

- `pnpm dev`, `pnpm build`
- `pnpm check` formats and fixes, `pnpm lint` is the CI check, `pnpm check-types`, `pnpm test`
- `pnpm db:generate` / `db:migrate` / `db:seed` for drizzle, `pnpm ui:add <component>` for shadcn
- Run only what you touched while iterating, the whole suite before handing off

## Structure and naming

- Files are kebab-case (`orders-list.tsx`, `use-orders.ts`)
- React components: kebab-case file, PascalCase export
- Functions, hooks, variables: camelCase. Module-level constants: UPPER_SNAKE_CASE
- Inside an app use the `@/*` alias, across packages use the workspace name (`@skiffr/ui`)
- Server components by default, add `"use client"` only for hooks, handlers or browser APIs
- Read the app's own `AGENTS.md` before changing Next code: the bundled docs match the installed version

## Conventions

- oRPC: procedures live in `packages/orpc/src/routers`, built from `publicProcedure` or `protectedProcedure`. Validate input and output with zod. Throw `ORPCError`, never raw errors
- drizzle: schema in `packages/db/src/schema`. Change the schema, then run `pnpm db:generate`. Never hand-write a migration folder or a timestamp
- better-auth: configured once in `packages/auth`. Sessions are cookies, signed-in calls send `x-csrf-token: orpc`
- env: every variable goes through `packages/env` and `.env.example`. App code reads env through `packages/env`, not `process.env`. No secrets in diffs
- UI: reuse shadcn components from `@skiffr/ui` and theme tokens. No hard-coded colors

## Code

- Explicit types, no `any`, short functions
- No duplicate types or helpers: look in the shared package before writing a new one
- No comments that restate the code. Keep only non-obvious constraints, footguns and product decisions
- Smallest diff that does the job. No drive-by refactors, no speculative abstractions

## Tests

- One focused test per behavior or bug: it fails before the fix and passes after
- No happy-path padding, snapshot dumps, or tests of types, getters or the framework
- Smallest inline fixture, reuse existing helpers. Test through the public function or endpoint
- Mock only external boundaries (network, time, third-party APIs), never your own modules

<!-- @findplate:docs -->
## LLM entry points

The docs site serves itself to agents: `/llms.txt` (index, start here), `/llms-full.txt` (every page) and `<page-url>.md` (one page as markdown, or send `Accept: text/markdown`). Read those instead of scraping html.

<!-- @end -->
## Git and GitHub

- Work is tracked as GitHub issues, usually on a GitHub Project board
- Branch with `gh issue develop <issue-number> --checkout` so the branch and the PR link to the issue
- Commits are `type(scope): subject`: types `feat` `fix` `perf` `refactor` `chore` `test` `docs` `ci`, scope always, subject at most 5 words, lowercase, imperative, no period (`fix(auth): expired token`)
- PR title is a short plain description. The PR body starts with `closes #<issue-number>`
- Commit and push with the developer's own git identity, never an agent identity
- Do not commit, push, or reply to PR reviews unless the developer asks in their own message

## No AI attribution

Nothing that ships may say or imply an AI made it:

- no `Co-authored-by:` or other trailer for an AI tool in commits
- no "Generated with" footers or tool names in PR titles, PR bodies, issues, review replies, code comments, docs or changelogs
- before any push, read `git log -1 --format=%B` and strip anything AI-attributed

## Posted comments

PR, issue and review comments read like a developer typed them fast to a teammate: one idea, plain words, no intro or sign-off, file names and symbols in backticks.
