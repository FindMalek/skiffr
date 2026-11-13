import { createHash } from "node:crypto"

/** A stable uuid for a seeded row, so a rerun and a reset give every row the same id and links to it keep working. */
export function seedId(...parts: (string | number)[]): string {
  const hex = createHash("sha256")
    .update(["seed", ...parts].join("|"))
    .digest("hex")
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`
}

export const HOUR = 36e5
export const DAY = 864e5
