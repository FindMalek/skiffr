import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Window } from "happy-dom"

const PAGES = join(import.meta.dir, "..", "..", "..", "e2e", "pages")

export const HOSTS = {
  greenhouse: "https://job-boards.greenhouse.io/acme/jobs/1",
  lever: "https://jobs.lever.co/acme/1/apply",
  ashby: "https://jobs.ashbyhq.com/acme/1/application",
  workable: "https://apply.workable.com/acme/j/ABC/apply/",
} as const

export type Board = keyof typeof HOSTS

/** The e2e fixture page of a board, scripts run so its widgets behave. Pass another url to see the same page without an adapter. */
export function mountBoard(
  board: Board,
  url: string = HOSTS[board],
  edit: (html: string) => string = (html) => html,
): { window: Window; document: Document } {
  const html = edit(readFileSync(join(PAGES, "adapters", `${board}.html`), "utf8"))
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] as string,
  )
  const window = new Window({ url })
  window.document.write(html.replace(/<script[\s\S]*?<\/script>/g, ""))
  window.eval(readFileSync(join(PAGES, "shared", "widgets.js"), "utf8"))
  for (const script of inline) window.eval(script)
  return { window, document: window.document as unknown as Document }
}
