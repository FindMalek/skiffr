import { expect, test } from "bun:test"
import { clipGraphemes, displayText, linkHost, neutralizeText, safeHref } from "./safe-text"

const cp = (...codes: number[]) => String.fromCodePoint(...codes)

test("bidi, zero-width and control characters are shown as code points, not obeyed", () => {
  expect(neutralizeText(`pay${cp(0x202e)}fdp.exe`)).toBe("pay[U+202E]fdp.exe")
  expect(neutralizeText(`a${cp(0x200b)}b${cp(0xfeff)}c${cp(0x2066)}d${cp(0x061c)}`)).toBe(
    "a[U+200B]b[U+FEFF]c[U+2066]d[U+061C]",
  )
  expect(neutralizeText(`x${cp(0x0)}y${cp(0x7f)}${cp(0xe0041)}`)).toBe("x[U+0000]y[U+007F][U+E0041]")
  expect(neutralizeText(`a${cp(0x3164)}b${cp(0x2800)}`)).toBe("a[U+3164]b[U+2800]")
  expect(neutralizeText("line one\nline\ttwo\r\n")).toBe("line one line two ")
  expect(neutralizeText(`lone${cp(0xd800)}`)).toBe(`lone${cp(0xfffd)}`)
})

test("real text keeps its shape: arabic, accents, emoji sequences", () => {
  const family = cp(0x1f469, 0x200d, 0x1f4bb)
  for (const text of ["مهندس برمجيات", "Café résumé", `dev ${family} 👍🏽 🇹🇳`, "<img src=x onerror=alert(1)>"]) {
    expect(neutralizeText(text)).toBe(text)
  }
  expect(neutralizeText(`a${cp(0x200d)}b`)).toBe("a[U+200D]b")
})

test("clipping never cuts a character in half", () => {
  const text = `ab${cp(0x1f469, 0x200d, 0x1f4bb)}${cp(0x65, 0x301)}cd`
  expect(clipGraphemes(text, 3)).toBe(`ab${cp(0x1f469, 0x200d, 0x1f4bb)}…`)
  expect(clipGraphemes(text, 4)).toBe(`ab${cp(0x1f469, 0x200d, 0x1f4bb)}${cp(0x65, 0x301)}…`)
  expect(clipGraphemes(text, 5)).toBe(`ab${cp(0x1f469, 0x200d, 0x1f4bb)}${cp(0x65, 0x301)}c…`)
  expect(clipGraphemes(text, 6)).toBe(text)
  expect(clipGraphemes("short", 80)).toBe("short")
  expect(displayText("x".repeat(10_000), 80)).toHaveLength(81)
  expect(clipGraphemes(`a${cp(0x301).repeat(5000)}`, 2).length).toBeLessThan(100)
})

test("only plain http(s) links become links, and the host shown is the one that is opened", () => {
  expect(safeHref("https://jobs.acme.dev/a?b=1")).toBe("https://jobs.acme.dev/a?b=1")
  for (const bad of [
    "javascript:alert(1)",
    " JavaScript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "file:///etc/passwd",
    "//evil.dev/x",
    "https://google.com@evil.dev/x",
    "http://localhost/x",
    "",
  ]) {
    expect(safeHref(bad), bad).toBeNull()
    expect(linkHost(bad), bad).toBeNull()
  }
  expect(linkHost("https://www.Jobs.acme.dev/a")).toBe("jobs.acme.dev")
  expect(linkHost("https://xn--acme-9ua.dev/a")).toBe("xn--acme-9ua.dev")
  expect(linkHost(`https://${cp(0x430)}cme.dev/a`)).toBe("xn--cme-5cd.dev")
})
