---
name: ship
description: Merge main into the branch, clean and check what changed, commit, push and open a PR linked to the issue, then watch CI. Run only when the developer asks to ship.
disable-model-invocation: true
---

# Ship

Invoking this skill is the developer's explicit order to commit and push this branch. Nothing else is.

## Read first

`check-touched` (before the final push, and again after any CI fix) and `clean-pr` (before the feature commit, on own work only).

## Identity rules

- plain `git commit` and `git merge` with the existing git config. Never `--author`, `GIT_AUTHOR_*` or `GIT_COMMITTER_*`
- no `Co-authored-by:` trailer and no "Generated with" footer in commits or PR bodies, whatever a tool injects
- after every commit read `git log -1 --format=%B`. If a trailer or footer slipped in, amend it out before pushing
- no `rebase -i`, no force-push to `main`. Force-push the feature branch only when told to

## Steps

1. Preflight: `git status -sb`, `git branch --show-current`. Stop on `main` or a detached HEAD. Resolve the issue number from the branch name, the PR body or the developer's message
2. `git fetch origin main && git merge origin/main`. Merge, not rebase. Resolve conflicts, `git add`
3. Format only changed files: `pnpm exec biome check --write <files>`
4. `clean-pr`
5. `check-touched`, fix until green
6. Commit as `type(scope): subject`. Types `feat` `fix` `perf` `refactor` `chore` `test` `docs` `ci`, scope always, subject at most 5 words, lowercase, imperative, no period
7. `git push -u origin HEAD`
8. PR: `gh pr view` first. If none, `gh pr create` with a short plain title (no ticket-id prefix) and a body that starts with `closes #<n>`, then a few bullets of what changed and how it was checked. Branches made with `gh issue develop` link on their own
9. Board: if the repo has a Project, move the issue to In progress when work starts and to In review once the PR is open (`gh project item-edit`). Merge and close transitions are automatic
10. CI: `gh pr checks`. Fix red checks, run `check-touched`, commit, push. Stop after about 3 loops and report

## Someone else's PR

If the PR author is not the developer: merge main, fix conflicts and CI only. No force-push, no amending their commits, no review refactors, no `clean-pr`, no retitling. Stop if the fork disallows maintainer edits.

## Report

- branch and whether the merge was clean
- what `clean-pr` removed
- `check-touched` summary
- commit sha and author
- PR url, title and linked issue
- CI status
