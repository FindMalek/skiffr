import { connection } from "next/server"
import { Features } from "@/components/features"
import { Hero } from "@/components/hero"
import { HowItWorks } from "@/components/how-it-works"
import { JsonLd } from "@/components/json-ld"
import { OpenSource } from "@/components/open-source"
import { PrivacySection } from "@/components/privacy-section"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { websiteJsonLd } from "@/lib/seo"

/** Rendered per request: env (urls) comes from the running container, not the build. */
export default async function HomePage() {
  await connection()
  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={websiteJsonLd()} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Hero />
        <HowItWorks />
        <Features />
        <PrivacySection />
        <OpenSource />
      </main>
      <SiteFooter />
    </div>
  )
}
