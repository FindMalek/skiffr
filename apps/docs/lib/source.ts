import { loader } from "fumadocs-core/source"
import { defineDocs } from "fumadocs-mdx/macro"

export const docs = defineDocs({
  dir: "content/docs",
  docs: { postprocess: { includeProcessedMarkdown: { output: "function", headingIds: false } } },
})

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
})
