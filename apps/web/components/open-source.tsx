import { Button } from "@skiffr/ui/components/button"
import { BookOpenIcon } from "lucide-react"
import { docsUrl } from "@/lib/seo"
import { SITE } from "@/lib/site"

export function OpenSource() {
  return (
    <section aria-labelledby="oss-title" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="oss-title" className="font-heading font-semibold text-3xl tracking-tight">
          Open source and self-hosted
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground leading-relaxed">
          skiffr is MIT licensed. The api, the dashboard, the extension and this site are in one repository. Run it on
          your own server with Docker or Dokploy and a Postgres with pgvector. There is no hosted service and no account
          with us.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" render={<a href={`${docsUrl()}/docs/deploy`} />} nativeButton={false}>
            <BookOpenIcon data-icon="inline-start" /> Self-hosting guide
          </Button>
          <Button variant="outline" render={<a href={`${SITE.repo}/blob/main/CONTRIBUTING.md`} />} nativeButton={false}>
            Contribute
          </Button>
        </div>
      </div>
    </section>
  )
}
