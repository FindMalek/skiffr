import type { Locator, Page } from "@playwright/test"
import { type AdapterName, answerEverything, openAdapterPage } from "../fixtures/adapters.ts"
import { connect, FILLED } from "../fixtures/application.ts"
import { expect, test } from "../fixtures/extension.ts"

type Widgets = { Fixture: { state: Record<string, string>; render: () => void } }

interface Board {
  name: AdapterName
  /** Controls that hold a value after the fill: selector to the value the page shows. */
  filled: Record<string, string>
  /** Widgets drawn by the page: selector to the text they show. */
  shown: Record<string, string>
  /** Checkboxes, radios and buttons that are on. */
  on: string[]
  /** What the framework of the page was told: its own state after a re-render, by key. */
  state: Record<string, string>
  /** Controls the fill must never touch, and words that must never reach the api. */
  untouched: string[]
  private: RegExp
  submit: string
  /** One field the person corrects after the fill. */
  correction: { selector: string; label: RegExp; value: string }
}

const BOARDS: Board[] = [
  {
    name: "greenhouse",
    filled: {
      "#first_name": "Ana",
      "#email": "ana.silva@example.com",
      "#phone": "+351 912 345 678",
      "#question_4002": "https://www.linkedin.com/in/ana-silva",
    },
    shown: {
      "#country-host .select__single-value": "Portugal",
      "#candidate-location-host .select__single-value": "Lisbon, Portugal",
      "#question_4003-host .select__single-value": "Yes",
      "#question_4004-host .select__single-value": "No",
      "#question_4005-host .select__single-value": "LinkedIn",
    },
    on: [],
    state: { first_name: "Ana", last_name: "Silva", phone: "+351 912 345 678", question_4001: "Short drafted answer." },
    untouched: ['[id="130"]', '[id="133"]', '[id="134"]', '[id="135"]', '[id="question_4007[]_748115538"]'],
    private: /gender|ethnic|veteran|disab|acknowledge/i,
    submit: "button[type=submit]",
    correction: { selector: "#phone", label: /^Phone$/, value: "+351 000 111 222" },
  },
  {
    name: "lever",
    filled: {
      "input[name=name]": "Ana Silva",
      "input[name=phone]": "+351 912 345 678",
      "#location-input": "Lisbon, Portugal",
      "input[name='urls[LinkedIn]']": "https://www.linkedin.com/in/ana-silva",
      "textarea[name=comments]": "Short drafted answer.",
    },
    shown: {},
    on: ["input[name='cards[6ddc5e28][field0]'][value=Yes]"],
    state: {},
    untouched: [
      "select[name='eeo[gender]']",
      "select[name='eeo[veteran]']",
      "select[name='eeo[disability]']",
      "input[name='eeo[disabilitySignature]']",
      "input[name='eeo[disabilitySignatureDate]']",
      "input[name=pronouns][value='He/him']",
    ],
    private: /gender|race|veteran|disab|pronoun|age range|signature|^name$|^date$/i,
    submit: "#btn-submit",
    correction: { selector: "input[name=phone]", label: /^Phone$/, value: "+351 000 111 222" },
  },
  {
    name: "ashby",
    filled: {
      "#_systemfield_name": "Ana Silva",
      "#_systemfield_email": "ana.silva@example.com",
      "[id='2f73c135-4c72-40cf-84bc-ba7700192f2f']": "https://www.linkedin.com/in/ana-silva",
      ".ashby-application-form-input-autocomplete": "Lisbon, Portugal",
    },
    shown: {},
    on: ["[data-option=no]", "#hear-labeled-radio-0"],
    state: { _systemfield_name: "Ana Silva", _systemfield_email: "ana.silva@example.com" },
    untouched: ["#privacy-labeled-checkbox-0", "#age-labeled-radio-2", "#gender-labeled-radio-2"],
    private: /gender|age|diversity|survey|privacy/i,
    submit: "button.ashby-application-form-submit-button",
    correction: { selector: "#_systemfield_name", label: /^Name$/, value: "Ana M. Silva" },
  },
  {
    name: "workable",
    filled: {
      "#firstname": "Ana",
      "#lastname": "Silva",
      "#phone": "+351 912 345 678",
      "#summary": "Short drafted answer.",
      "#input_CA_10627_input": "2 weeks",
      "#CA_10629": "LinkedIn",
    },
    shown: {},
    on: ["#wrapper_m74ZhVJHLkaayzr8", "#wrapper_l1ZK6o4KqoX0DPuC"],
    state: { firstname: "Ana", email: "ana.silva@example.com", CA_47143: "https://github.com/ana-silva" },
    untouched: ["input[name=QA_12487770]", "#EEO_2", "input[name=EEO_1]"],
    private: /gender|veteran|diversity|agree/i,
    submit: "button[data-ui=apply-button]",
    correction: { selector: "#phone", label: /^Phone$/, value: "+351 000 111 222" },
  },
]

test.beforeEach(({ mockApi, fixtureServer }) => {
  mockApi.reset()
  mockApi.onMapFields(answerEverything)
  fixtureServer.submissions.length = 0
})

async function shoot(page: Page, name: string): Promise<void> {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/6-${name}.png`, fullPage: true })
}

const isOn = (locator: Locator): Promise<boolean> =>
  locator.evaluate(
    (el) =>
      (el as HTMLInputElement).checked === true ||
      [el.getAttribute("aria-pressed"), el.getAttribute("aria-checked")].includes("true"),
  )

const lookupLabels = (requests: { path: string; body: unknown }[]): string[] =>
  requests
    .filter((request) => request.path === "/rpc/learning/lookup")
    .flatMap((request) => (request.body as { fields: { label: string }[] }).fields.map((field) => field.label))

for (const board of BOARDS) {
  test.describe(board.name, () => {
    test("fills the form through its widgets, leaves the private questions alone and never submits", async ({
      context,
      serviceWorker,
      fixtureServer,
      mockApi,
    }) => {
      await connect(serviceWorker, mockApi)
      const { page, toast } = await openAdapterPage(context, fixtureServer, board.name)

      await toast.click("yes")
      await toast.waitFor((s) => s.title !== null && FILLED.test(s.title), 30_000)

      for (const [selector, value] of Object.entries(board.filled))
        await expect(page.locator(selector)).toHaveValue(value)
      for (const selector of board.untouched) {
        const control = page.locator(selector).first()
        const type = await control.getAttribute("type")
        if (type === "checkbox" || type === "radio") await expect(control).not.toBeChecked()
        else await expect(control).toHaveValue("")
      }

      for (const [selector, text] of Object.entries(board.shown)) await expect(page.locator(selector)).toHaveText(text)
      for (const selector of board.on) expect(await isOn(page.locator(selector))).toBe(true)

      // the page's own state is what a re-render draws back, so a value it was never told about disappears
      await page.evaluate(() => (window as unknown as Partial<Widgets>).Fixture?.render())
      for (const [selector, value] of Object.entries(board.filled))
        await expect(page.locator(selector)).toHaveValue(value)
      const state = await page.evaluate(() => ({ ...(window as unknown as Partial<Widgets>).Fixture?.state }))
      expect(state).toMatchObject(board.state)

      const sent = JSON.stringify(mockApi.requests.map((request) => request.body))
      expect(sent).not.toMatch(board.private)
      expect(fixtureServer.submissions).toEqual([])
      await shoot(page, board.name)
    })

    test("a correction is recorded under the very labels the lookup used", async ({
      context,
      serviceWorker,
      fixtureServer,
      mockApi,
    }) => {
      await connect(serviceWorker, mockApi)
      const { page, toast } = await openAdapterPage(context, fixtureServer, board.name)
      await toast.click("yes")
      await toast.waitFor((s) => s.title !== null && FILLED.test(s.title), 30_000)
      await page.evaluate(() => document.addEventListener("submit", (event) => event.preventDefault()))

      await page.locator(board.correction.selector).fill(board.correction.value)
      await page.locator(board.submit).click()

      await expect.poll(() => mockApi.records.length).toBe(1)
      const [batch] = mockApi.records
      const asked = lookupLabels(mockApi.requests)
      expect(batch?.events.map((event) => event.label)).toEqual(asked)
      const label = asked.find((text) => board.correction.label.test(text))
      expect(batch?.events.find((event) => event.label === label)).toMatchObject({
        finalValue: board.correction.value,
      })
      expect(JSON.stringify(batch)).not.toMatch(board.private)
      expect(fixtureServer.submissions).toEqual([])
    })
  })
}

test("a board page on a host no adapter knows is still filled by the generic path", async ({
  context,
  serviceWorker,
  fixtureServer,
  mockApi,
}) => {
  await connect(serviceWorker, mockApi)
  const { page, toast } = await openAdapterPage(context, fixtureServer, "greenhouse", true)

  await toast.click("yes")
  await toast.waitFor((s) => s.title !== null && FILLED.test(s.title), 30_000)

  await expect(page.locator("#first_name")).toHaveValue("Ana")
  await expect(page.locator("#email")).toHaveValue("ana.silva@example.com")
  expect(lookupLabels(mockApi.requests).some((label) => /gender/i.test(label))).toBe(true)
  expect(fixtureServer.submissions).toEqual([])
})
