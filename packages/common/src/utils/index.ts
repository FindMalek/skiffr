export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name
}

/** The key an answer or profile field is matched on: case, accents, punctuation and spacing don't matter. */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** One form of a url for the unique check: lowercase host, no fragment, no trailing slash. */
export function normalizeUrl(url: string): string {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`
}
