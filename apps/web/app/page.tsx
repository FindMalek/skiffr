import { nextEnv } from "@skiffr/env/next"
import { connection } from "next/server"
import { Hero } from "@/components/hero"
import { JsonLd } from "@/components/json-ld"
import { SiteFooter } from "@/components/site-footer"
import { websiteJsonLd } from "@/lib/seo"

/** Rendered per request: env (urls) comes from the running container, not the build. */
export default async function HomePage() {
  await connection()
  const env = nextEnv()
  return (
    <div className="flex min-h-dvh flex-col">
      <JsonLd data={websiteJsonLd()} />
      <main className="flex flex-1 items-center justify-center">
        <Hero dashboardUrl={env.DASHBOARD_URL} docsUrl={`${env.API_PUBLIC_URL}/v1/docs`} />
      </main>
      <SiteFooter />
    </div>
  )
}
