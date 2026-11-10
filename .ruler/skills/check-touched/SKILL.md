---
name: check-touched
description: Run lint, type-check and unit tests only for the workspaces touched on this branch, never the whole repo. Used by ship and review-ticket.
disable-model-invocation: true
---

# Check touched

Prove only what this branch changed.

## Steps

1. Map the diff: `bash .ruler/skills/check-touched/scripts/list-touched.sh`. It prints `BASE`, `PACKAGES`, `FILTER` (`--filter=<name>` flags), `FLAGS` and `NO_CHANGES`. Nothing changed: say so and stop.
2. Format what you touched: `pnpm exec biome check --write <changed files>`.
3. Run each check scoped with `$FILTER`, skipping it when no touched workspace defines the script:
   - `pnpm turbo run check-types $FILTER --output-logs=errors-only`
   - `pnpm turbo run test $FILTER --output-logs=errors-only`
   - `pnpm turbo run build $FILTER --output-logs=errors-only`, only when an app (`apps/*`) was touched
4. `pnpm exec oxlint <touched dirs>` for lint beyond biome.
5. If `FLAGS` has `schema=1` (drizzle schema touched): run `pnpm db:generate` and make sure the generated migration is part of the diff.

## Rules

- no root `pnpm build`, `pnpm check-types` or `pnpm test` across the repo, and no dependents unless asked
- fix a failure, then re-run only the failed check
- skip e2e and anything the touched workspace does not script
- if `FLAGS` has `lockfile=1`, `github=1` or `root=1`, say scoped checks miss that fallout

## Report

```
Touched: pkg-a, pkg-b
Skipped: whole-repo checks, dependents
format / lint / check-types / test / build: ok or the failure and the fix
```
