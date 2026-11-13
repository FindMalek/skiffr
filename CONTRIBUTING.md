# Contributing

Thanks for looking. Small, focused pull requests are easiest to review.

## Setup

You need node 24, pnpm, bun and docker.

```bash
pnpm install
cp .env.example .env   # then set BETTER_AUTH_SECRET (32+ characters) and ADMIN_PASSWORD (10+)
pnpm db:up
pnpm dev --filter='!extension'
```

`pnpm dev` also starts the extension's `wxt` dev server, which opens a development browser. Leave it out with `--filter='!extension'`, or run it alone with `pnpm --filter extension dev`.

The full walkthrough, ports and extension loading are in the [README](README.md#quick-start). To run the released stack instead of developing, that page starts with one command.

## Branches, commits, pull requests

- Open or pick an issue first. One pull request closes one issue: put `closes #<number>` in the body.
- Commit messages are `type(scope): subject`, for example `fix(extension): select combobox`. Scope is always there, the subject is at most 5 words, lowercase, imperative, no period. Types: `feat` `fix` `perf` `refactor` `chore` `test` `docs` `ci`.
- Pull requests are squash merged, so the PR title follows the same format.
- Do not name an AI tool as author or co-author in commits, titles or bodies. The `pr hygiene` check rejects it.
- The `ci` check must be green to merge. It aggregates every job below.
- UI changes need a screenshot. Never commit screenshots to a feature branch: push them to the orphan `pr-screenshots` branch as `<pr-number>/<name>.png` and link `https://raw.githubusercontent.com/FindMalek/skiffr/pr-screenshots/<pr-number>/<name>.png` in the PR body.

## Checks

Run what you touched before pushing:

```bash
pnpm lint          # biome and oxlint
pnpm check-types
pnpm test
pnpm build
```

`pnpm check` formats and fixes with biome. Migrations are generated, never written by hand: change the schema in `packages/db/src/schema`, then run `pnpm db:generate`.

## Tests

One focused test per behavior or bug, one that fails before the fix. Test through the public function or endpoint and mock only external boundaries (network, time, model providers).

- Router tests run on pglite by default. Set `TEST_DATABASE_URL` to a server url whose database name starts with `skiffr_test` to run them on real Postgres. Each run creates and drops its own database.
- The fill engine has unit tests in `apps/extension/lib/fill` and a browser check against fixture pages: `pnpm --filter extension test:browser`.

## How CI works

`.github/workflows/ci.yml` runs on every pull request and on `main`:

| Job | What it does |
| --- | --- |
| `lint` | `biome ci . && oxlint` over the whole repo, always |
| `check-types`, `test`, `build` | the root scripts. On pull requests turbo runs only affected packages, on `main` everything |
| `extension` | builds and zips the Chrome extension and uploads it as the artifact `extension-chrome-pr-<n>` (`extension-chrome-latest` on `main`) |
| `db-postgres` | runs the router tests on real Postgres with pgvector (`pgvector/pgvector:pg17`) and checks that no test database is left behind |
| `aggregator-test` | tests the script that decides the final result |
| `ci` | the one required check, it passes only when all of the above did |

`pr hygiene` checks the commit format, the issue link and attribution separately.

## Releases

Releases are cut by `.github/workflows/release.yml` after a green push to `main`, nobody tags by hand. The next version comes from the squash titles: `feat` is a minor, `fix`, `perf`, `refactor` and `deps` changes are patches, `!` or a `BREAKING CHANGE:` line is a minor while the version is `0.x`, and docs, ci, test and chore alone release nothing. So the PR title decides what users see in the release notes: write it for them. How to rehearse, force or roll back a release is in the [releasing docs](apps/docs/content/docs/releasing.mdx). The release scripts have tests: `pnpm test:release`.

## Areas that get extra review

Changes here can leak personal data or act on a page without the user asking, so keep them small and say in the PR how you checked them:

- the fill engine (`apps/extension/lib/fill`): it must never submit a form, click submit, next or apply buttons, or touch password or hidden inputs. It may set a file only on a resume or CV slot when the caller hands it one, and may click only the controls it fills (checkboxes, radios, custom dropdowns and their own options)
- token auth and the extension boundary: `apps/api/src/cors.ts`, `packages/orpc/src/lib/tokens.ts`, the `TOKEN_PROCEDURES` list in `packages/orpc/src/procedures.ts`, and the extension background worker. The token must never be readable from a content script
- what goes to a model: `packages/ai`, especially `src/shared-keys.ts`, the allowlist of profile keys whose values may be sent
- the learning and privacy lists, meaning which labels are never learned or filled: anything that widens what gets stored or sent

## Security

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
