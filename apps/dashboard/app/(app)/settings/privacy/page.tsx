import { nextEnv } from "@skiffr/env/next"
import { buttonVariants } from "@skiffr/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Data and privacy" }

const DOCS_FALLBACK = "https://github.com/FindMalek/skiffr/blob/main/apps/docs/content/docs/privacy.mdx"

export default function PrivacyPage() {
  const { DOCS_URL } = nextEnv()
  return (
    <div className="max-w-3xl p-4 md:p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Export and delete are not in the dashboard yet</EmptyTitle>
          <EmptyDescription>
            Exporting your data and deleting your account will live on this page. What skiffr stores and what it sends
            to a model provider is written down in the privacy docs.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <a
            href={DOCS_URL ? `${DOCS_URL}/docs/privacy` : DOCS_FALLBACK}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            Read the privacy docs
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </EmptyContent>
      </Empty>
    </div>
  )
}
