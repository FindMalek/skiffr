import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8")

type Oklch = { l: number; c: number; h: number }

const parseOklch = (value: string): Oklch => {
  const m = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!m) throw new Error(`not an oklch colour: ${value}`)
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) }
}

const luminance = ({ l, c, h }: Oklch): number => {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const [r, g, bl] = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map((v) => Math.min(1, Math.max(0, v)))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0)
}

const contrast = (a: Oklch, b: Oklch): number => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Tokens of one theme block, with `var(--x)` aliases resolved. */
const tokens = (css: string, selector: ":root" | ".dark"): Record<string, Oklch> => {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf("\n}", start))
  const raw = new Map<string, string>()
  for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g)) raw.set(m[1] as string, (m[2] as string).trim())
  const resolve = (value: string): string => {
    const ref = value.match(/^var\((--[\w-]+)\)$/)
    return ref ? resolve(raw.get(ref[1] as string) as string) : value
  }
  return Object.fromEntries(
    [...raw]
      .map(([k, v]) => [k, resolve(v)] as const)
      .filter(([, v]) => v.startsWith("oklch("))
      .map(([k, v]) => [k, parseOklch(v)]),
  )
}

const theme = read("theme.css")
const themes = { light: tokens(theme, ":root"), dark: tokens(theme, ".dark") }
const STATUS = ["--destructive", "--success", "--warning"]

for (const [name, t] of Object.entries(themes)) {
  const at = (key: string): Oklch => t[key] as Oklch

  test(`${name}: control borders and the focus ring are at least 3:1 on page and card`, () => {
    for (const surface of ["--background", "--card"]) {
      expect(contrast(at("--input"), at(surface))).toBeGreaterThanOrEqual(3)
      expect(contrast(at("--border-strong"), at(surface))).toBeGreaterThanOrEqual(3)
      expect(contrast(at("--ring"), at(surface))).toBeGreaterThanOrEqual(3)
    }
  })

  test(`${name}: muted text and status colours are at least 4.5:1 as text`, () => {
    for (const surface of ["--background", "--card", "--muted"]) {
      expect(contrast(at("--muted-foreground"), at(surface))).toBeGreaterThanOrEqual(4.5)
    }
    for (const key of STATUS) expect(contrast(at(key), at("--background"))).toBeGreaterThanOrEqual(4.5)
  })

  test(`${name}: structure borders are visible against the page`, () => {
    expect(contrast(at("--border"), at("--background"))).toBeGreaterThanOrEqual(1.3)
  })

  test(`${name}: only the status tokens have chroma`, () => {
    for (const [key, value] of Object.entries(t)) {
      if (STATUS.includes(key)) expect(value.c).toBeGreaterThan(0.05)
      else expect({ key, c: value.c }).toEqual({ key, c: 0 })
    }
  })
}

test("viz tokens are greys, with no hue, in both themes", () => {
  const viz = read("viz.css")
  const values = [...viz.matchAll(/--viz-[\w]+:\s*([^;]+);/g)].map((m) => (m[1] as string).trim())
  expect(values.length).toBeGreaterThanOrEqual(18)
  for (const value of values) expect(parseOklch(value).c).toBe(0)
  expect(viz).not.toMatch(/#[0-9a-f]{3,8}\b/i)
})
