import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { PageActions } from "@/components/page-actions"
import { markdownPath } from "@/lib/llms"
import { SITE } from "@/lib/site"
import { source } from "@/lib/source"
import { getMDXComponents } from "@/mdx-components"

type Props = { params: Promise<{ slug?: string[] }> }

export default async function Page(props: Props) {
  const { slug } = await props.params
  const page = source.getPage(slug)
  if (!page) notFound()
  const MDX = page.data.body
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <PageActions markdownPath={markdownPath(page.url)} markdownUrl={`${SITE.url}${markdownPath(page.url)}`} />
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  )
}

export function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params
  const page = source.getPage(slug)
  if (!page) notFound()
  const image = `/og${slug?.length ? `/${slug.join("/")}` : ""}`
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { types: { "text/markdown": markdownPath(page.url) } },
    openGraph: { images: [{ url: image, width: 1200, height: 630 }] },
  }
}
