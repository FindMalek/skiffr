---
name: review-ticket
description: Review a PR or branch line by line like a senior engineer and draft short GitHub review comments. Drafts only, never posts.
disable-model-invocation: true
---

# Review ticket

Review the work against its issue. Draft comments in chat. Never post, resolve or reply without being told.

## Resolve the target

Find the PR from what the developer typed, the current branch, or `gh pr view`. Find the issue from the branch name or the `closes #n` line in the body. Read the issue and its comments first: the diff is judged against intent, not against the title.

## Gather

In parallel:

- `gh pr view <n> --json title,body,author,headRefName,statusCheckRollup`
- `gh pr diff <n>`
- every existing review and thread: `gh api repos/{owner}/{repo}/pulls/<n>/comments` and `gh pr view <n> --json reviews`. Do not repeat what is already said
- `check-touched` on the branch

## What to flag, in priority

1. **must-fix**: wrong behavior, data loss, security (authz, csrf, secrets), broken migration
2. **should**: missed edge cases, missing test for the bug, duplicate helper or type, package boundary break (frontends touching the db), hand-written migration
3. **nit**: naming against `.ruler/AGENTS.md`, leftover restating comments, dead code

Walk the edges on purpose: null, undefined and empty at every boundary, create vs update vs bulk paths, double submit and idempotency, N+1 and extra round trips, tests that prove the bug and not just the happy path.

AI slop to flag: new file for one function, speculative abstraction, restating JSDoc, a second type next to an existing one.

## Comment voice

Written to be pasted under the developer's name:

- starts lowercase, plain words, one idea, no intro or sign-off
- no em dashes, minimal punctuation
- paths and symbols in backticks
- never opens with "This", "We", "Consider", "I think" or "Nit:"
- say what is wrong and what to do

## Output

```markdown
# #123 review: <PR title>

## Verdict
ship, fix first, or rethink, and why in one line

## Checked
- what you read, ran and walked

## Comments
### 1. `path/file.ts` L42
severity: must-fix
<paste-ready text>
```

Offer to stage them as a pending review with `gh api repos/{owner}/{repo}/pulls/<n>/reviews` only when the developer asks.
