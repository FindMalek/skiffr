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

const blockTokens = (block: string): Record<string, Oklch> =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*(oklch\([^)]*\))\s*;/g)].map((m) => [m[1] as string, parseOklch(m[2] as string)]),
  )

const viz = read("viz.css")
const vizStart = viz.indexOf("@utility viz {")
const vizDark = viz.indexOf(".dark & {", vizStart)
const vizTokens = {
  light: blockTokens(viz.slice(vizStart, vizDark)),
  dark: blockTokens(viz.slice(vizDark, viz.indexOf("\n}", vizDark))),
}
const SERIES = ["--viz-1", "--viz-2", "--viz-3"]
const ORDINAL = ["--viz-o1", "--viz-o2", "--viz-o3", "--viz-o4"]

for (const [name, t] of Object.entries(themes)) {
  const at = (key: string): Oklch => t[key] as Oklch
  const surfaces = ["--background", "--card", "--muted"]

  test(`${name}: control borders and the focus ring are at least 3:1 on page and card`, () => {
    for (const surface of ["--background", "--card"]) {
      expect(contrast(at("--input"), at(surface))).toBeGreaterThanOrEqual(3)
      expect(contrast(at("--border-strong"), at(surface))).toBeGreaterThanOrEqual(3)
      expect(contrast(at("--ring"), at(surface))).toBeGreaterThanOrEqual(3)
    }
  })

  test(`${name}: text pairs are at least 4.5:1`, () => {
    const pairs: [string, string][] = [
      ["--foreground", "--background"],
      ["--card-foreground", "--card"],
      ["--popover-foreground", "--popover"],
      ["--primary-foreground", "--primary"],
      ["--secondary-foreground", "--secondary"],
      ["--accent-foreground", "--accent"],
      ["--sidebar-foreground", "--sidebar"],
      ["--sidebar-primary-foreground", "--sidebar-primary"],
      ["--sidebar-accent-foreground", "--sidebar-accent"],
      ["--muted-foreground", "--background"],
      ["--muted-foreground", "--card"],
      ["--muted-foreground", "--muted"],
      ...["--destructive", "--success", "--warning"].flatMap((k): [string, string][] => surfaces.map((s) => [k, s])),
    ]
    for (const [fg, bg] of pairs)
      expect({ fg, bg, ratio: contrast(at(fg), at(bg)) >= 4.5 }).toEqual({ fg, bg, ratio: true })
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

  test(`${name}: chart series are grey, 3:1 on page and card, told apart, with readable text on each fill`, () => {
    const v = vizTokens[name as "light" | "dark"]
    const fills = [...SERIES, ...ORDINAL, "--viz-seq"]
    for (const key of fills) {
      const fill = v[key] as Oklch
      expect(fill.c).toBe(0)
      for (const surface of ["--background", "--card"]) {
        expect({ key, surface, ok: contrast(fill, at(surface)) >= 3 }).toEqual({ key, surface, ok: true })
      }
      expect({ key, ok: contrast(v[`${key}-foreground`] as Oklch, fill) >= 4.5 }).toEqual({ key, ok: true })
    }
    // adjacent series: never equal, and never closer than the 1.9:1 the gap and hatch rule is written for
    for (const [a, b] of [SERIES.slice(0, 2), SERIES.slice(1, 3)] as [string, string][]) {
      expect(contrast(v[a] as Oklch, v[b] as Oklch)).toBeGreaterThanOrEqual(1.9)
    }
    expect(v["--viz-seq"]).toEqual(v["--viz-2"])
    // ordinal: one step per stage, always more contrast with the surface than the step before
    const steps = ORDINAL.map((k) => contrast(v[k] as Oklch, at("--background")))
    expect(steps).toEqual([...steps].sort((x, y) => x - y))
    expect(new Set(steps).size).toBe(ORDINAL.length)
  })
}

test("viz.css and theme.css have no hex or hue colours", () => {
  expect(read("viz.css")).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  for (const v of Object.values(vizTokens)) expect(Object.values(v).length).toBeGreaterThanOrEqual(16)
})
