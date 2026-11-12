import { createHash } from "node:crypto"
import type { BrowserContext, Frame, Page } from "@playwright/test"
import type { FieldDescriptor, FieldMapping } from "@skiffr/common/schemas"
import { isSensitive } from "../../playground/src/sensitive.ts"
import { answerEverything } from "../fixtures/adapters.ts"
import { connect, FILLED } from "../fixtures/application.ts"
import { expect, test } from "../fixtures/playground.ts"
import { ToastDriver } from "../fixtures/toast.ts"

interface Control {
  id: string
  name: string
  label: string
  type: string
  required: boolean
  value: string
  trap: boolean
}

type Expected = [label: RegExp, value: string]

interface PageCase {
  site: string
  /** The page under its real board host name over https, so host based detection and the adapters run. */
  real?: boolean
  query?: string
  expect: Expected[]
  /** Selector of the button that submits, null when the page needs more steps than this table fills. */
  submit: string | null
  /** The extension must not offer to fill this page at all. */
  noOffer?: boolean
}

const NAME: Expected[] = [
  [/^(first|given) name/i, "Ana"],
  [/^(last|family) name/i, "Silva"],
]
const EMAIL: Expected = [/^email/i, "ana.silva@example.com"]
const PHONE: Expected = [/^phone( number)?\b/i, "+351 912 345 678"]
const SUBMIT = "button[type=submit], input[type=submit]"

const PAGES: PageCase[] = [
  {
    site: "greenhouse",
    real: true,
    expect: [...NAME, EMAIL, [/linkedin profile/i, "https://www.linkedin.com/in/ana-silva"]],
    submit: SUBMIT,
  },
  {
    site: "greenhouse-legacy",
    real: true,
    expect: [...NAME, EMAIL, PHONE, [/how did you hear/i, "LinkedIn"]],
    submit: SUBMIT,
  },
  {
    site: "lever",
    real: true,
    expect: [[/^full name/i, "Ana Silva"], EMAIL, PHONE, [/linkedin url/i, "https://www.linkedin.com/in/ana-silva"]],
    submit: SUBMIT,
  },
  { site: "ashby", real: true, expect: [[/^name$/i, "Ana Silva"], EMAIL], submit: SUBMIT },
  { site: "workable", real: true, expect: [...NAME, EMAIL, PHONE], submit: SUBMIT },
  {
    site: "smartrecruiters",
    real: true,
    expect: [...NAME, EMAIL, PHONE, [/how did you hear/i, "LinkedIn"]],
    submit: SUBMIT,
  },
  { site: "teamtailor", real: true, expect: [...NAME, EMAIL, PHONE], submit: SUBMIT },
  { site: "bamboohr", real: true, expect: [...NAME, EMAIL, PHONE], submit: SUBMIT },
  { site: "recruitee", real: true, expect: [EMAIL, PHONE, [/^full name/i, "Ana Silva"]], submit: SUBMIT },
  { site: "personio", real: true, expect: [...NAME, EMAIL, PHONE], submit: SUBMIT },
  { site: "join", real: true, expect: [...NAME, EMAIL, PHONE], submit: SUBMIT },
  { site: "generic", expect: [...NAME, EMAIL, PHONE, [/why do you want/i, "Short drafted answer."]], submit: SUBMIT },
  { site: "react", expect: [...NAME, EMAIL, PHONE, [/why do you want/i, "Short drafted answer."]], submit: SUBMIT },
  { site: "vue", expect: [...NAME, EMAIL, PHONE, [/why do you want/i, "Short drafted answer."]], submit: SUBMIT },
  { site: "honeypot", expect: [...NAME, EMAIL, PHONE], submit: SUBMIT },
  { site: "eeo", expect: [...NAME, EMAIL, PHONE], submit: SUBMIT },
  { site: "workday", real: true, expect: [EMAIL, PHONE, [/how did you hear/i, "LinkedIn"]], submit: null },
]

const EXTRA: [RegExp, (field: FieldDescriptor) => Partial<FieldMapping>][] = [
  [/given name/i, () => ({ action: "profile", key: "identity.firstName" })],
  [/family name/i, () => ({ action: "profile", key: "identity.lastName" })],
  [/(^|: )full name/i, () => ({ action: "generate", value: "Ana Silva" })],
  [/^country\b/i, () => ({ action: "generate", value: "Portugal" })],
]

/** The e2e mock model, plus the few labels the boards of this playground use that it does not know. */
function answer(fields: FieldDescriptor[]): FieldMapping[] {
  return answerEverything(fields).map((mapping, index) => {
    if (mapping.action !== "skip") return mapping
    const label = fields[index]?.label ?? ""
    const extra = EXTRA.find(([pattern]) => pattern.test(label))
    return extra
      ? ({
          ...mapping,
          confidence: 0.9,
          reason: "mock: playground label",
          ...extra[1](fields[index] as FieldDescriptor),
        } as FieldMapping)
      : mapping
  })
}

const signatureOf = (fields: { label: string; type?: string }[]): string =>
  createHash("sha256")
    .update(
      fields
        .map((field) => `${field.label.toLowerCase().replace(/[\s*:]+$/, "")}|${field.type ?? ""}`)
        .sort()
        .join("\n"),
    )
    .digest("hex")
    .slice(0, 16)

type Playground = Awaited<ReturnType<typeof import("../server/playground.ts").startPlayground>>

async function open(
  context: BrowserContext,
  playground: Playground,
  item: Pick<PageCase, "site" | "real" | "query">,
  run: string,
) {
  const page = await context.newPage()
  const query = [item.query, `run=${run}`].filter(Boolean).join("&")
  await page.goto(item.real ? playground.realUrl(item.site, query) : playground.url(item.site, query))
  await page.bringToFront()
  const toast = await ToastDriver.attach(context, page)
  return { page, toast }
}

async function declineCookies(page: Page): Promise<void> {
  const decline = page.locator("[data-ui=cookie-consent-decline]")
  if ((await decline.count()) > 0) {
    await decline.click()
    await expect(decline).toHaveCount(0)
  }
}

/** Waits for the offer, accepts it and waits for the end of the fill. */
async function fill(toast: ToastDriver, offerMs = 15_000): Promise<string> {
  await toast.waitFor((s) => s.buttons.some((b) => b.action === "yes"), offerMs)
  await toast.click("yes")
  const done = await toast.waitFor((s) => s.title !== null && FILLED.test(s.title), 30_000)
  return done.title ?? ""
}

const framesOf = (page: Page): Frame[] => page.frames()

/** What every control of the page and its frames holds right now, as the page itself reports it for /inspect. */
async function controls(page: Page): Promise<Control[]> {
  const all: Control[] = []
  for (const frame of framesOf(page)) {
    const list = await frame
      .evaluate(() => (window as unknown as { PG?: { summary: () => Control[] } }).PG?.summary() ?? [])
      .catch(() => [] as Control[])
    all.push(...list)
  }
  return all
}

const valueFor = (list: Control[], label: RegExp): string | undefined =>
  list.find((control) => label.test(control.label) && control.value)?.value

test.beforeEach(({ mockApi, playground }) => {
  mockApi.reset()
  mockApi.onMapFields(answer)
  playground.store.clear()
  playground.variants.reset()
})

async function shoot(page: Page, name: string): Promise<void> {
  if (process.env.E2E_SHOTS)
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/playground-${name}.png`, fullPage: true })
}

const runId = (site: string): string => `${site}-${test.info().workerIndex}-${test.info().repeatEachIndex}`

for (const item of PAGES) {
  test(`${item.site}: fills the form, leaves who you are and what you agree to alone, and submits only to the playground`, async ({
    context,
    serviceWorker,
    mockApi,
    playground,
  }) => {
    const run = runId(item.site)
    const outside: string[] = []
    context.on("request", (request) => {
      const host = new URL(request.url()).hostname
      if (!/\.localhost$|^127\.0\.0\.1$|^localhost$/.test(host) && !playgroundHost(host)) outside.push(request.url())
    })
    await connect(serviceWorker, mockApi)
    const { page, toast } = await open(context, playground, item, run)
    await declineCookies(page)
    await fill(toast)

    const list = await controls(page)
    for (const [label, value] of item.expect) expect(valueFor(list, label), `${label}`).toBe(value)
    for (const control of list) {
      if (isSensitive(control.label, control.name) || control.trap || control.type === "password") {
        expect(control.value, `${control.label} must stay empty`).toBe("")
      }
    }
    expect(playground.store.list({ run }), "filling never submits").toHaveLength(0)
    await shoot(page, item.site)

    if (item.submit) {
      await page.locator(item.submit).first().click()
      await expect.poll(() => playground.store.list({ run }).length).toBe(1)
      const [saved] = playground.store.list({ run })
      expect(saved?.counts.sensitiveTouched).toBe(0)
      expect(saved?.counts.trapTouched).toBe(0)
      expect(saved?.counts.filled).toBeGreaterThanOrEqual(item.expect.length)
      await expect(page.locator("[data-confirmation]")).toContainText(/thank|submitted|sent|applied|received/i)
    }
    expect(outside, "no page loads anything from another host").toEqual([])
  })
}

const playgroundHost = (host: string): boolean =>
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|linkedin\.com|myworkdayjobs\.com|smartrecruiters\.com|teamtailor\.com|bamboohr\.com|recruitee\.com|personio\.de|join\.com|acme\.test)$/.test(
    host,
  )

test("the index lists every page with its address, and the job urls api agrees", async ({ context, playground }) => {
  const page = await context.newPage()
  await page.goto(playground.origin)
  const jobs = (await (await page.request.get(`${playground.origin}/api/jobs`)).json()) as {
    jobs: { site: string; url: string }[]
  }
  for (const job of jobs.jobs)
    await expect(page.locator(`tr[data-site="${job.site}"]`)).toContainText(new URL(job.url).host)
  expect(jobs.jobs.length).toBeGreaterThanOrEqual(20)
  await shoot(page, "index")
})

test("the account wall of a Workday style site is not a form: no offer, nothing typed into the sign in fields", async ({
  context,
  serviceWorker,
  mockApi,
  playground,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await open(
    context,
    playground,
    { site: "workday", real: true, query: "wall=1" },
    runId("wall"),
  )
  await page.waitForTimeout(2500)
  expect((await toast.snapshot()).buttons).toEqual([])
  expect((await controls(page)).filter((control) => control.value)).toEqual([])
  expect(mockApi.requests.filter((request) => request.path === "/rpc/ai/mapFields")).toEqual([])
})

test("a cross origin iframe on a company page is filled inside the frame", async ({
  context,
  serviceWorker,
  mockApi,
  playground,
}) => {
  await connect(serviceWorker, mockApi)
  const run = runId("embed")
  const { page, toast } = await open(context, playground, { site: "embed", real: true }, run)
  await fill(toast)
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())
  expect(new URL(frame?.url() ?? "").hostname).toBe("boards.greenhouse.io")
  if (!frame) throw new Error("the company page has no frame")
  await expect(frame.locator("#first_name")).toHaveValue("Ana")
  await frame.locator("#submit_app").click()
  await expect.poll(() => playground.store.list({ run }).length).toBe(1)
})

test("a form in an open shadow root is not offered yet: the gap shows here instead of in a real site", async ({
  context,
  serviceWorker,
  mockApi,
  playground,
}) => {
  test.fail(true, "the detector scores light DOM controls only, so a form inside a shadow root gets no offer")
  await connect(serviceWorker, mockApi)
  const { page, toast } = await open(context, playground, { site: "shadow" }, runId("shadow"))
  await fill(toast, 6_000)
  expect(valueFor(await controls(page), /^first name/i)).toBe("Ana")
})

test("linkedin easy apply: the content is replaced at every step and the review shows what every step held", async ({
  context,
  serviceWorker,
  mockApi,
  playground,
}) => {
  await connect(serviceWorker, mockApi)
  const run = runId("linkedin")
  const { page, toast } = await open(context, playground, { site: "linkedin" }, run)
  await page.locator("#jobs-apply-button-id").click()

  await fill(toast)
  await expect(page.locator('[name="email"]')).toHaveValue("ana.silva@example.com")
  await expect(page.locator('[name="phone"]')).toHaveValue("+351 912 345 678")
  await page.locator('[name="phone_country"]').selectOption("Portugal")
  await page.locator("#easy-apply-next").click()

  await expect(page.locator("#easy-apply-step-title")).toHaveText("Resume")
  await page
    .locator('[name="resume"]')
    .setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") })
  await page.locator("#easy-apply-next").click()

  await expect(page.locator("#easy-apply-step-title")).toHaveText("Additional Questions")
  await page.locator('[name="years_typescript"]').fill("6")
  await page.locator('[name="remote_ok"][value="Yes"]').check()
  await page.locator("#easy-apply-next").click()

  await expect(page.locator("#easy-apply-step-title")).toHaveText("Voluntary self identification")
  await page.locator("#easy-apply-next").click()
  await expect(page.locator("#easy-apply-step-title")).toHaveText("Review your application")
  await expect(page.locator(".review-list")).toContainText("ana.silva@example.com")
  await page.locator("#easy-apply-submit").click()

  await expect.poll(() => playground.store.list({ run }).length).toBe(1)
  const [saved] = playground.store.list({ run })
  expect(saved?.fields.some((field) => /mobile phone/i.test(field.label) && field.value === "+351 912 345 678")).toBe(
    true,
  )
  expect(saved?.counts.sensitiveTouched).toBe(0)
})

test("the inspect page turns red when a sensitive field was filled, so a failing guard is seen", async ({
  context,
  playground,
}) => {
  const run = runId("red")
  const page = await context.newPage()
  await page.goto(playground.url("eeo", `run=${run}`))
  await page.getByLabel("Gender").selectOption("Female")
  await page.getByLabel(/Signature/).fill("Ana Silva")
  await page.locator("button[type=submit]").click()
  await expect.poll(() => playground.store.list({ run }).length).toBe(1)
  await page.goto(`${playground.origin}/inspect?run=${run}`)
  await expect(page.locator("[data-guard=failed]")).toBeVisible()
  await expect(page.locator("main")).toContainText("sensitive field was filled")
  await shoot(page, "inspect-red")
})

test.describe("switches", () => {
  test("latency delays the late mount of a framework page, the extension still finds the form and fills it", async ({
    context,
    serviceWorker,
    mockApi,
    playground,
  }) => {
    await connect(serviceWorker, mockApi)
    const { page, toast } = await open(context, playground, { site: "react", query: "latency=1500" }, runId("latency"))
    await expect(page.locator("#first_name")).toHaveCount(0)
    await expect(page.locator("#first_name")).toHaveCount(1, { timeout: 10_000 })
    await fill(toast)
    await expect(page.locator("#first_name")).toHaveValue("Ana")
  })

  test("a cookie banner over the form is declined first, then the fill works", async ({
    context,
    serviceWorker,
    mockApi,
    playground,
  }) => {
    await connect(serviceWorker, mockApi)
    const { page, toast } = await open(context, playground, { site: "generic", query: "cookie=1" }, runId("cookie"))
    await expect(page.locator("[data-ui=cookie-consent]")).toBeVisible()
    await declineCookies(page)
    await fill(toast)
    await expect(page.locator("#first_name")).toHaveValue("Ana")
  })

  test("layout b reorders the fields and the fill still lands on the right ones", async ({
    context,
    serviceWorker,
    mockApi,
    playground,
  }) => {
    await connect(serviceWorker, mockApi)
    const { page, toast } = await open(context, playground, { site: "generic", query: "layout=b" }, runId("layout"))
    const order = await page
      .locator("form input, form textarea")
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).name))
    expect(order.indexOf("first_name")).toBeGreaterThan(order.indexOf("why"))
    await fill(toast)
    const list = await controls(page)
    expect(valueFor(list, /^first name/i)).toBe("Ana")
    expect(valueFor(list, /^email/i)).toBe("ana.silva@example.com")
  })
})

test.describe("drift", () => {
  const BOARDS = [{ site: "greenhouse-legacy", real: true }, { site: "generic" }] as const

  for (const board of BOARDS) {
    test(`${board.site}: renamed ids and moved fields are still filled, a new required field is seen as drift and left empty`, async ({
      context,
      serviceWorker,
      mockApi,
      playground,
    }) => {
      await connect(serviceWorker, mockApi)

      async function run(variant: string | null) {
        mockApi.requests.length = 0
        const id = runId(`${board.site}-${variant ?? "base"}`)
        const { page, toast } = await open(
          context,
          playground,
          { ...board, query: variant ? `variant=${variant}` : "" },
          id,
        )
        const title = await fill(toast)
        const asked = mockApi.requests
          .filter((request) => request.path === "/rpc/ai/mapFields")
          .flatMap((request) => (request.body as { fields: { label: string; type?: string }[] }).fields)
        const list = await controls(page)
        await page.locator(SUBMIT).first().click()
        // a page that validates natively keeps a new empty required field from being sent at all
        const blocked = await page.locator("#clearance_v2:invalid").count()
        if (!blocked) await expect.poll(() => playground.store.list({ run: id }).length).toBe(1)
        const [saved] = playground.store.list({ run: id })
        await page.close()
        return {
          filled: Number(/\d+/.exec(title)?.[0]),
          signature: signatureOf(asked),
          list,
          saved,
          blocked: blocked > 0,
        }
      }

      const base = await run(null)
      expect(base.filled).toBeGreaterThan(3)

      const renamed = await run("renamed-ids")
      expect(renamed.filled).toBe(base.filled)
      expect(renamed.signature).toBe(base.signature)
      expect(renamed.list.some((control) => control.id.endsWith("-v2"))).toBe(true)

      const moved = await run("moved-fields")
      expect(moved.filled).toBe(base.filled)

      const added = await run("new-required-field")
      expect(added.signature, "the changed form is a different form").not.toBe(base.signature)
      expect(added.filled).toBe(base.filled)
      const flagged = added.saved?.fields.find((field) => /clearance/i.test(field.label))?.flag === "required-empty"
      expect(flagged || added.blocked, "the new required field is either flagged on /inspect or stops the submit").toBe(
        true,
      )
    })
  }

  test("the break it page switches a page into a variant for everyone until it is restored", async ({
    context,
    playground,
  }) => {
    const admin = await context.newPage()
    await admin.goto(`${playground.origin}/admin`)
    await admin.locator('button[data-site="generic"][data-variant="new-required-field"]').click()
    expect(playground.variants.get("generic")).toBe("new-required-field")
    const page = await context.newPage()
    await page.goto(playground.url("generic"))
    await expect(page.locator("#clearance_v2")).toHaveCount(1)
    await page.goto(playground.url("generic", "variant=none"))
    await expect(page.locator("#clearance_v2")).toHaveCount(0)
    await admin.locator('button[data-site="generic"][data-variant="none"]').click()
    expect(playground.variants.get("generic")).toBeNull()
  })
})
