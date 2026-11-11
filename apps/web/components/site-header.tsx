import { docsUrl } from "@/lib/seo"
import { SITE } from "@/lib/site"

const LINK = "outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"

export function SiteHeader() {
  return (
    <header className="w-full">
      <nav aria-label="Main" className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="/" className={`font-heading font-bold text-lg tracking-tight ${LINK}`}>
          {SITE.name}
        </a>
        <span className="flex items-center gap-5 text-muted-foreground text-sm">
          <a href={docsUrl()} className={LINK}>
            Docs
          </a>
          <a href={SITE.repo} className={LINK}>
            GitHub
          </a>
        </span>
      </nav>
    </header>
  )
}
