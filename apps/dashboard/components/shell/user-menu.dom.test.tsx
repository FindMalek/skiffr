import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const calls = { signOut: 0, toasts: [] as string[], error: false }
mock.module("@skiffr/auth/client", () => ({
  authClient: {
    signOut: async () => {
      calls.signOut += 1
      if (calls.error) throw new Error("network")
      return { error: null }
    },
  },
}))
mock.module("next/navigation", () => ({ useRouter: () => ({ push() {} }), usePathname: () => "/" }))
mock.module("sonner", () => ({ toast: { error: (message: string) => calls.toasts.push(message) } }))

const { UserMenu } = await import("./user-menu")
const { ShortcutsProvider } = await import("./shortcuts")

let root: Root
let host: HTMLElement

beforeEach(() => {
  calls.signOut = 0
  calls.toasts.length = 0
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

test("a failed sign out says so and leaves the menu usable", async () => {
  await act(async () =>
    root.render(
      <ShortcutsProvider>
        <UserMenu me={{ name: "Ana", email: "ana@test.dev", image: null, role: null }} />
      </ShortcutsProvider>,
    ),
  )
  const open = async () => {
    await act(async () => host.querySelector<HTMLButtonElement>("button")?.click())
    await wait(50)
    return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent === "Sign out")
  }
  calls.error = true
  await act(async () => (await open())?.click())
  await wait(100)
  expect(calls.signOut).toBe(1)
  expect(calls.toasts).toEqual(["Could not sign out. Check your connection and try again."])
  expect(host.querySelector("button")).not.toBeNull()
})
