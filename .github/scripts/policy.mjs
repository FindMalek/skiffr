// Single home for the rules the pr-hygiene workflow enforces.

const AI_TOOLS = [
  "claude",
  "anthropic",
  "copilot",
  "cursor",
  "chatgpt",
  "openai",
  "codex",
  "gemini",
  "devin",
  "aider",
  "opencode",
  "windsurf",
  "cody",
  "tabnine",
]
const TOOL = `(?:${AI_TOOLS.join("|")})`

/** Text that says or implies an AI made the change. Checked on commit messages, PR titles and PR bodies. */
export const AI_TEXT_PATTERNS = [
  { name: "co-author trailer for an ai tool", re: new RegExp(`^\\s*co-authored-by:.*${TOOL}`, "im") },
  { name: "co-author trailer for a bot", re: /^\s*co-authored-by:.*(?:\[bot\]|noreply@anthropic\.com)/im },
  { name: "generated-with footer", re: /^[\s\p{P}\p{S}]*generated (?:with|by|using)\b/imu },
  { name: "robot emoji footer", re: /\u{1F916}/u },
  { name: "tool link footer", re: /\b(?:claude\.(?:ai|com)\/code|cursor\.com|copilot\.github\.com)\b/i },
]

/** Author and committer names or emails that belong to an AI tool (no first names like devin or cody here). */
export const AI_IDENTITY = /\b(?:claude|anthropic|copilot|cursor|chatgpt|openai|codex|opencode|windsurf)\b/i

const COMMIT_TYPES = ["feat", "fix", "perf", "refactor", "chore", "test", "docs", "ci", "style", "build", "revert"]
export const COMMIT_RE = new RegExp(`^(?:${COMMIT_TYPES.join("|")})\\([\\w./@-]+\\)!?: (.+)$`)
export const MAX_SUBJECT_WORDS = 5

/** `closes #12`, `fixes owner/repo#12` or a full issue url. */
const CLOSING = "(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)"
const ISSUE_REF = "(?:[\\w.-]+/[\\w.-]+)?#\\d+|https://github\\.com/[\\w.-]+/[\\w.-]+/issues/\\d+"
export const ISSUE_LINK_RE = new RegExp(`\\b${CLOSING}\\s*:?\\s+(?:${ISSUE_REF})`, "i")

/** Bot accounts (dependabot, renovate) write their own commit messages and PR bodies. */
export const isBot = (login) => /\[bot\]$/i.test(login ?? "")
