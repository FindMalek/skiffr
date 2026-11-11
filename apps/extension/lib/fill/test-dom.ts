import { Window } from "happy-dom"

/** A fresh happy-dom document with `html` as its body. */
export function mount(html: string): {
  window: Window
  document: Document
  $: <T extends HTMLElement>(sel: string) => T
} {
  const window = new Window({ url: "https://jobs.example.com/apply" })
  window.document.body.innerHTML = html
  const document = window.document as unknown as Document
  return { window, document, $: (sel) => document.querySelector(sel) as never }
}

/** A user event: happy-dom marks every dispatched event untrusted, so flip it for the watcher tests. */
export function trusted(event: Event): Event {
  Object.defineProperty(event, "isTrusted", { value: true })
  return event
}
