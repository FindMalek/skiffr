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
} from "./format"

// Usage: every helper takes (value, ...) and an optional { locale, timeZone }. A bad value is "n/a", never a throw.
//   relativeTime(job.queuedAt, now, { locale, timeZone })   "2h ago", "yesterday", "3 Nov"
//   absoluteTime(job.queuedAt)                              "3 Nov 2026, 14:05" (viewer's zone)
//   absoluteDate(day, { timeZone: "UTC" })                  stats days are UTC days, so a day label is formatted in UTC
//   formatCount(1, "job") "1 job" | formatOf(20, 1234, "job") "20 of 1,234 jobs" | formatPercent(0.425, { digits: 1 })
//   formatDuration(7_500_000) "2h 5m" | formatBytes(1536) "1.5 KB"

const at = (iso: string): number => Date.parse(iso)
const ago = (now: number, ms: number): number => now - ms
const S = 1000
const M = 60 * S
const H = 60 * M
const D = 24 * H

const NOW = at("2026-11-13T12:00:00Z")
const UTC = { locale: "en-GB", timeZone: "UTC" }

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
    ["7d", 7 * D, "6 Nov"],
    ["30d", 30 * D, "14 Oct"],
    ["other year", at("2026-11-13T12:00:00Z") - at("2025-03-02T09:00:00Z"), "2 Mar 2025"],
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

  test("future: skew is just now, further ahead is a date, never 'ago'", () => {
    expect(relativeTime(NOW + 4 * M, NOW, UTC)).toBe("just now")
    expect(relativeTime(NOW + 6 * M, NOW, UTC)).toBe("13 Nov")
    expect(relativeTime(at("2027-02-01T00:00:00Z"), NOW, UTC)).toBe("1 Feb 2027")
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
    expect(relativeTime(at("2026-03-01T19:00:00Z"), now, la)).toBe("1 Mar") // 7 calendar days across the change
    expect(relativeTime(at("2026-03-02T19:00:00Z"), now, la)).toBe("6d ago")
  })

  test("US fall back (2026-11-01): the 25 hour day does not skip or repeat a day", () => {
    const now = at("2026-11-02T20:00:00Z") // 12:00 PST
    expect(relativeTime(at("2026-11-01T20:00:00Z"), now, la)).toBe("yesterday")
    expect(relativeTime(at("2026-10-26T20:00:00Z"), now, la)).toBe("26 Oct")
    expect(relativeTime(at("2026-10-27T20:00:00Z"), now, la)).toBe("6d ago")
  })

  test("Auckland DST end (2026-04-05) and start (2026-09-27)", () => {
    expect(relativeTime(at("2026-04-04T12:00:00Z"), at("2026-04-05T12:00:00Z"), nz)).toBe("yesterday")
    expect(relativeTime(at("2026-09-26T12:00:00Z"), at("2026-09-27T12:00:00Z"), nz)).toBe("yesterday")
    expect(relativeTime(at("2026-09-20T12:00:00Z"), at("2026-09-27T12:00:00Z"), nz)).toBe("21 Sep") // 7 calendar days in NZ, though only 6d 23h elapsed after the clocks moved
  })

  test("leap day", () => {
    expect(relativeTime(at("2028-02-29T12:00:00Z"), at("2028-03-01T12:00:00Z"), UTC)).toBe("yesterday")
    expect(relativeTime(at("2027-02-28T12:00:00Z"), at("2027-03-01T12:00:00Z"), UTC)).toBe("yesterday")
    expect(relativeTime(at("2028-02-23T12:00:00Z"), at("2028-02-29T12:00:00Z"), UTC)).toBe("6d ago")
    expect(relativeTime(at("2028-02-22T12:00:00Z"), at("2028-02-29T12:00:00Z"), UTC)).toBe("22 Feb")
  })

  test("year boundary: same instant is 'ago' in one zone and a dated year in another", () => {
    const now = at("2027-01-01T00:30:00Z")
    expect(relativeTime(at("2026-12-31T23:50:00Z"), now, UTC)).toBe("40m ago")
    expect(relativeTime(at("2026-12-20T12:00:00Z"), now, UTC)).toBe("20 Dec 2026")
    // a viewer in LA still sees 31 Dec 2026 as "today": the year rolled over for UTC only
    expect(relativeTime(at("2026-12-20T12:00:00Z"), now, la)).toBe("20 Dec")
  })

  test("epoch and far dates are formatted, not NaN", () => {
    expect(relativeTime(0, NOW, UTC)).toBe("1 Jan 1970")
    expect(relativeTime(at("0100-01-01T00:00:00Z"), NOW, UTC)).toContain("100")
  })
})

describe("absoluteTime", () => {
  const instant = at("2026-11-03T14:05:09Z")
  const table: [string, string, string, string][] = [
    ["en (US order) UTC", "en", "UTC", "Nov 3, 2026, 2:05 PM"],
    ["en-GB UTC", "en-GB", "UTC", "3 Nov 2026, 14:05"],
    ["fr UTC", "fr", "UTC", "3 nov. 2026, 14:05"],
    ["de UTC", "de", "UTC", "3. Nov. 2026, 14:05"],
    ["ja UTC", "ja", "UTC", "2026年11月3日 14:05"],
    ["ar-SA UTC, gregorian with Arabic-Indic digits", "ar-SA", "UTC", "٣ نوفمبر، ٢٠٢٦، ٢:٠٥ م"],
    ["en-GB LA (PST)", "en-GB", "America/Los_Angeles", "3 Nov 2026, 06:05"],
    ["en-GB Auckland (NZDT)", "en-GB", "Pacific/Auckland", "4 Nov 2026, 03:05"],
    ["en-GB Kolkata (+5:30)", "en-GB", "Asia/Kolkata", "3 Nov 2026, 19:35"],
  ]
  test.each(table)("%s", (_name, locale, timeZone, expected) => {
    expect(absoluteTime(instant, { locale, timeZone }).replace(/\s/g, " ")).toBe(expected)
  })

  test("24 hour clocks pad the hour, 12 hour ones do not", () => {
    expect(absoluteTime(at("2026-11-03T00:15:00Z"), { locale: "de", timeZone: "UTC" })).toEndWith("00:15")
    expect(absoluteTime(at("2026-11-03T00:15:00Z"), { locale: "en", timeZone: "UTC" })).toEndWith("12:15 AM")
    expect(absoluteTime(at("2026-11-03T03:15:00Z"), { locale: "en", timeZone: "UTC" })).toEndWith("3:15 AM")
  })

  test("no seconds and no zone name; date only drops the clock", () => {
    expect(absoluteTime(instant, UTC)).not.toContain(":09")
    expect(absoluteTime(instant, UTC)).not.toContain("UTC")
    expect(absoluteDate(instant, UTC)).toBe("3 Nov 2026")
  })

  test("a stats day is the UTC day, whatever zone the viewer is in", () => {
    const day = new Date("2026-11-10T00:00:00Z")
    for (const tz of ["America/Los_Angeles", "Pacific/Auckland", "Asia/Kolkata"]) {
      expect(absoluteDate(day, { locale: "en-GB", timeZone: "UTC" })).toBe("10 Nov 2026")
      expect(absoluteDate(day, { locale: "en", timeZone: tz })).not.toBe("")
    }
    expect(absoluteDate(day, { locale: "en-GB", timeZone: "America/Los_Angeles" })).toBe("9 Nov 2026")
  })

  test("leap day and year boundary", () => {
    expect(absoluteDate(at("2028-02-29T23:59:00Z"), UTC)).toBe("29 Feb 2028")
    expect(absoluteDate(at("2026-12-31T23:30:00Z"), { locale: "en-GB", timeZone: "Pacific/Auckland" })).toBe(
      "1 Jan 2027",
    )
  })

  test("invalid input", () => {
    expect(absoluteTime(null)).toBe(NA)
    expect(absoluteTime("garbage")).toBe(NA)
    expect(absoluteDate(Number.POSITIVE_INFINITY)).toBe(NA)
  })
})

describe("relativeTime locales", () => {
  const back = ago(NOW, 2 * H)
  const table: [string, string, string, string, string][] = [
    // locale, 2h, 3d, 7d
    ["en", "2h ago", "3d ago", "Nov 6", "yesterday"],
    ["en-GB", "2h ago", "3d ago", "6 Nov", "yesterday"],
    ["fr", "il y a 2 h", "il y a 3 j", "6 nov.", "hier"],
    ["de", "vor 2 Std.", "vor 3 Tagen", "6. Nov.", "gestern"],
    ["ja", "2 時間前", "3 日前", "11月6日", "昨日"],
    ["ar-SA", "قبل ساعتين", "قبل ٣ أيام", "٦ نوفمبر", "أمس"],
  ]
  test.each(table)("%s", (locale, hours, days, week, yesterday) => {
    const opts = { locale, timeZone: "UTC" }
    // ICU uses no-break spaces in some locales
    const plain = (text: string): string => text.replace(/\s/g, " ")
    expect(plain(relativeTime(back, NOW, opts))).toBe(hours)
    expect(plain(relativeTime(ago(NOW, 3 * D), NOW, opts))).toBe(days)
    expect(plain(relativeTime(ago(NOW, 7 * D), NOW, opts))).toBe(week)
    expect(plain(relativeTime(ago(NOW, 30 * H), NOW, opts))).toBe(yesterday)
  })
})

describe("numbers", () => {
  test("formatNumber across locales and bad input", () => {
    const table: [string, string][] = [
      ["en", "1,234,567.5"],
      ["fr", "1 234 567,5"],
      ["de", "1.234.567,5"],
      ["ja", "1,234,567.5"],
      ["ar-SA", "١٬٢٣٤٬٥٦٧٫٥"],
    ]
    for (const [locale, expected] of table) {
      // fr groups with a narrow no-break space; compare on plain spaces
      expect(formatNumber(1234567.5, { locale }).replace(/\s/g, " ")).toBe(expected)
    }
    expect(formatNumber(0, { locale: "en" })).toBe("0")
    expect(formatNumber(-1500, { locale: "en" })).toBe("-1,500")
    expect(formatNumber(1.5e12, { locale: "en", compact: true })).toBe("1.5T")
    expect(formatNumber(Number.MAX_SAFE_INTEGER, { locale: "en" })).toBe("9,007,199,254,740,991")
    for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatNumber(bad)).toBe(NA)
  })

  test("formatCount and formatOf", () => {
    expect(formatCount(0, "job", undefined, { locale: "en" })).toBe("0 jobs")
    expect(formatCount(1, "job", undefined, { locale: "en" })).toBe("1 job")
    expect(formatCount(1234, "job", undefined, { locale: "en" })).toBe("1,234 jobs")
    expect(formatCount(2, "answer", "answers", { locale: "en" })).toBe("2 answers")
    expect(formatCount(2, "company", "companies", { locale: "en" })).toBe("2 companies")
    expect(formatCount(Number.NaN, "job")).toBe(NA)
    expect(formatOf(20, 1234, "job", undefined, { locale: "en" })).toBe("20 of 1,234 jobs")
    expect(formatOf(1, 1, "job", undefined, { locale: "en" })).toBe("1 of 1 job")
    expect(formatOf(0, 0, "job", undefined, { locale: "en" })).toBe("0 of 0 jobs")
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
    expect(formatPercent(0.5, { locale: "de" }).replace(/\s/g, " ")).toBe("50 %")
    expect(formatPercent(null)).toBe(NA)
    expect(formatPercent(Number.NaN)).toBe(NA)
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
    expect(formatBytes(1536, { locale: "de" })).toBe("1,5 KB")
  })
})
