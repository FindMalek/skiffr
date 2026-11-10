import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { SITE } from "@/lib/site"

export const baseOptions: BaseLayoutProps = {
  nav: { title: <span className="font-mono font-semibold tracking-tight">{SITE.name}</span> },
  githubUrl: SITE.github || undefined,
}
