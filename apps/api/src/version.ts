import pkg from "../package.json"

/** The release version: `scripts/release/set-version.mjs` writes the tag into package.json before the images and the extension are built. */
export const VERSION: string = pkg.version

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)/

/** True when `latest` is a higher release than `current`. Anything that is not x.y.z compares as not newer. */
export function isNewer(latest: string, current: string): boolean {
  const a = SEMVER.exec(latest)
  const b = SEMVER.exec(current)
  if (!a || !b) return false
  for (let i = 1; i <= 3; i++) {
    const diff = Number(a[i]) - Number(b[i])
    if (diff !== 0) return diff > 0
  }
  return false
}

const OK_TTL_MS = 6 * 60 * 60_000
const FAIL_TTL_MS = 60 * 60_000

export type UpdateInfo = { latest: string | null; updateAvailable: boolean }

/**
 * Looks up the latest GitHub release at most every few hours. It is a plain GET of a public url: no cookie, no id, nothing
 * about this server is sent. A failure answers "unknown" and is retried later, it never breaks `/version`.
 */
export function createUpdateCheck(opts: {
  repo: string
  fetch?: typeof fetch
  now?: () => number
}): (current: string) => Promise<UpdateInfo> {
  const get = opts.fetch ?? fetch
  const now = opts.now ?? Date.now
  let cached: { latest: string | null; until: number } | null = null

  return async (current) => {
    if (!cached || cached.until <= now()) {
      const latest = await get(`https://api.github.com/repos/${opts.repo}/releases/latest`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "skiffr-update-check" },
        signal: AbortSignal.timeout(5000),
      })
        .then(async (res) => (res.ok ? ((await res.json()) as { tag_name?: unknown }).tag_name : null))
        .then((tag) => (typeof tag === "string" ? tag : null))
        .catch(() => null)
      cached = { latest, until: now() + (latest ? OK_TTL_MS : FAIL_TTL_MS) }
    }
    return { latest: cached.latest, updateAvailable: cached.latest !== null && isNewer(cached.latest, current) }
  }
}
