// Fails a pull request that carries AI attribution, skips its issue link, or has commits off the house format.
// Env: BASE_SHA, HEAD_SHA, PR_TITLE, PR_BODY, PR_AUTHOR.
import { execFileSync } from "node:child_process"
import { AI_IDENTITY, AI_TEXT_PATTERNS, COMMIT_RE, ISSUE_LINK_RE, isBot, MAX_SUBJECT_WORDS } from "./policy.mjs"

const { BASE_SHA, HEAD_SHA, PR_TITLE = "", PR_BODY = "", PR_AUTHOR = "" } = process.env
const problems = []
const fail = (message) => problems.push(message)

function aiTextProblems(text) {
  return AI_TEXT_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name)
}

function subjectProblem(subject) {
  const match = COMMIT_RE.exec(subject)
  if (!match) return "expected `type(scope): subject`"
  const words = match[1].trim().split(/\s+/)
  if (words.length > MAX_SUBJECT_WORDS) return `subject has ${words.length} words, ${MAX_SUBJECT_WORDS} at most`
  if (/^[A-Z]/.test(match[1])) return "subject starts with a capital"
  if (/\.$/.test(match[1])) return "subject ends with a period"
  return null
}

function commits() {
  const out = execFileSync(
    "git",
    ["log", "--no-merges", "--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%B%x1e", `${BASE_SHA}..${HEAD_SHA}`],
    { encoding: "utf8" },
  )
  return out
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, author, committer, message] = record.split("\x1f")
      return { sha: sha.slice(0, 7), author, committer, message, subject: message.split("\n")[0] }
    })
}

function main() {
  const bot = isBot(PR_AUTHOR)

  for (const [label, text] of [
    ["PR title", PR_TITLE],
    ["PR body", PR_BODY],
  ]) {
    for (const name of aiTextProblems(text)) fail(`${label}: ${name}`)
  }

  if (!bot && !ISSUE_LINK_RE.test(`${PR_TITLE}\n${PR_BODY}`)) {
    fail("PR body needs an issue link like `closes #12`")
  }

  for (const commit of commits()) {
    for (const name of aiTextProblems(commit.message)) fail(`${commit.sha}: ${name}`)
    for (const who of [commit.author, commit.committer]) {
      if (AI_IDENTITY.test(who)) fail(`${commit.sha}: author or committer is an ai tool (${who})`)
    }
    if (isBot(commit.author)) continue
    const problem = subjectProblem(commit.subject)
    if (problem) fail(`${commit.sha}: "${commit.subject}" ${problem}`)
  }

  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`)
    process.exit(1)
  }
  console.info("pr hygiene ok")
}

if (import.meta.main) main()
