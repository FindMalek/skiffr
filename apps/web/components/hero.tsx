import { Badge } from "@skiffr/ui/components/badge"
import { Button } from "@skiffr/ui/components/button"
import { ArrowRightIcon, CheckIcon, ClockIcon } from "lucide-react"
import { docsHref, repoUrl } from "@/lib/seo"
import { SITE } from "@/lib/site"

const TODAY = [
  "Detects an application form and asks before filling",
  "Fills it from your profile, saved answers and an optional language model",
  "Dashboard: profile, answers, job queue and funnel stats",
  "Job sources: Gmail alerts and watched careers pages",
  "Self-hosted api and Postgres, with a Dokploy deploy",
]

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="grid items-start gap-10 lg:grid-cols-5 lg:gap-14">
        <div className="flex flex-col items-start gap-6 lg:col-span-3">
          <Badge variant="outline" className="font-mono uppercase tracking-wide">
            {SITE.badge}
          </Badge>
          <h1 id="hero-title" className="font-bold font-heading text-4xl tracking-tight text-balance sm:text-5xl">
            Job application autofill that learns.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
            <strong className="font-semibold text-foreground">Early development, not released yet.</strong> skiffr is an
            open-source Chrome extension that fills job applications from your own profile and never submits anything
            for you. A dashboard keeps your answers and a queue of jobs. You host the data yourself. There is no store
            listing yet: build the extension from the repo or load a CI build.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" render={<a href={repoUrl()} />} nativeButton={false}>
              Follow the build on GitHub <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <Button size="lg" variant="outline" render={<a href={docsHref()} />} nativeButton={false}>
              Read the docs
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-5 border bg-card p-5 lg:col-span-2">
          <div>
            <h2 className="font-medium text-sm">Works today</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {TODAY.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t pt-5">
            <h2 className="font-medium text-sm">Coming</h2>
            <p className="mt-3 flex gap-2 text-sm">
              <ClockIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              ATS adapters and CV tailoring. Learning from your edits already works, with the limits in the docs.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
