import { afterEach, expect, test } from "bun:test"
import type { AdminUser } from "@skiffr/common/schemas"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { installDom } from "@/components/answers/test-dom"

installDom("http://localhost:3002/users")
const { UsersTable } = await import("./users-table")

const person = (n: number, over: Partial<AdminUser> = {}): AdminUser => ({
  id: `u${n}`,
  name: `Person ${String(n).padStart(2, "0")}`,
  email: `person${n}@test.dev`,
  role: n === 1 ? "admin" : null,
  emailVerified: true,
  banned: false,
  createdAt: new Date(Date.UTC(2026, 10, 1, 12, n)),
  ...over,
})
const twelve = Array.from({ length: 12 }, (_, i) =>
  person(i + 1, i === 2 ? { banned: true, emailVerified: false } : {}),
)

let root: Root | undefined
let host: HTMLElement
afterEach(async () => {
  await act(async () => root?.unmount())
  host.remove()
})

async function mount(users: AdminUser[], total = users.length) {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root?.render(<UsersTable users={users} total={total} />))
}

const rows = () => Array.from(host.querySelectorAll("tbody tr")).map((tr) => tr.textContent ?? "")
const press = (label: string) =>
  act(async () => {
    const button = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes(label))
    button?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
  })
async function type(value: string) {
  const input = host.querySelector("input") as HTMLInputElement
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
    set?.call(input, value)
    input.dispatchEvent(new window.Event("input", { bubbles: true }))
  })
}

test("12 users page by 10, with role and banned and unverified markers on their rows", async () => {
  await mount(twelve)
  expect(rows()).toHaveLength(10)
  expect(rows()[0]).toContain("Admin")
  expect(rows()[2]).toContain("Banned")
  expect(rows()[2]).toContain("Unverified")
  expect(rows()[1]).not.toContain("Banned")
  expect(host.textContent).toContain("Page 1 of 2")
  await press("Next")
  expect(rows()).toHaveLength(2)
  expect(host.textContent).toContain("11-12 of 12")
})

test("a search with no result says so and clearing it brings the table back", async () => {
  await mount(twelve)
  await press("Next")
  await type("person 07")
  expect(rows()).toHaveLength(1) // back on page 1, not an empty page 2
  await type("nobody here")
  expect(host.textContent).toContain("No users match")
  expect(host.querySelector("table")).toBeNull()
  await press("Clear search")
  expect(rows()).toHaveLength(10)
})

test("more accounts than the api returned is said, not hidden", async () => {
  await mount(twelve, 140)
  expect(host.textContent).toContain("12 newest of 140")
})
