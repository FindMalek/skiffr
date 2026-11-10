"use client"

import { CheckIcon, CopyIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"

const BUTTON =
  "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"

function CopyMarkdown({ markdownPath }: { markdownPath: string }) {
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle")
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    setState("busy")
    try {
      const text = fetch(markdownPath).then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        return res.text()
      })
      // Safari only allows the clipboard write inside the click, so hand it the pending promise
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) }),
        ])
      } else {
        await navigator.clipboard.writeText(await text)
      }
      setState("copied")
    } catch {
      setState("failed")
    }
    timer.current = setTimeout(() => setState("idle"), 2000)
  }

  return (
    <button type="button" onClick={copy} disabled={state === "busy"} className={BUTTON}>
      {state === "copied" ? <CheckIcon aria-hidden className="size-4" /> : <CopyIcon aria-hidden className="size-4" />}
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy Markdown"}
      </span>
    </button>
  )
}

/** Copy the page as markdown, open it, or hand it to a chat. */
export function PageActions({ markdownPath, markdownUrl }: { markdownPath: string; markdownUrl: string }) {
  const prompt = `Read ${markdownUrl} so I can ask questions about it.`
  const chat = (base: string) => `${base}?${new URLSearchParams({ q: prompt })}`
  return (
    <div className="-mt-4 mb-6 flex flex-wrap gap-2">
      <CopyMarkdown markdownPath={markdownPath} />
      <a href={markdownPath} className={BUTTON}>
        View as Markdown
      </a>
      <a href={chat("https://chatgpt.com/")} target="_blank" rel="noreferrer" className={BUTTON}>
        Open in ChatGPT
      </a>
      <a href={chat("https://claude.ai/new")} target="_blank" rel="noreferrer" className={BUTTON}>
        Open in Claude
      </a>
    </div>
  )
}
