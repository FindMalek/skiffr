import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const nav = { pushed: [] as string[] }
mock.module("next/navigation", () => ({ useRouter: () => ({ push: (href: string) => nav.pushed.push(href) }) }))

const requests: { method: string; body: unknown }[] = []
const reply = { fail: false, gate: null as Promise<void> | null }
const stored = {
  id: "p1",
  data: {
    identity: { pronouns: "she/her" },
    links: { other: [] },
    workAuth: { authorizedCountries: [] },
    salary: {},
    location: {},
  },
  fields: {},
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
}
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  const body = (await request.json()).json
  requests.push({ method: request.method, body })
  await reply.gate
  if (reply.fail)
    return new Response(
      JSON.stringify({
        json: { defined: false, code: "INTERNAL_SERVER_ERROR", status: 500, message: "boom", data: {} },
      }),
      { status: 500, headers: { "content-type": "application/json" } },
    )
  const now = "2026-11-13T10:00:00.000Z"
  return new Response(
    JSON.stringify({
      json: { ...stored, ...body, updatedAt: now },
      meta: [
        [1, "createdAt"],
        [1, "updatedAt"],
      ],
    }),
    {
      headers: { "content-type": "application/json" },
    },
  )
}) as unknown as typeof fetch

const { orpc } = await import("@skiffr/orpc/react")
const { ProfileSettings } = await import("./profile-editor")

let root: Root
let host: HTMLElement
let client: QueryClient

beforeEach(() => {
  requests.length = 0
  nav.pushed.length = 0
  reply.fail = false
  reply.gate = null
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

async function mount(saved: unknown) {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } })
  client.setQueryData(orpc.profile.get.queryKey(), saved as never)
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <a href="/settings/account">Account</a>
        <a href="/settings/extension">Extension</a>
        <ProfileSettings />
      </QueryClientProvider>,
    )
  })
}

const input = (id: string) => host.querySelector(`#profile-${id}`) as HTMLInputElement
const submit = () => host.querySelector('button[type="submit"]') as HTMLButtonElement
const status = () => host.querySelector('[role="status"]')?.textContent

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 30))))

async function type(id: string, value: string) {
  const element = input(id)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

test("a new account sees the empty state, and a bad form is not sent: errors listed, focus on the first one", async () => {
  await mount(null)
  expect(host.textContent).toContain("No profile saved yet")
  expect(host.querySelector('[role="meter"]')?.getAttribute("aria-valuetext")).toBe(
    "0 of 21 fields the extension can fill",
  )

  await type("firstName", "Ada")
  await type("linkedin", "linkedin.com/in/ada")
  await type("salaryMin", "-5")
  await act(async () => submit().click())

  expect(requests).toHaveLength(0)
  expect(document.activeElement).toBe(input("linkedin"))
  expect(input("linkedin").getAttribute("aria-invalid")).toBe("true")
  expect(host.querySelector(`#profile-linkedin-error`)?.textContent).toContain("https://")
  const summary = host.querySelector('[role="alert"]')
  expect(summary?.textContent).toContain("2 fields need a change")
  expect(summary?.textContent).toContain("Minimum salary: Enter a whole number")
})

test("save sends only set values, shows saved before the api answers, and a failure puts the edits back as unsaved", async () => {
  await mount({
    ...stored,
    data: stored.data,
    createdAt: new Date(stored.createdAt),
    updatedAt: new Date(stored.updatedAt),
  })
  await type("firstName", "Ada")
  expect(status()).toBe("Unsaved changes")

  let release = () => {}
  reply.gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await act(async () => submit().click())
  await settle()
  expect(requests).toHaveLength(1)
  expect(requests[0]?.body).toEqual({
    data: {
      identity: { firstName: "Ada", pronouns: "she/her" },
      links: { other: [] },
      workAuth: { authorizedCountries: [] },
      salary: {},
      location: {},
    },
    fields: {},
  })
  expect(
    client.getQueryData<{ data: { identity: { firstName: string } } }>(orpc.profile.get.queryKey())?.data.identity
      .firstName,
  ).toBe("Ada")
  await act(async () => release())
  await settle()
  expect(status()).toContain("Saved")

  reply.gate = null
  reply.fail = true
  await type("city", "London")
  await act(async () => submit().click())
  await settle()
  expect(host.textContent).toContain("The profile was not saved")
  expect(status()).toBe("Unsaved changes")
  expect(input("city").value).toBe("London")
})

test("leaving with unsaved edits asks first and only goes on after Leave page", async () => {
  await mount({
    ...stored,
    data: stored.data,
    createdAt: new Date(stored.createdAt),
    updatedAt: new Date(stored.updatedAt),
  })
  const [account, extension] = [...host.querySelectorAll("a")] as HTMLAnchorElement[]
  const clean = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(async () => {
    account?.dispatchEvent(clean)
  })
  expect(clean.defaultPrevented).toBe(false) // nothing is dirty yet, the click is not held back

  await type("firstName", "Ada")
  const held = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  await act(async () => {
    extension?.dispatchEvent(held)
  })
  expect(held.defaultPrevented).toBe(true)
  const dialog = document.querySelector('[role="alertdialog"]')
  expect(dialog?.textContent).toContain("Leave without saving?")
  const leave = [...(dialog?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Leave page")
  await act(async () => leave?.click())
  expect(nav.pushed).toEqual(["/settings/extension"])
})

test("code that calls router.push itself is held too: the mobile settings select asks mayNavigate first", async () => {
  const { mayNavigate } = await import("@/lib/navigation-guard")
  await mount({
    ...stored,
    data: stored.data,
    createdAt: new Date(stored.createdAt),
    updatedAt: new Date(stored.updatedAt),
  })
  expect(mayNavigate("/settings/extension")).toBe(true)
  await type("city", "Leeds")
  let allowed = true
  await act(async () => {
    allowed = mayNavigate("/settings/extension")
  })
  expect(allowed).toBe(false)
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("Leave without saving?")
})
