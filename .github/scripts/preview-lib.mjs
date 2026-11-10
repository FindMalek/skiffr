export const MARKER = "findplate-preview"

export const STATUS = {
  building: "Building",
  ready: "Ready",
  failed: "Failed",
  removed: "Removed",
}

const ICON = { building: "🟡", ready: "✅", failed: "❌", removed: "⚪" }

export function prAppName(pr, app) {
  return `pr-${pr}-${app}`
}

export function previewHost(pr, app, domain) {
  return `${prAppName(pr, app)}.${String(domain).replace(/^\.+|\.+$/g, "")}`
}

export function tail(text, lines = 25, maxChars = 1800) {
  const out = String(text ?? "")
    .trimEnd()
    .split("\n")
    .slice(-lines)
    .join("\n")
  return out.length > maxChars ? `...${out.slice(-maxChars)}` : out
}

export function parseStatePayload(body) {
  const m = new RegExp(`<!-- ${MARKER} (\\{.*?\\}) -->`, "s").exec(body ?? "")
  if (!m) return null
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

export function utc(date) {
  return `${new Date(date).toISOString().slice(0, 16).replace("T", " ")} UTC`
}

// rows: [{ app, status, url, inspectUrl, updatedAt, error }], state: { app: applicationId }
export function renderComment({ pr, sha, rows, state = {} }) {
  const lines = [
    `<!-- ${MARKER} ${JSON.stringify(state)} -->`,
    `### Preview deployments for #${pr}`,
    "",
    "| App | Status | Preview | Inspect | Updated |",
    "| --- | --- | --- | --- | --- |",
  ]
  for (const r of rows) {
    const preview = r.url && r.status !== "removed" ? `[Visit preview](${r.url})` : "-"
    const inspect = r.inspectUrl ? `[Inspect](${r.inspectUrl})` : "-"
    lines.push(
      `| **${r.app}** | ${ICON[r.status]} ${STATUS[r.status]} | ${preview} | ${inspect} | ${utc(r.updatedAt)} |`,
    )
  }
  for (const r of rows.filter((x) => x.status === "failed" && x.error)) {
    lines.push(
      "",
      `<details><summary>${r.app} build failed</summary>`,
      "",
      "```",
      tail(r.error),
      "```",
      "",
      "</details>",
    )
  }
  lines.push("", `Latest commit: \`${String(sha).slice(0, 7)}\``)
  return lines.join("\n")
}

export function dockerPort(dockerfile, fallback = 3000) {
  const m = /\bPORT=(\d+)/.exec(dockerfile ?? "")
  return m ? Number(m[1]) : fallback
}

export function pickLatest(deployments) {
  return [...(deployments ?? [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] ?? null
}

// dokploy deployment status: running | done | error | cancelled
export function toStatus(deployment) {
  if (!deployment) return "building"
  if (deployment.status === "done") return "ready"
  if (deployment.status === "error" || deployment.status === "cancelled") return "failed"
  return "building"
}
