import { describe, expect, test } from "bun:test"
import {
  absoluteDate,
  absoluteTime,
  formatBytes,
  formatCount,
  formatDuration,
  formatNumber,
  formatOf,
  formatPercent,
  NA,
  relativeTime,
  toDate,
} from "./format"

// Usage: every helper takes (value, ...) and an optional { locale, timeZone }. A bad value is "n/a", never a throw.
//   relativeTime(job.queuedAt, now, { locale, timeZone })   "2h ago", "yesterday", "3 Nov"
//   absoluteTime(job.queuedAt)                              "3 Nov 2026, 14:05" (viewer's zone)
//   absoluteDate(day, { timeZone: "UTC" })                  stats days are UTC days, so a day label is formatted in UTC
//   formatCount(1, "job") "1 job" | formatOf(20, 1234, "job") "20 of 1,234 jobs" | formatPercent(0.425, { digits: 1 })
//   formatDuration(7_500_000) "2h 5m" | formatBytes(1536) "1.5 KB"
//
// Month names, separators and digit shapes come from the runtime's ICU ("Sep" or "Sept", "،" or none), so anything
// that depends on them is compared with what `Intl` itself prints. Exact strings are only used for English words we
// write ourselves ("just now", "yesterday") and for numbers.

const at = (iso: string): number => Date.parse(iso)
const ago = (now: number, ms: number): number => now - ms
const S = 1000
const M = 60 * S
const H = 60 * M
const D = 24 * H

const NOW = at("2026-11-13T12:00:00Z")
const UTC = { locale: "en-GB", timeZone: "UTC" }

/** What `Intl` prints for an instant, the reference the helpers are compared with. */
const ref = (when: number | string, fields: Intl.DateTimeFormatOptions, locale = "en-GB"): string =>
  new Intl.DateTimeFormat(locale, { calendar: "gregory", ...fields }).format(
    typeof when === "string" ? Date.parse(when) : when,
  )

/** "6 Nov" or "6 Nov 2025" the way this runtime spells it. */
const dm = (when: number | string, timeZone = "UTC", year = false, locale = "en-GB"): string =>
  ref(when, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone }, locale)

const plain = (text: string): string => text.replace(/\s/g, " ")

describe("relativeTime boundaries", () => {
  const table: [string, number, string][] = [
    ["0s", 0, "just now"],
    ["59s", 59 * S, "just now"],
    ["60s", 60 * S, "1m ago"],
    ["59m59s", H - S, "59m ago"],
    ["60m", H, "1h ago"],
    ["23h", 23 * H, "23h ago"],
    ["23h59m", 24 * H - M, "23h ago"],
    ["24h (yesterday)", 24 * H, "yesterday"],
    ["36h", 36 * H, "yesterday"],
    ["47h", 47 * H, "2d ago"],
    ["2d", 2 * D, "2d ago"],
    ["6d", 6 * D, "6d ago"],
    ["7d", 7 * D, dm(ago(NOW, 7 * D))],
    ["30d", 30 * D, dm(ago(NOW, 30 * D))],
    ["other year", NOW - at("2025-03-02T09:00:00Z"), dm("2025-03-02T09:00:00Z", "UTC", true)],
  ]
  test.each(table)("%s", (_name, back, expected) => {
    expect(relativeTime(ago(NOW, back), NOW, UTC)).toBe(expected)
  })

  test("invalid, null and empty values", () => {
    for (const bad of [null, undefined, "", "not a date", Number.NaN, new Date("x")]) {
      expect(relativeTime(bad, NOW, UTC)).toBe(NA)
    }
    expect(relativeTime(NOW, "nope", UTC)).toBe(NA)
  })

  test("a value of the wrong type is n/a, not a throw", () => {
    for (const bad of [123n, Symbol("x"), {}, [], true]) {
      expect(relativeTime(bad as never, NOW, UTC)).toBe(NA)
      expect(absoluteTime(bad as never, UTC)).toBe(NA)
    }
  })

  test("future: up to 5 minutes of skew is just now, past that a date, never 'ago'", () => {
    expect(relativeTime(NOW + 5 * M, NOW, UTC)).toBe("just now")
    expect(relativeTime(NOW + 5 * M + 1, NOW, UTC)).toBe(dm(NOW + 5 * M + 1))
    expect(relativeTime(NOW + 6 * M, NOW, UTC)).toBe(dm(NOW))
    expect(relativeTime(at("2027-02-01T00:00:00Z"), NOW, UTC)).toBe(dm("2027-02-01T00:00:00Z", "UTC", true))
    expect(relativeTime(Number.MAX_SAFE_INTEGER, NOW, UTC)).not.toContain("ago")
    expect(relativeTime(new Date(8.64e15), NOW, UTC)).not.toBe(NA)
  })

  test("accepts Date, ISO string and epoch ms alike", () => {
    const back = ago(NOW, 2 * H)
    const expected = relativeTime(back, NOW, UTC)
    expect(relativeTime(new Date(back), NOW, UTC)).toBe(expected)
    expect(relativeTime(new Date(back).toISOString(), NOW, UTC)).toBe(expected)
  })

  test("a malformed locale or zone falls back instead of throwing", () => {
    expect(relativeTime(ago(NOW, 2 * H), NOW, { locale: "not_a_locale!!", timeZone: "Mars/Base" })).toContain("2")
    for (const locale of ["", "x", "en_US", "*", "\u0000", "a".repeat(2000), "en-u-ca-islamic"]) {
      expect(() => absoluteTime(NOW, { locale, timeZone: "UTC" })).not.toThrow()
    }
  })
})

describe("zoneless strings, numbers and epoch", () => {
  test("a string with no zone is UTC in every runtime zone, so server and browser agree", () => {
    const before = process.env.TZ
    try {
      for (const tz of ["UTC", "America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata"]) {
        process.env.TZ = tz
        for (const text of ["2026-11-13T10:00:00", "2026-11-13T10:00", "2026-11-13 10:00:00.250"]) {
          expect(toDate(text)?.toISOString().slice(0, 16)).toBe("2026-11-13T10:00")
        }
        expect(toDate("2026-11-13T10:00:00+02:00")?.toISOString()).toBe("2026-11-13T08:00:00.000Z")
      }
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })

  test("a number is epoch milliseconds, seconds are not guessed", () => {
    expect(absoluteDate(1_700_000_000, UTC)).toContain("1970")
    expect(absoluteDate(1_700_000_000_000, UTC)).toContain("2023")
  })
})

describe("relativeTime calendar days follow the zone", () => {
  // 26 hours: a different calendar day gap depending on where the viewer is
  const date = at("2026-11-12T23:00:00Z")
  const now = at("2026-11-14T01:00:00Z")
  const table: [string, string][] = [
    ["UTC", "2d ago"],
    ["America/Los_Angeles", "yesterday"],
    ["Pacific/Auckland", "yesterday"],
    ["Asia/Kolkata", "yesterday"],
  ]
  test.each(table)("%s", (timeZone, expected) => {
    expect(relativeTime(date, now, { locale: "en", timeZone })).toBe(expected)
  })

  test("the default zone is the runtime TZ", () => {
    const before = process.env.TZ
    try {
      for (const [tz, expected] of table) {
        process.env.TZ = tz
        expect(relativeTime(date, now, { locale: "en" })).toBe(expected)
      }
    } finally {
      if (before === undefined) delete process.env.TZ
      else process.env.TZ = before
    }
  })
})

describe("relativeTime DST, leap days and year boundaries", () => {
  const la = { locale: "en-GB", timeZone: "America/Los_Angeles" }
  const nz = { locale: "en-GB", timeZone: "Pacific/Auckland" }

  test("US spring forward (2026-03-08): the 23 hour calendar day is still yesterday", () => {
    const now = at("2026-03-08T19:00:00Z") // 12:00 PDT
    expect(relativeTime(at("2026-03-07T20:00:00Z"), now, la)).toBe("23h ago") // 12:00 PST is 23 real hours back
    expect(relativeTime(at("2026-03-07T19:00:00Z"), now, la)).toBe("yesterday")
    expect(relativeTime(at("2026-03-01T19:00:00Z"), now, la)).toBe(dm("2026-03-01T19:00:00Z", la.timeZone)) // 7 calendar days across the change
    expect(relativeTime(at("2026-03-02T19:00:00Z"), now, la)).toBe("6d ago")
  })

  test("US fall back (2026-11-01): the 25 hour day does not skip or repeat a day", () => {
    const now = at("2026-11-02T20:00:00Z") // 12:00 PST
    expect(relativeTime(at("2026-11-01T20:00:00Z"), now, la)).toBe("yesterday")
    expect(relativeTime(at("2026-10-26T20:00:00Z"), now, la)).toBe(dm("2026-10-26T20:00:00Z", la.timeZone))
    expect(relativeTime(at("2026-10-27T20:00:00Z"), now, la)).toBe("6d ago")
  })

  test("Auckland DST end (2026-04-05) and start (2026-09-27)", () => {
    expect(relativeTime(at("2026-04-04T12:00:00Z"), at("2026-04-05T12:00:00Z"), nz)).toBe("yesterday")
    expect(relativeTime(at("2026-09-26T12:00:00Z"), at("2026-09-27T12:00:00Z"), nz)).toBe("yesterday")
    // 7 calendar days in NZ, though only 6d 23h elapsed after the clocks moved
    expect(relativeTime(at("2026-09-20T12:00:00Z"), at("2026-09-27T12:00:00Z"), nz)).toBe(
      dm("2026-09-20T12:00:00Z", nz.timeZone),
    )
  })

  test("leap day", () => {
    expect(relativeTime(at("2028-02-29T12:00:00Z"), at("2028-03-01T12:00:00Z"), UTC)).toBe("yesterday")
    expect(relativeTime(at("2027-02-28T12:00:00Z"), at("2027-03-01T12:00:00Z"), UTC)).toBe("yesterday")
    expect(relativeTime(at("2028-02-23T12:00:00Z"), at("2028-02-29T12:00:00Z"), UTC)).toBe("6d ago")
    expect(relativeTime(at("2028-02-22T12:00:00Z"), at("2028-02-29T12:00:00Z"), UTC)).toBe(dm("2028-02-22T12:00:00Z"))
  })

  test("year boundary: same instant is 'ago' in one zone and a dated year in another", () => {
    const now = at("2027-01-01T00:30:00Z")
    expect(relativeTime(at("2026-12-31T23:50:00Z"), now, UTC)).toBe("40m ago")
    expect(relativeTime(at("2026-12-20T12:00:00Z"), now, UTC)).toBe(dm("2026-12-20T12:00:00Z", "UTC", true))
    // a viewer in LA is still in 2026, so the year is left out
    expect(relativeTime(at("2026-12-20T12:00:00Z"), now, la)).toBe(dm("2026-12-20T12:00:00Z", la.timeZone))
  })

  test("epoch and far dates are formatted, not NaN", () => {
    expect(relativeTime(0, NOW, UTC)).toBe(dm(0, "UTC", true))
    expect(relativeTime(at("0100-01-01T00:00:00Z"), NOW, UTC)).toContain("100")
  })
})

describe("absoluteTime", () => {
  const instant = at("2026-11-03T14:05:09Z")
  // locale, zone, instant, the clock as it ends the text
  const table: [string, string, string, number, RegExp][] = [
    ["en-GB UTC", "en-GB", "UTC", instant, /14:05$/],
    ["en (12 hour) UTC", "en", "UTC", instant, /2:05 PM$/],
    ["fr UTC", "fr", "UTC", instant, /14:05$/],
    ["de UTC", "de", "UTC", instant, /14:05$/],
    ["ja UTC", "ja", "UTC", instant, /14:05$/],
    ["en-GB LA (PST)", "en-GB", "America/Los_Angeles", instant, /06:05$/],
    ["en-GB Auckland (NZDT, next day)", "en-GB", "Pacific/Auckland", instant, /03:05$/],
    ["en-GB Kolkata (+5:30)", "en-GB", "Asia/Kolkata", instant, /19:35$/],
  ]
  test.each(table)("%s", (_name, locale, timeZone, when, clock) => {
    const out = plain(absoluteTime(when, { locale, timeZone }))
    // the date reads as Intl prints it for that locale and zone, then the clock
    expect(
      out.startsWith(plain(ref(when, { day: "numeric", month: "short", year: "numeric", timeZone }, locale))),
    ).toBe(true)
    expect(out).toMatch(clock)
  })

  test("ar-SA stays gregorian and keeps Arabic-Indic digits", () => {
    const out = absoluteTime(instant, { locale: "ar-SA", timeZone: "UTC" })
    expect(out).toMatch(/^[٠-٩]+\s/) // day first, in Arabic-Indic digits
    expect(out).toContain("٢٠٢٦") // 2026, not a Hijri year
    expect(out).toMatch(/[٠-٩]+:[٠-٩]{2}/) // the clock
    expect(out).not.toMatch(/[0-9]/)
  })

  test("a different local day in another zone", () => {
    const auckland = absoluteDate(instant, { locale: "en-GB", timeZone: "Pacific/Auckland" })
    expect(auckland).toBe(dm(instant, "Pacific/Auckland", true))
    expect(auckland).not.toBe(absoluteDate(instant, UTC))
  })

  test("24 hour clocks pad the hour, 12 hour ones do not", () => {
    expect(absoluteTime(at("2026-11-03T00:15:00Z"), { locale: "de", timeZone: "UTC" })).toEndWith("00:15")
    expect(plain(absoluteTime(at("2026-11-03T00:15:00Z"), { locale: "en", timeZone: "UTC" }))).toEndWith("12:15 AM")
    expect(plain(absoluteTime(at("2026-11-03T03:15:00Z"), { locale: "en", timeZone: "UTC" }))).toEndWith("3:15 AM")
  })

  test("no seconds and no zone name; date only drops the clock", () => {
    expect(absoluteTime(instant, UTC)).not.toContain(":09")
    expect(absoluteTime(instant, UTC)).not.toContain("UTC")
    expect(absoluteDate(instant, UTC)).toBe(dm(instant, "UTC", true))
  })

  test("a stats day is the UTC day, whatever zone the viewer is in", () => {
    const day = new Date("2026-11-10T00:00:00Z")
    expect(absoluteDate(day, UTC)).toBe(dm(day.getTime(), "UTC", true))
    const la = absoluteDate(day, { locale: "en-GB", timeZone: "America/Los_Angeles" })
    expect(la).toBe(dm(day.getTime(), "America/Los_Angeles", true))
    expect(la).not.toBe(absoluteDate(day, UTC)) // 9 Nov in LA
  })

  test("leap day and year boundary", () => {
    expect(absoluteDate(at("2028-02-29T23:59:00Z"), UTC)).toBe(dm("2028-02-29T23:59:00Z", "UTC", true))
    const nz = { locale: "en-GB", timeZone: "Pacific/Auckland" }
    expect(absoluteDate(at("2026-12-31T23:30:00Z"), nz)).toBe(dm("2026-12-31T23:30:00Z", nz.timeZone, true))
    expect(absoluteDate(at("2026-12-31T23:30:00Z"), nz)).toContain("2027")
  })

  test("invalid input", () => {
    expect(absoluteTime(null)).toBe(NA)
    expect(absoluteTime("garbage")).toBe(NA)
    expect(absoluteDate(Number.POSITIVE_INFINITY)).toBe(NA)
  })
})

describe("relativeTime locales", () => {
  const rtf = (locale: string): Intl.RelativeTimeFormat =>
    new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" })

  test("english is compact", () => {
    for (const locale of ["en", "en-GB", "en-US"]) {
      const opts = { locale, timeZone: "UTC" }
      expect(relativeTime(ago(NOW, 2 * H), NOW, opts)).toBe("2h ago")
      expect(relativeTime(ago(NOW, 3 * D), NOW, opts)).toBe("3d ago")
      expect(relativeTime(ago(NOW, 30 * H), NOW, opts)).toBe("yesterday")
    }
  })

  const others = ["fr", "de", "ja", "ar-SA"]
  test.each(others)("%s follows Intl short style for the same units", (locale) => {
    const opts = { locale, timeZone: "UTC" }
    expect(plain(relativeTime(ago(NOW, 2 * H), NOW, opts))).toBe(plain(rtf(locale).format(-2, "hour")))
    expect(plain(relativeTime(ago(NOW, 5 * M), NOW, opts))).toBe(plain(rtf(locale).format(-5, "minute")))
    expect(plain(relativeTime(ago(NOW, 3 * D), NOW, opts))).toBe(plain(rtf(locale).format(-3, "day")))
    expect(plain(relativeTime(ago(NOW, 30 * H), NOW, opts))).toBe(plain(rtf(locale).format(-1, "day")))
    expect(relativeTime(ago(NOW, 7 * D), NOW, opts)).toBe(dm(ago(NOW, 7 * D), "UTC", false, locale))
  })

  test("ar-SA numbers are Arabic-Indic", () => {
    expect(relativeTime(ago(NOW, 3 * D), NOW, { locale: "ar-SA", timeZone: "UTC" })).toMatch(/[٠-٩]/)
  })

  test("a -u-nu- digit choice applies to relative and absolute text alike", () => {
    const opts = { locale: "en-u-nu-arab", timeZone: "UTC" }
    expect(relativeTime(ago(NOW, 2 * H), NOW, opts)).toMatch(/[٠-٩]/)
    expect(absoluteDate(NOW, opts)).toMatch(/[٠-٩]/)
  })
})

describe("numbers", () => {
  test("formatNumber across locales and bad input", () => {
    expect(formatNumber(1234567.5, { locale: "en" })).toBe("1,234,567.5")
    for (const locale of ["fr", "de", "ja", "ar-SA"]) {
      expect(plain(formatNumber(1234567.5, { locale }))).toBe(plain(new Intl.NumberFormat(locale).format(1234567.5)))
    }
    expect(formatNumber(1234.5, { locale: "ar-SA" })).toMatch(/^[٠-٩]/)
    expect(formatNumber(0, { locale: "en" })).toBe("0")
    expect(formatNumber(-1500, { locale: "en" })).toBe("-1,500")
    expect(formatNumber(1.5e12, { locale: "en", compact: true })).toBe("1.5T")
    expect(formatNumber(Number.MAX_SAFE_INTEGER, { locale: "en" })).toBe("9,007,199,254,740,991")
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 5n, "5", {}]) {
      expect(formatNumber(bad as never)).toBe(NA)
    }
  })

  test("negative zero is zero", () => {
    expect(formatNumber(-0, { locale: "en" })).toBe("0")
    expect(formatCount(-0, "job", undefined, { locale: "en" })).toBe("0 jobs")
    expect(formatBytes(-0, { locale: "en" })).toBe("0 B")
  })

  test("formatCount and formatOf", () => {
    const en = { locale: "en" }
    expect(formatCount(0, "job", undefined, en)).toBe("0 jobs")
    expect(formatCount(1, "job", undefined, en)).toBe("1 job")
    expect(formatCount(1.0000001, "job", undefined, en)).toBe("1 job") // shows as "1"
    expect(formatCount(1.5, "job", undefined, en)).toBe("1.5 jobs")
    expect(formatCount(1234, "job", undefined, en)).toBe("1,234 jobs")
    expect(formatCount(2, "answer", "answers", en)).toBe("2 answers")
    expect(formatCount(2, "company", "companies", en)).toBe("2 companies")
    expect(formatCount(Number.NaN, "job")).toBe(NA)
    expect(formatOf(20, 1234, "job", undefined, en)).toBe("20 of 1,234 jobs")
    expect(formatOf(1, 1, "job", undefined, en)).toBe("1 of 1 job")
    expect(formatOf(0, 0, "job", undefined, en)).toBe("0 of 0 jobs")
    expect(formatOf(null, 5, "job")).toBe(NA)
  })

  test("formatPercent", () => {
    const en = { locale: "en" }
    const table: [number, number | undefined, string][] = [
      [0, undefined, "0%"],
      [0.425, undefined, "43%"],
      [0.425, 1, "42.5%"],
      [1, undefined, "100%"],
      [1.5, undefined, "150%"],
      [-0.001, undefined, "0%"],
      [-0.25, undefined, "-25%"],
      [1e9, undefined, "100,000,000,000%"],
    ]
    for (const [ratio, digits, expected] of table) expect(formatPercent(ratio, { ...en, digits })).toBe(expected)
    expect(plain(formatPercent(0.5, { locale: "de" }))).toBe(
      plain(new Intl.NumberFormat("de", { style: "percent" }).format(0.5)),
    )
    expect(formatPercent(null)).toBe(NA)
    expect(formatPercent(Number.NaN)).toBe(NA)
  })

  test("formatPercent digits that are not a number do not throw", () => {
    for (const digits of [Number.NaN, Number.POSITIVE_INFINITY, -3, 99, 1.9]) {
      expect(() => formatPercent(0.1234, { locale: "en", digits })).not.toThrow()
    }
    expect(formatPercent(0.1234, { locale: "en", digits: Number.NaN })).toBe("12%")
    expect(formatPercent(0.1234, { locale: "en", digits: 99 })).toBe(formatPercent(0.1234, { locale: "en", digits: 4 }))
  })

  test("formatDuration", () => {
    const en = { locale: "en" }
    const table: [number, string][] = [
      [0, "0s"],
      [1, "under 1s"],
      [999, "under 1s"],
      [1000, "1s"],
      [45_000, "45s"],
      [60_000, "1m"],
      [61_000, "1m 1s"],
      [H - 1, "59m 59s"],
      [H, "1h"],
      [2 * H + 5 * M + 30 * S, "2h 5m"],
      [D, "1d"],
      [3 * D + 4 * H + 59 * M, "3d 4h"],
      [1e12, "11,574d 1h"],
    ]
    for (const [ms, expected] of table) expect(formatDuration(ms, en)).toBe(expected)
    for (const bad of [-1, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatDuration(bad)).toBe(NA)
  })

  test("formatBytes", () => {
    const en = { locale: "en" }
    const table: [number, string][] = [
      [0, "0 B"],
      [1, "1 B"],
      [1023, "1,023 B"],
      [1024, "1 KB"],
      [1536, "1.5 KB"],
      [1024 * 1024 - 1, "1 MB"],
      [5 * 1024 ** 2, "5 MB"],
      [1024 ** 4 * 2.5, "2.5 TB"],
      [1024 ** 5, "1 PB"],
      [1024 ** 7, "1,048,576 PB"],
    ]
    for (const [bytes, expected] of table) expect(formatBytes(bytes, en)).toBe(expected)
    for (const bad of [-1, null, undefined, Number.NaN, Number.NEGATIVE_INFINITY]) expect(formatBytes(bad)).toBe(NA)
    expect(plain(formatBytes(1536, { locale: "de" }))).toMatch(/^1,5 KB$/)
  })
})

describe("formatter construction is bounded", () => {
  /** Counts `Intl.DateTimeFormat` constructions, with or without `new`. */
  function constructions(run: () => void): number {
    const Original = Intl.DateTimeFormat
    let count = 0
    Intl.DateTimeFormat = new Proxy(Original, {
      construct(target, args, newTarget) {
        count += 1
        return Reflect.construct(target, args, newTarget)
      },
      apply(target, thisArg, args) {
        count += 1
        return Reflect.apply(target, thisArg, args)
      },
    })
    try {
      run()
    } finally {
      Intl.DateTimeFormat = Original
    }
    return count
  }

  const opts = { locale: "en-US", timeZone: "America/New_York" }
  const burst = (): void => {
    for (let i = 0; i < 1000; i++) {
      absoluteTime(NOW - i * M, opts)
      relativeTime(NOW - i * 3 * H, NOW, opts)
    }
  }

  test("1000 absolute and relative calls with a named zone construct nothing after the first", () => {
    burst()
    expect(constructions(burst)).toBe(0)
  })

  test("without a zone it is at most one lookup of the runtime zone per call", () => {
    const calls = 200
    const count = constructions(() => {
      for (let i = 0; i < calls; i++) absoluteTime(NOW - i * M, { locale: "en-US" })
    })
    expect(count).toBeLessThanOrEqual(calls + 5) // the lookup, plus a formatter or two the first time
  })

  test("the cache is emptied when it fills, so odd input cannot grow it", () => {
    const zones = Intl.supportedValuesOf("timeZone").slice(0, 100)
    for (const timeZone of zones) absoluteTime(NOW, { locale: "en-US", timeZone })
    expect(constructions(() => absoluteTime(NOW, { locale: "en-US", timeZone: zones[0] }))).toBeGreaterThan(0)
  })
})
