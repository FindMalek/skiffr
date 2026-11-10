const TTL = 10 * 60_000
let cache: { at: number; repo: string; value: { stars: number; url: string } | null } | null = null

/** Repo stars for the landing page footer, cached so GitHub's rate limit never matters. */
export async function repoInfo(repo: string | undefined, token?: string) {
  if (!repo) return null
  if (cache && cache.repo === repo && Date.now() - cache.at < TTL) return cache.value
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }).catch(() => null)
  const body = res?.ok ? ((await res.json()) as { stargazers_count: number; html_url: string }) : null
  const value = body ? { stars: body.stargazers_count, url: body.html_url } : null
  cache = { at: Date.now(), repo, value }
  return value
}
