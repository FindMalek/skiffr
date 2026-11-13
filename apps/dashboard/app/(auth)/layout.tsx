import { nextEnv } from "@skiffr/env/next"

const PRIVACY_FALLBACK = "https://github.com/FindMalek/skiffr/blob/main/apps/docs/content/docs/privacy.mdx"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { WEB_URL, DOCS_URL } = nextEnv()
  const link = "underline underline-offset-4 hover:text-foreground"
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-4 py-6 md:px-6 md:py-8 xl:px-8">
      <header className="flex flex-col gap-1">
        <p className="font-heading text-xl font-semibold">skiffr</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Fills job applications from your own data. Self-hosted. You press submit.
        </p>
      </header>
      <main id="main" className="w-full max-w-sm flex-1">
        {children}
      </main>
      <footer className="flex gap-4 text-xs text-muted-foreground">
        <a href={WEB_URL} className={link}>
          Website
        </a>
        <a href={DOCS_URL ? `${DOCS_URL}/docs/privacy` : PRIVACY_FALLBACK} className={link}>
          Privacy
        </a>
      </footer>
    </div>
  )
}
