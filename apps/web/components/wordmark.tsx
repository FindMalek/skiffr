"use client"

import { useEffect, useState } from "react"

/** Types the project name once, then keeps a blinking caret after it. */
export function Wordmark({ text }: { text: string }) {
  const [shown, setShown] = useState(1)
  useEffect(() => {
    if (shown >= text.length) return
    const timer = setTimeout(() => setShown((n) => n + 1), 90)
    return () => clearTimeout(timer)
  }, [shown, text.length])

  return (
    <h1 className="flex items-center font-heading font-bold text-6xl tracking-tighter sm:text-8xl" aria-label={text}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      <span aria-hidden className="text-muted-foreground/40">
        {text.slice(shown)}
      </span>
      <span aria-hidden className="ml-1 h-12 w-1 animate-caret bg-primary sm:h-20" />
    </h1>
  )
}
