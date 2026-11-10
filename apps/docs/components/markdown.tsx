import { asMarkdown, md } from "fumadocs-core/server"
import type { ReactNode } from "react"

/** Plain-markdown twins of the MDX components, used only when a page is rendered for LLMs. */

const CALLOUT_LABEL: Record<string, string> = {
  info: "Note",
  note: "Note",
  warn: "Warning",
  warning: "Warning",
  error: "Danger",
  success: "Done",
  idea: "Tip",
}

export function Callout({
  type = "info",
  title,
  children,
}: {
  type?: string
  title?: ReactNode
  children?: ReactNode
}) {
  asMarkdown()
  const label = CALLOUT_LABEL[type] ?? "Note"
  return md.linePrefix("> ")`**${label}${title ? ": " : ""}${title ?? ""}**\n\n${children}`
}

export function Cards({ children }: { children?: ReactNode }) {
  asMarkdown()
  return md`${children}`
}

export async function Card({
  title,
  description,
  href,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  href?: string
  children?: ReactNode
}) {
  asMarkdown()
  const label = (await (href ? md`[${title}](${href})` : md`**${title}**`)).trim()
  const text = (await md`${description ?? children}`).trim()
  return `- ${label}${text ? `: ${text.replace(/\n+/g, " ")}` : ""}\n`
}

export function Steps({ children }: { children?: ReactNode }) {
  asMarkdown()
  return md`${children}`
}

export function Step({ children }: { children?: ReactNode }) {
  asMarkdown()
  return md`${children}\n\n`
}

export function Tabs({ children }: { children?: ReactNode }) {
  asMarkdown()
  return md`${children}`
}

export function Tab({ value, title, children }: { value?: string; title?: ReactNode; children?: ReactNode }) {
  asMarkdown()
  return md`**${title ?? value ?? "Tab"}**\n\n${children}\n\n`
}

export interface TreeNode {
  name: string
  note?: string
  children?: TreeNode[]
}

function treeLines(nodes: TreeNode[], prefix: string): string[] {
  return nodes.flatMap((node, i) => {
    const last = i === nodes.length - 1
    const note = node.note ? `  # ${node.note}` : ""
    return [
      `${prefix}${last ? "└─ " : "├─ "}${node.name}${note}`,
      ...(node.children ? treeLines(node.children, `${prefix}${last ? "   " : "│  "}`) : []),
    ]
  })
}

export function FileTree({ items, label = "Layout" }: { items: TreeNode[]; label?: string }) {
  asMarkdown()
  return `**${label}**\n\n\`\`\`text\n${treeLines(items, "").join("\n")}\n\`\`\`\n\n`
}

export function getMarkdownComponents() {
  return { Callout, Card, Cards, FileTree, Step, Steps, Tab, Tabs }
}
