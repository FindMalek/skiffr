// Pure release logic: conventional commit titles in, next version and release notes out. No git, no network.

/** Types that change what a user runs. Everything else (docs, ci, test, chore, build, style) is maintenance. */
const BUMPS = { feat: "minor", fix: "patch", perf: "patch", refactor: "patch", revert: "patch" }
const SECTIONS = [
  ["breaking", "Breaking changes"],
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactors"],
  ["deps", "Dependencies"],
  ["other", "Other changes"],
  ["maintenance", "Maintenance"],
]
const ORDER = { none: 0, patch: 1, minor: 2, major: 3 }
const TITLE = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+?)(?:\s+\(#(\d+)\))?$/
export const FIRST_VERSION = "0.1.0"
export const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/

/** `{ sha, subject, body }` to a commit with `type` (null when the title does not follow the format), scope, breaking flag and PR number. */
export function parseCommit({ sha, subject, body = "" }) {
  const match = TITLE.exec(subject.trim())
  const breaking = /^BREAKING[ -]CHANGE:/m.test(body) || Boolean(match?.[3])
  if (!match) {
    const pr = /\(#(\d+)\)\s*$/.exec(subject)?.[1]
    return {
      sha,
      type: null,
      scope: null,
      breaking,
      description: subject.replace(/\s+\(#\d+\)\s*$/, "").trim(),
      pr: pr ? Number(pr) : null,
    }
  }
  const [, type, scope, , description, pr] = match
  return {
    sha,
    type: type.toLowerCase(),
    scope: scope || null,
    breaking,
    description,
    pr: pr ? Number(pr) : null,
  }
}

/** The bump one commit asks for while the major version is 0: a breaking change or a feature is a minor, a fix is a patch. */
export function bumpOf(commit, major = 0) {
  if (commit.breaking) return major === 0 ? "minor" : "major"
  if (commit.type === null) return "patch"
  if (commit.type in BUMPS) return BUMPS[commit.type]
  // dependency bumps change the shipped images
  if (commit.scope === "deps") return "patch"
  return "none"
}

export function highestBump(commits, major = 0) {
  return commits.map((commit) => bumpOf(commit, major)).reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), "none")
}

export function parseTag(tag) {
  const match = STABLE_TAG.exec(tag)
  return match ? match.slice(1).map(Number) : null
}

/** Highest stable `vX.Y.Z` of a list, or null. Pre-release tags and anything else are ignored. */
export function latestTag(tags) {
  const stable = tags.filter((tag) => parseTag(tag))
  if (stable.length === 0) return null
  return stable.reduce((a, b) => {
    const [x, y] = [parseTag(a), parseTag(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b
    return a
  })
}

export function applyBump(version, bump) {
  const [major, minor, patch] = version
  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

/**
 * Decides the release. `forced` is "auto" or a bump level, used when only maintenance commits landed (it never releases
 * without commits). Returns `{ release: false, reason }` or `{ release: true, version, bump, previous }`.
 */
export function plan({ lastTag, commits, forced = "auto" }) {
  if (commits.length === 0) return { release: false, reason: "no commits since the last release" }
  const previous = lastTag ? parseTag(lastTag) : null
  const computed = highestBump(commits, previous?.[0] ?? 0)
  let bump = forced === "auto" ? computed : forced
  if (bump === "none") {
    return { release: false, reason: "only docs, ci, test or chore commits since the last release" }
  }
  if (previous && previous[0] === 0 && bump === "major") bump = "minor"
  const version = previous ? applyBump(previous, bump) : FIRST_VERSION
  return { release: true, version, bump, previous: lastTag }
}

function group(commit) {
  if (commit.breaking) return "breaking"
  if (commit.type === null) return "other"
  if (commit.type in BUMPS && commit.type !== "revert") return commit.type
  if (commit.type === "revert") return "other"
  return commit.scope === "deps" ? "deps" : "maintenance"
}

const line = (commit, repo) => {
  const scope = commit.scope ? `**${commit.scope}:** ` : ""
  const ref = commit.pr
    ? `[#${commit.pr}](https://github.com/${repo}/pull/${commit.pr})`
    : `[${commit.sha.slice(0, 7)}](https://github.com/${repo}/commit/${commit.sha})`
  return `- ${scope}${commit.description} (${ref})`
}

/** Markdown notes: commits grouped by type, each with its PR link, then how to upgrade. */
export function renderNotes({ version, previous, commits, repo }) {
  const groups = new Map(SECTIONS.map(([key]) => [key, []]))
  for (const commit of commits) groups.get(group(commit)).push(commit)
  const out = []
  for (const [key, title] of SECTIONS) {
    const items = groups.get(key)
    if (items.length === 0) continue
    out.push(`## ${title}`, "", ...items.map((commit) => line(commit, repo)), "")
  }
  if (previous) out.push(`**Full changelog**: https://github.com/${repo}/compare/${previous}...v${version}`, "")
  out.push(
    "## Upgrade",
    "",
    "- Self hosted with Docker: `./skiffr update`, or let the `autoupdate` profile do it. Roll back with `SKIFFR_VERSION=v" +
      `${version}` +
      "` in `.env`.",
    `- Extension: download it from your own server at \`/downloads\`, or take \`skiffr-extension-v${version}.zip\` below, unzip, and reload it in \`chrome://extensions\`.`,
    "",
  )
  return out.join("\n")
}

/** Replaces the top level `"version"` of a package.json text and leaves the rest of the text untouched. */
export function setPackageVersion(text, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`not a version: ${version}`)
  const next = text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`)
  if (next === text && !text.includes(`"version": "${version}"`)) throw new Error("package.json has no version field")
  return next
}

/** `git log --format=%H%x1f%s%x1f%b%x1e` output to commits, newest first. */
export function parseLog(raw) {
  return raw
    .split("\x1e")
    .map((entry) => entry.replace(/^\n+/, ""))
    .filter((entry) => entry.trim() !== "")
    .map((entry) => {
      const [sha, subject, body] = entry.split("\x1f")
      return parseCommit({ sha, subject, body })
    })
}
