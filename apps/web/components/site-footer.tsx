import { StarIcon } from "lucide-react"
import { getRepo } from "@/lib/api"
import { repoUrl } from "@/lib/seo"
import { SITE } from "@/lib/site"
import { ThemeToggle } from "./theme-toggle"

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.2 11.39.6.11.8-.26.8-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.8 1.3 3.49 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.65 1.65.24 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.19.7.8.58A12 12 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  )
}

export async function SiteFooter() {
  const repo = await getRepo()
  return (
    <footer className="w-full border-t py-3.5">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 font-mono text-xs sm:flex-row sm:px-6">
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{SITE.name}</span> · {SITE.license}
        </span>
        <span className="flex items-center gap-3">
          <a
            href={repo?.url ?? repoUrl()}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 border bg-card px-2.5 py-1 outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GithubMark className="size-3.5" />
            <span className="hidden text-muted-foreground sm:inline">
              {repo?.name ?? new URL(repoUrl()).pathname.slice(1)}
            </span>
            {repo && (
              <span className="inline-flex items-center gap-0.5 text-primary">
                <StarIcon className="size-3" /> {repo.stars}
              </span>
            )}
          </a>
          <ThemeToggle />
        </span>
      </div>
    </footer>
  )
}
