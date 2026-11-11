import { Badge } from "@skiffr/ui/components/badge"
import { Button } from "@skiffr/ui/components/button"
import { Kbd, KbdGroup } from "@skiffr/ui/components/kbd"
import { ArrowRightIcon } from "lucide-react"
import { SITE } from "@/lib/site"
import { MockForm } from "./mock-form"

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col items-start gap-6">
          <Badge variant="outline" className="font-mono uppercase tracking-wide">
            {SITE.badge}
          </Badge>
          <h1 id="hero-title" className="font-bold font-heading text-4xl tracking-tight text-balance sm:text-6xl">
            Job applications that fill themselves, and need fewer fixes each time.
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground leading-relaxed">
            skiffr is an open-source Chrome extension. It fills application forms from your own profile, never submits
            anything, and learns from every correction you make. You host the data yourself.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" render={<a href={`${SITE.repo}#install-from-a-ci-build`} />} nativeButton={false}>
              Get the extension <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <Button size="lg" variant="outline" render={<a href={SITE.repo} />} nativeButton={false}>
              View on GitHub
            </Button>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
            Fill the page with
            <KbdGroup>
              <Kbd className="text-foreground">Ctrl</Kbd>
              <Kbd className="text-foreground">Shift</Kbd>
              <Kbd className="text-foreground">F</Kbd>
            </KbdGroup>
            or <Kbd className="text-foreground">Cmd</Kbd> on macOS.
          </p>
        </div>
        <figure className="flex flex-col gap-2">
          <MockForm step="detect" />
          <figcaption className="text-muted-foreground text-xs">Illustration, not a screenshot.</figcaption>
        </figure>
      </div>
    </section>
  )
}
