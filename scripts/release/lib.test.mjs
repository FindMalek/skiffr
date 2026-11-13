import assert from "node:assert/strict"
import { test } from "node:test"
import { latestTag, parseCommit, parseLog, plan, renderNotes, setPackageVersion } from "./lib.mjs"

const c = (subject, body = "") => parseCommit({ sha: "a".repeat(40), subject, body })

test("squash titles are parsed with scope, breaking flag and PR number", () => {
  assert.deepEqual(
    { ...c("feat(api)!: drop v0 (#12)"), sha: undefined },
    { sha: undefined, type: "feat", scope: "api", breaking: true, description: "drop v0", pr: 12 },
  )
  assert.equal(c("fix(auth): x", "BREAKING CHANGE: sessions reset").breaking, true)
})

test("a title that does not follow the format is kept and counts as a patch", () => {
  const commit = c("Update readme (#7)")
  assert.equal(commit.type, null)
  assert.equal(commit.pr, 7)
  assert.equal(plan({ lastTag: "v0.2.0", commits: [commit] }).version, "0.2.1")
})

test("before 1.0 a feature and a breaking change are minors, a fix is a patch", () => {
  assert.equal(plan({ lastTag: "v0.2.3", commits: [c("fix(a): b"), c("feat(a): c")] }).version, "0.3.0")
  assert.equal(plan({ lastTag: "v0.2.3", commits: [c("fix(a)!: b")] }).version, "0.3.0")
  assert.equal(plan({ lastTag: "v0.2.3", commits: [c("perf(a): b"), c("refactor(a): c")] }).version, "0.2.4")
})

test("from 1.0 a breaking change is a major", () => {
  assert.equal(plan({ lastTag: "v1.4.2", commits: [c("feat(a)!: b")] }).version, "2.0.0")
  assert.equal(plan({ lastTag: "v1.4.2", commits: [c("feat(a): b")] }).version, "1.5.0")
})

test("docs, ci and chore alone do not release, unless forced, but dependency bumps do", () => {
  const quiet = [c("docs(repo): x"), c("ci(repo): y"), c("chore(repo): z"), c("test(api): t")]
  assert.equal(plan({ lastTag: "v0.2.0", commits: quiet }).release, false)
  assert.equal(plan({ lastTag: "v0.2.0", commits: quiet, forced: "patch" }).version, "0.2.1")
  assert.equal(plan({ lastTag: "v0.2.0", commits: [c("chore(deps): bump next")] }).version, "0.2.1")
  assert.equal(plan({ lastTag: "v0.2.0", commits: [], forced: "patch" }).release, false)
})

test("the first release is 0.1.0 and a forced major stays a minor while 0.x", () => {
  assert.equal(plan({ lastTag: null, commits: [c("fix(a): b")] }).version, "0.1.0")
  assert.equal(plan({ lastTag: "v0.4.0", commits: [c("fix(a): b")], forced: "major" }).version, "0.5.0")
})

test("the latest tag is the highest stable one, not the newest string", () => {
  assert.equal(latestTag(["v0.9.0", "v0.10.0", "v0.10.0-rc.1", "nightly", "v0.2.11"]), "v0.10.0")
  assert.equal(latestTag(["v1.0.0-rc.1"]), null)
})

test("notes group by type with PR links and say how to upgrade", () => {
  const commits = [
    c("feat(dashboard): export answers (#20)"),
    c("fix(api): token expiry (#21)"),
    c("Fix typo"),
    c("docs(repo): readme (#22)"),
  ]
  const notes = renderNotes({ version: "0.3.0", previous: "v0.2.0", commits, repo: "FindMalek/skiffr" })
  assert.match(
    notes,
    /## Features\n\n- \*\*dashboard:\*\* export answers \(\[#20\]\(https:\/\/github.com\/FindMalek\/skiffr\/pull\/20\)\)/,
  )
  assert.match(notes, /## Fixes\n\n- \*\*api:\*\* token expiry/)
  assert.match(notes, /## Other changes\n\n- Fix typo \(\[aaaaaaa\]/)
  assert.match(notes, /## Maintenance\n\n- \*\*repo:\*\* readme/)
  assert.match(notes, /compare\/v0\.2\.0\.\.\.v0\.3\.0/)
  assert.match(notes, /SKIFFR_VERSION=v0\.3\.0/)
})

test("git log output is split into commits", () => {
  const raw = "abc\x1ffeat(a): one (#1)\x1fbody\x1e\ndef\x1ffix(b): two\x1f\x1e\n"
  assert.deepEqual(
    parseLog(raw).map((commit) => [commit.sha, commit.type, commit.pr]),
    [
      ["abc", "feat", 1],
      ["def", "fix", null],
    ],
  )
})

test("setPackageVersion changes only the version line and rejects junk", () => {
  const text = '{\n  "name": "api",\n  "version": "0.0.1",\n  "scripts": {}\n}\n'
  assert.equal(setPackageVersion(text, "1.2.3"), text.replace("0.0.1", "1.2.3"))
  assert.throws(() => setPackageVersion(text, "1.2"))
  assert.throws(() => setPackageVersion('{"name":"x"}', "1.2.3"))
})
