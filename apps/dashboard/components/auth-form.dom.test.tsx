import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { installDom } from "./answers/test-dom"

installDom("http://localhost:3002/sign-in")

let requests: { url: string; body: string }[] = []
let reply: () => Response = () => Response.json({}, { status: 500 })
// The auth client keeps the `fetch` it sees on import, so the fake is installed first and each test sets `reply`.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  requests.push({ url: new URL(request.url).pathname, body: await request.text() })
  return reply()
}) as typeof fetch
const { AuthForm } = await import("./auth-form")

const OFF = { github: false, passwordReset: false }
let root: Root
let host: HTMLElement

beforeEach(() => {
  requests = []
  reply = () => Response.json({}, { status: 500 })
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const mount = (props: Partial<Parameters<typeof AuthForm>[0]> = {}) =>
  act(async () => root.render(<AuthForm mode="sign-in" providers={OFF} next={null} {...props} />))

const field = (id: string) => host.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement
const message = (id: string) => document.getElementById(field(id).getAttribute("aria-describedby") ?? "")?.textContent

async function submit(values: Record<string, string>) {
  for (const [id, value] of Object.entries(values)) {
    field(id).value = value
    await act(async () => void field(id).dispatchEvent(new window.Event("input", { bubbles: true })))
  }
  await act(async () => {
    host.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

test("a wrong password errors on the password field, keeps the email and says nothing about which one is wrong", async () => {
  reply = () =>
    Response.json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, { status: 401 })
  await mount()
  await submit({ email: "ana@test.dev", password: "wrong-password-1" })

  expect(requests.map((request) => request.url)).toEqual(["/api/auth/sign-in/email"])
  expect(field("email").value).toBe("ana@test.dev")
  expect(field("password").getAttribute("aria-invalid")).toBe("true")
  expect(document.activeElement).toBe(field("password"))
  expect(message("password")).toBe("That email and password don't match. Check both and try again.")
})

test("an invalid form sends nothing, focuses the first bad field and summarises several errors in an alert", async () => {
  await mount({ mode: "sign-up" })
  await submit({ email: "nope", password: "short" })

  expect(requests).toEqual([])
  expect(document.activeElement).toBe(field("name"))
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Fix 3 things to continue")
  expect(message("password")).toBe("Use at least 10 characters.")
})

test("the 429 from the rate limiter becomes a wait, not a field error", async () => {
  reply = () =>
    Response.json(
      { message: "Too many requests. Please try again later." },
      { status: 429, headers: { "x-retry-after": "42" } },
    )
  await mount()
  await submit({ email: "ana@test.dev", password: "wrong-password-1" })

  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Try again in 42 seconds.")
  expect(field("password").getAttribute("aria-invalid")).toBe("false")
})

test("signing in goes to a valid next and the form never puts the password in the url", async () => {
  reply = () => Response.json({ user: { id: "1" }, token: "t", redirect: false })
  const assign = spyOn(window.location, "assign").mockImplementation(() => {})
  await mount({ next: "/queue?status=queued" })
  expect(host.querySelector("form")?.getAttribute("method")).toBe("post")
  await submit({ email: "ana@test.dev", password: "a-long-enough-password" })

  expect(assign).toHaveBeenCalledWith("/queue?status=queued")
  assign.mockRestore()
})

test("forgot password and GitHub appear only when the server offers them", async () => {
  await mount()
  expect(host.querySelector('a[href="/forgot-password"]')).toBeNull()
  expect(host.textContent).not.toContain("GitHub")
  await mount({ providers: { github: true, passwordReset: true } })
  expect(host.querySelector('a[href="/forgot-password"]')).not.toBeNull()
  expect(host.textContent).toContain("Continue with GitHub")
})

test("leaving a field validates it but only a submit raises the summary, so nothing moves under the pointer", async () => {
  await mount({ mode: "sign-up" })
  for (const [id, value] of [
    ["email", "nope"],
    ["password", "short"],
  ] as const) {
    field(id).value = value
    await act(async () => void field(id).dispatchEvent(new window.FocusEvent("focusout", { bubbles: true })))
  }

  expect(message("email")).toBe("Enter a valid email, like name@example.com.")
  expect(message("password")).toBe("Use at least 10 characters.")
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
