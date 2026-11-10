import { getMarkdownComponents } from "@/components/markdown"
import { SITE } from "@/lib/site"
import { source } from "@/lib/source"

type DocsPage = NonNullable<ReturnType<typeof source.getPage>>

/** `/docs` -> `/docs/index.md`, `/docs/setup` -> `/docs/setup.md` */
export function markdownPath(pageUrl: string): string {
  return pageUrl === "/docs" ? "/docs/index.md" : `${pageUrl}.md`
}

export function findPage(slug: string[]): DocsPage | undefined {
  return source.getPage(slug.length === 1 && slug[0] === "index" ? [] : slug)
}

/** Pages in sidebar order (meta.json), not file order. */
export function getOrderedPages(): DocsPage[] {
  const pages: DocsPage[] = []
  const walk = (nodes: ReturnType<typeof source.getPageTree>["children"]) => {
    for (const node of nodes) {
      if (node.type === "page") {
        const page = source.getPages().find((p) => p.url === node.url)
        if (page) pages.push(page)
      } else if (node.type === "folder") {
        walk(node.children)
      }
    }
  }
  walk(source.getPageTree().children)
  return pages
}

/** Point internal links at the markdown twin of the page, so an agent keeps reading markdown. */
export function absolutizeLinks(markdown: string): string {
  let fenced = false
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
      if (fenced) return line
      return line.replace(/\]\((\/docs[^)\s]*)\)/g, (_, href: string) => {
        const [path = "", hash = ""] = href.split(/(?=#)/)
        return `](${SITE.url}${markdownPath(path.replace(/\/$/, ""))}${hash})`
      })
    })
    .join("\n")
}

async function pageBody(page: DocsPage): Promise<string> {
  const body = await page.data.getText("processed", { components: getMarkdownComponents() })
  return absolutizeLinks(body).trim()
}

export async function renderPageMarkdown(page: DocsPage): Promise<string> {
  const lines = [
    "---",
    `title: ${JSON.stringify(page.data.title)}`,
    ...(page.data.description ? [`description: ${JSON.stringify(page.data.description)}`] : []),
    `url: ${SITE.url}${page.url}`,
    `markdown: ${SITE.url}${markdownPath(page.url)}`,
    "---",
  ]
  return `${lines.join("\n")}\n\n# ${page.data.title}\n\n${await pageBody(page)}\n`
}

export function renderIndex(): string {
  const links = getOrderedPages().map((page) => {
    const description = page.data.description ? `: ${page.data.description}` : ""
    return `- [${page.data.title}](${SITE.url}${markdownPath(page.url)})${description}`
  })
  return `# ${SITE.name}\n\n> ${SITE.tagline}\n\nEvery link below is the raw markdown of a docs page. Append \`.md\` to any docs url, or send \`Accept: text/markdown\`.\n\n## Docs\n\n${links.join("\n")}\n\n## Optional\n\n- [llms-full.txt](${SITE.url}/llms-full.txt): every page in one markdown file\n`
}

export async function renderFull(): Promise<string> {
  const parts = await Promise.all(
    getOrderedPages().map(async (page) => {
      const description = page.data.description ? `\n> ${page.data.description}\n` : ""
      return `# ${page.data.title}\n\nURL: ${SITE.url}${page.url}\nMarkdown: ${SITE.url}${markdownPath(page.url)}\n${description}\n${await pageBody(page)}\n`
    }),
  )
  return `# ${SITE.name} docs\n\n> ${SITE.tagline}\n\n${parts.join("\n---\n\n")}`
}
