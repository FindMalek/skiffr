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
