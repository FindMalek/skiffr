---
name: triage-reviews
description: As the PR author, verify every review comment against the code and draft paste-ready replies. Posts nothing.
disable-model-invocation: true
---

# Triage reviews

You are the author. Every comment is checked against the code before anything is conceded or fixed. Post nothing, resolve nothing, commit nothing.

## Gather

1. PR and issue: `gh pr view --json number,title,body,headRefName` and `gh issue view <n> --json title,body,comments`
2. every review comment, open and resolved: `gh api repos/{owner}/{repo}/pulls/<n>/comments --paginate`, `gh pr view <n> --json reviews`, and issue comments from bots
3. for each comment: open the file at the line, read the surrounding code, and decide with evidence

## Verdict per comment

- **valid**: real bug or practice miss. Say what to change
- **wrong**: the code already handles it, or the reviewer misread. Point at the line that proves it
- **unclear**: needs a question back
- **out of scope**: real but not this issue. Suggest a follow-up issue
- **already fixed**: name the commit

Bot findings get the same check. A bot is not right by default.

## Output

```markdown
# #123 review triage

## Verdict
n valid, n wrong, n unclear

## Findings
### 1. `path/file.ts` L42 (reviewer)
verdict: valid
why: <evidence>
reply: <paste-ready>
```

Then the next steps: valid findings feed `plan-ticket` as the spec.

## Reply voice

Typed fast to a teammate: lowercase start, plain words, one idea, no intro or sign-off, no em dashes, paths and symbols in backticks, never opening with "This", "We", "Consider" or "I think", no "great catch".

- valid: `fixed in <sha>` once it is fixed, or what will change
- wrong: the fact that settles it, with the path
- unclear: one direct question
- out of scope: `real but separate, opened #<n>`

## Anti-patterns

- agreeing without reading the code
- replying to a thread before the fix is committed
- bundling unrelated refactors into review fixes
