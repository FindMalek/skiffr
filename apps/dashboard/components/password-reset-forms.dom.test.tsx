import { afterEach, beforeEach, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { installDom } from "./answers/test-dom"

const dom = installDom("http://localhost:3002/reset-password?token=secret-token")

let requests: { url: string; body: string }[] = []
let reply: () => Response = () => Response.json({}, { status: 500 })
// The auth client keeps the `fetch` it sees on import, so the fake is installed first and each test sets `reply`.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  requests.push({ url: new URL(request.url).pathname, body: await request.text() })
  return reply()
}) as typeof fetch
const { ForgotPasswordForm, ResetPasswordForm } = await import("./password-reset-forms")

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

const render = (node: React.ReactNode) => act(async () => root.render(node))

async function submit(id: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement
  input.value = value
  await act(async () => void input.dispatchEvent(new window.Event("input", { bubbles: true })))
  await act(async () => {
    host.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

test("forgot password without a mailer says so and sends nothing", async () => {
  await render(<ForgotPasswordForm enabled={false} />)
  expect(host.querySelector("form")).toBeNull()
  expect(host.textContent).toContain("isn't set up on this server")
})

test("forgot password answers the same whatever the email, without asking for more", async () => {
  reply = () =>
    Response.json({ status: true, message: "If this email exists in our system, check your email for the reset link" })
  await render(<ForgotPasswordForm enabled />)
  await submit("email", "ghost@nowhere.dev")
  expect(requests[0]?.url).toBe("/api/auth/request-password-reset")
  expect(host.querySelector("h1")?.textContent).toBe("Check your email")
  expect(host.textContent).toContain("If an account uses ghost@nowhere.dev")
})

test("the reset token leaves the address bar at once and goes to the api only in the body", async () => {
  reply = () => Response.json({ status: true })
  await render(<ResetPasswordForm token="secret-token" canRequestNew />)
  expect(dom.location.search).toBe("")
  await submit("password", "a-brand-new-password")
  expect(requests[0]?.url).toBe("/api/auth/reset-password")
  expect(JSON.parse(requests[0]?.body ?? "{}")).toMatchObject({ token: "secret-token" })
  expect(host.querySelector("h1")?.textContent).toBe("Password changed")
})

test("a used or expired token ends in a card that says what to do next, a link only when a new one can be sent", async () => {
  reply = () => Response.json({ code: "INVALID_TOKEN", message: "Invalid token" }, { status: 400 })
  await render(<ResetPasswordForm token="secret-token" canRequestNew />)
  await submit("password", "a-brand-new-password")
  expect(host.querySelector("h1")?.textContent).toBe("This link doesn't work")
  expect(host.querySelector('a[href="/forgot-password"]')).not.toBeNull()

  await render(<ResetPasswordForm token={null} canRequestNew={false} />)
  expect(host.querySelector('a[href="/forgot-password"]')).toBeNull()
  expect(host.textContent).toContain("Ask whoever runs this server")
})
