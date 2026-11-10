import { Button } from "@skiffr/ui/components/button"
import { ArrowRightIcon } from "lucide-react"
import type { Route } from "next"
import { SITE } from "@/lib/site"
import { StatusWindow } from "./status-window"
import { Wordmark } from "./wordmark"

export async function Hero({ dashboardUrl, docsUrl }: { dashboardUrl: string; docsUrl: string }) {
  const copy = { badge: SITE.badge, start: "Get started", docs: "API docs" }
  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 py-10 text-center">
      <span className="inline-flex items-center gap-1.5 border bg-card/80 px-2.5 py-0.5 font-mono text-muted-foreground text-xs uppercase tracking-wide">
        <span className="size-1.5 rounded-full bg-primary" />
        {copy.badge}
      </span>
      <Wordmark text={SITE.name} />
      <p className="max-w-lg text-lg text-muted-foreground leading-relaxed">{SITE.tagline}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" render={<a href={`${dashboardUrl}/sign-up` as Route} />} nativeButton={false}>
          {copy.start} <ArrowRightIcon data-icon="inline-end" />
        </Button>
        <Button size="lg" variant="outline" render={<a href={docsUrl} />} nativeButton={false}>
          {copy.docs}
        </Button>
      </div>
      <StatusWindow />
    </section>
  )
}
