// dev builds only: lets the browser verification script see which frames were asked to fill
export function noteFill(doc: Document): void {
  if (!import.meta.env.DEV) return
  const root = doc.documentElement
  root.dataset.skiffrFills = String(Number(root.dataset.skiffrFills ?? 0) + 1)
}
