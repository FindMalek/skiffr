---
name: plan-ticket
description: After dive-ticket (or after a review), either write a blocker comment for the issue when something material is open, or a detailed implementation plan. Does not implement until told to.
disable-model-invocation: true
---

# Plan ticket

Runs after dive and discussion, or after a review pass. Writes no product code. Lead replies with the issue number.

## Read first

`.ruler/AGENTS.md` for the project's real structure. A plan must not propose duplicate helpers or types, restating comments, speculative abstractions, hand-written migrations (use `pnpm db:generate`), or anything that breaks the package boundaries.

## Gate: blockers or clear

List open questions, ambiguous product calls and missing access (env, data, designs).

If anything material is open, output only a paste-ready issue comment and stop:

- lowercase first letter, plain words, no filler
- one thought per line
- name the real blocker

The developer posts it with `gh issue comment <n> --body '...'`.

If clear, write the plan. It must have:

- goal and non-goals
- exact files and symbols
- ordered steps
- edge cases: null and empty, races, double submit, N+1
- the one test that proves the bug or behavior
- env, schema or rollout notes if any
- how it gets verified: `check-touched`, then `clean-pr`, then `ship`

No "option A or B" unless the developer has to decide, and that belongs in the blocker comment. End by waiting for "go".

## After a review or triage

The spec is the valid open review comments, bot findings and failed checks. Unclear comment: blocker path. Clear: small ordered fix plan, then wait for "go".

## Anti-patterns

- planning while dive questions are unanswered
- vague steps ("update the service")
- whole-repo scope creep
- implementing inside this skill
