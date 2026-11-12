import { type BrowserContext, expect, type Page } from "@playwright/test"
import type { FieldDescriptor, FieldMapping } from "@skiffr/common/schemas"
import type { FixtureServer } from "../server/fixture-server.ts"
import { ToastDriver } from "./toast.ts"

export const ADAPTER_PAGES = {
  greenhouse: { host: "job-boards.greenhouse.io", path: "/adapters/greenhouse.html" },
  lever: { host: "jobs.lever.co", path: "/adapters/lever.html" },
  ashby: { host: "jobs.ashbyhq.com", path: "/adapters/ashby.html" },
  workable: { host: "apply.workable.com", path: "/adapters/workable.html" },
} as const

export type AdapterName = keyof typeof ADAPTER_PAGES

export const ATS_HOSTS = Object.values(ADAPTER_PAGES).map((page) => page.host)

/**
 * The fixture server's own origin has no ats host name, so a page opened there gets no adapter: the generic path.
 * Over https the same page is served under the board's real host name (mapped to the fixture server).
 */
export function adapterUrl(
  server: Pick<FixtureServer, "origin" | "secureOrigin">,
  name: AdapterName,
  generic = false,
): string {
  const { host, path } = ADAPTER_PAGES[name]
  return generic ? `${server.origin}${path}` : `https://${host}:${new URL(server.secureOrigin).port}${path}`
}

export async function openAdapterPage(
  context: BrowserContext,
  server: Pick<FixtureServer, "origin" | "secureOrigin">,
  name: AdapterName,
  generic = false,
  keepConsent = false,
): Promise<{ page: Page; toast: ToastDriver }> {
  const page = await context.newPage()
  await page.goto(adapterUrl(server, name, generic))
  await page.bringToFront()
  // the fixture keeps the banner in the bottom left corner, clear of the toast in the bottom right, which a slow runner may show before this click
  // the page is static markup, so the banner is there at load: a person accepts or declines it before filling, and it covers the foot of the form until then
  const decline = page.locator("[data-ui=cookie-consent-decline]")
  if (!keepConsent && (await decline.count()) > 0) {
    await decline.click()
    await expect(decline).toHaveCount(0)
  }
  const toast = await ToastDriver.attach(context, page)
  await toast.waitFor((s) => s.buttons.some((b) => b.action === "yes"))
  return { page, toast }
}

const PRIVATE =
  /gender|ethnic|race|veteran|disab|transgender|sexual|pronoun|age range|current age|diversity|survey|consent|arbitrat|agree|self-identif|please select one/i

type Rule = readonly [RegExp, string | { key: string }]

/** What a model that answers everything would say, the private questions and the consent boxes included. */
const RULES: readonly Rule[] = [
  [/first name/i, { key: "identity.firstName" }],
  [/last name/i, { key: "identity.lastName" }],
  [/preferred first name/i, { key: "identity.firstName" }],
  [/^(full )?name$|^name\b/i, "Ana Silva"],
  [/e-?mail/i, { key: "identity.email" }],
  [/phone/i, { key: "identity.phone" }],
  [/linkedin/i, { key: "links.linkedin" }],
  [/github/i, { key: "links.github" }],
  [/location \(city\)|current location/i, { key: "location.city" }],
  [/country do you intend|work from/i, "Lisbon, Portugal"],
  [/^(phone: )?country$/i, "Portugal"],
  [/authorized to work|eligible to work/i, "Yes"],
  [/sponsorship/i, "No"],
  [/hear about|hear about this job/i, "LinkedIn"],
  [/confirm that everything/i, "YES"],
  [/notice period/i, "2 weeks"],
  [/best engineer|excites you|why do you want|additional information|summary|cover letter/i, "Short drafted answer."],
  [/agree|consent|acknowledge|privacy/i, "yes"],
  [/website|portfolio/i, "https://ana.example.com"],
]

export function answerEverything(fields: FieldDescriptor[]): FieldMapping[] {
  return fields.map((field): FieldMapping => {
    const label = field.label ?? ""
    if (PRIVATE.test(label)) {
      const pick = field.options.find((o) => /decline|prefer not|do not want|don't wish|no$/i.test(o)) ?? "Decline"
      return { id: field.id, action: "generate", value: pick, confidence: 0.9, reason: "mock: private question" }
    }
    const rule = RULES.find(([pattern]) => pattern.test(label))
    if (!rule) return { id: field.id, action: "skip", confidence: 0.1, reason: "mock: no rule" }
    const [, answer] = rule
    return typeof answer === "string"
      ? { id: field.id, action: "generate", value: answer, confidence: 0.9, reason: "mock: drafted" }
      : { id: field.id, action: "profile", key: answer.key, confidence: 0.95, reason: "mock: matched rule" }
  })
}

/** Every visible control of the page as id and value, for a before and after comparison. */
export function readControls(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {}
    const name = (el: Element, i: number) => (el as HTMLInputElement).id || (el as HTMLInputElement).name || `#${i}`
    document.querySelectorAll("input, select, textarea").forEach((el, i) => {
      const input = el as HTMLInputElement
      if (
        ["hidden", "file", "submit"].includes(input.type) ||
        (el.getAttribute("aria-hidden") === "true" && input.type !== "radio")
      )
        return
      if (input.classList.contains("requiredInput")) return
      if (input.type === "checkbox" || input.type === "radio") {
        if (input.checked) out[`${name(el, i)}${input.type === "radio" ? `=${input.value}` : ""}`] = "checked"
        return
      }
      if (input.value) out[name(el, i)] = input.value
    })
    document.querySelectorAll(".select__single-value").forEach((el) => {
      const id = el.closest(".select-shell")?.querySelector("input.select__input")?.id ?? "select"
      out[`select:${id}`] = el.textContent ?? ""
    })
    document.querySelectorAll("[aria-pressed=true]").forEach((el, i) => {
      out[`pressed:${i}`] = el.textContent ?? ""
    })
    document.querySelectorAll("[role=radio][aria-checked=true]").forEach((el) => {
      out[`radio:${el.id}`] = el.textContent?.trim() ?? ""
    })
    return out
  })
}
