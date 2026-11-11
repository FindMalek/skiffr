import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { sha256Hex } from "./sha256"

test("sha256 matches node's for empty, block-edge, multi-block and non-ascii input", () => {
  for (const text of [
    "",
    "abc",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(63),
    "a".repeat(64),
    "x".repeat(5000),
    "مهندس 👩‍💻 café",
  ]) {
    expect(sha256Hex(text), text.slice(0, 10)).toBe(createHash("sha256").update(text).digest("hex"))
  }
})
