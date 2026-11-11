import type { ProfileData, ProfileFields } from "../schemas"

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

export * from "./canonical-job"
export * from "./safe-text"

/** Profile as flat `section.key` entries. Extra fields live under `fields.<normalized label>`. */
export function flattenProfile(
  profile: { data: ProfileData; fields: ProfileFields },
  allow: (key: string) => boolean = () => true,
): Record<string, string> {
  const flat: Record<string, string> = {}
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return
    if (Array.isArray(value)) {
      if (value.length > 0 && allow(prefix)) flat[prefix] = value.join(", ")
    } else if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(`${prefix}.${key}`, child)
    } else if (allow(prefix)) {
      flat[prefix] = String(value)
    }
  }
  for (const [section, value] of Object.entries(profile.data)) walk(section, value)
  for (const [label, value] of Object.entries(profile.fields).sort(([a], [b]) => (a < b ? -1 : 1)))
    walk(`fields.${label}`, value)
  return flat
}
