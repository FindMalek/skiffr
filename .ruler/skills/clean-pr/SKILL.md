---
name: clean-pr
description: Strip AI-like restating comments and comment slop from this branch or PR diff only. Used standalone and by ship before the commit.
disable-model-invocation: true
---

# Clean PR

Removes restating comments from touched code. Changes no logic. Does not commit.

## Scope

Only the branch diff plus new untracked files:

```bash
git diff origin/main...HEAD
git diff
git diff --cached
```

Never sweep the whole repo.

## Delete comments and JSDoc that

- restate the function or the next statement
- open with filler (`Note:`, `Important:`, `This function`, `Helper to`)
- repeat the identifier in prose
- are essays about obvious control flow

## Keep

- non-obvious constraints, footguns, product decisions, race and lock warnings
- lint or type suppressions with a real reason
- public API docs when the signature alone is not enough

When unsure, delete.

## How

1. list files whose `+` lines gained `//` or `/**`
2. remove the slop only
3. format those files: `pnpm exec biome check --write <files>`
4. report each removal as path plus one line

Do not rewrite logic on the way, and do not touch files outside the diff.
