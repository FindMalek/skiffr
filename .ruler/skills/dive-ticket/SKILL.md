---
name: dive-ticket
description: Deep-research a GitHub issue from a number, link or branch name before any plan or code. Fetches the issue, comments, linked PRs and board status, then maps the repo. First step before plan-ticket.
disable-model-invocation: true
---

# Dive ticket

Research first. Do not plan. Do not code. Brief, then wait.

## Resolve the issue number

Accept a bare number, `#123`, an issue URL, or a branch name (`gh issue develop` branches embed the number, like `123-fix-login`). Look in this order:

1. what the developer typed after the command
2. the current branch: `git branch --show-current`
3. the open PR: `gh pr view --json title,body,headRefName`

If nothing resolves, ask for the issue number and stop.

## Fetch everything

In parallel:

1. `gh issue view <n> --json number,title,body,state,labels,assignees,comments,milestone`
2. linked branches and PRs: `gh pr list --search "linked:<n>"`
3. board status, if the repo has a Project: `gh project item-list <project-number> --owner <owner>` and match on the issue number
4. every `#NNN` mentioned in the body: title, state and key comments only
5. an existing PR for the branch: description and review threads, for context only

## Brief

Lead with the answer, keep it short, use bullets.

```markdown
# #123 briefing: <short title>

## What is wanted
- Outcome / translation / constraints

## The issue
- Symptom, root cause (proven vs hypothesized), who feels it

## What to do
- The behavior change, not the patch

## Repo map
- Involved: `path` `Symbol`, why
- Not involved: `path`, why it only looks related
- Pattern to copy: `path`

## Pinpoints
- Files, schema, procedures, env, unknowns

## Risks and questions
```

Read the repo's rules (`AGENTS.md`, `.ruler/AGENTS.md`) for naming and package boundaries. Name real files and symbols, mark unknowns as unknown.

End with "is everything clear?" and stop. No plan, no code, no offer to start coding until the developer says so.

## Anti-patterns

- coding in the same turn as the first issue paste
- a plan disguised as research
- briefing from the title without reading comments and linked PRs
- listing half the repo as involved
