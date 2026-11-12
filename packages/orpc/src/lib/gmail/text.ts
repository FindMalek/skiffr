import { SHORT_TEXT_MAX } from "@skiffr/common/constants"

/** Control characters, soft hyphens, bidi overrides and isolates, and zero width characters: none belongs in a job title. */
const INVISIBLE: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
]
const isSurrogate = (point: number) => point >= 0xd800 && point <= 0xdfff

/** Plain text from an attacker-controlled email: single spaced, no invisible or directional characters, no lone surrogates, cut at `max` code points. */
export function cleanText(input: string, max: number = SHORT_TEXT_MAX): string {
  let text = ""
  for (const char of input) {
    const point = char.codePointAt(0) ?? 0
    if (isSurrogate(point)) continue
    text += INVISIBLE.some(([from, to]) => point >= from && point <= to) ? " " : char
  }
  const points = Array.from(text.replace(/\s+/g, " ").trim())
  return points.length > max
    ? `${points
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : points.join("")
}
