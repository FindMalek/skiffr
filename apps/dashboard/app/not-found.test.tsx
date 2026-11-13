import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const api = { me: null as unknown, fail: false, users: (() => Promise.resolve({})) as () => Promise<unknown> }
mock.module("next/navigation", () => ({
  usePathname: () => "/nope",
  useRouter: () => ({ push: () => {} }),
  notFound: () => {
    throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" })
  },
}))
mock.module("@/lib/api", () => ({
  call: async (fn: (client: unknown) => Promise<unknown>) => {
    if (api.fail) throw new Error("api down")
    return fn({ me: { get: async () => api.me }, admin: { users: async () => api.users() } })
  },
}))

// The dashboard has no direct dependency on @orpc/client: load the copy `@skiffr/orpc/errors` itself checks against.
const { ORPCError } = (await import(
  Bun.resolveSync("@orpc/client", Bun.resolveSync("@skiffr/orpc/errors", import.meta.dir).replace(/\/[^/]*$/, ""))
)) as { ORPCError: new (code: string, options: { message: string }) => Error }
const { default: NotFound } = await import("./not-found")
const { default: UsersPage } = await import("./(app)/users/page")

let root: Root
let host: HTMLElement

beforeEach(() => {
  api.fail = false
  api.me = { name: "Ana", email: "ana@test.dev", image: null, role: null }
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const show = async (node: Promise<React.ReactNode>) => {
  const element = await node
  await act(async () => root.render(element))
}

test("an unknown url keeps the shell for a signed in user and is a plain branded page otherwise", async () => {
  await show(NotFound())
  expect(host.querySelectorAll("main#main")).toHaveLength(1)
  expect(host.querySelector('nav[aria-label="Main"]')).not.toBeNull()
  expect(host.textContent).toContain("This page does not exist")

  act(() => root.unmount())
  root = createRoot(host)
  api.fail = true
  await show(NotFound())
  expect(host.querySelector('nav[aria-label="Main"]')).toBeNull()
  expect(host.querySelectorAll("main#main")).toHaveLength(1)
  expect(host.textContent).toContain("Go to Today")
})

test("a non admin opening the users page gets a 404, any other failure still surfaces", async () => {
  api.users = () => Promise.reject(new ORPCError("FORBIDDEN", { message: "Admins only." }))
  await expect(UsersPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" })
  api.users = () => Promise.reject(new Error("db down"))
  await expect(UsersPage()).rejects.toThrow("db down")
})

test("an admin gets the table under an Admin / Users breadcrumb", async () => {
  const ana = { id: "a", name: "Ana", email: "ana@test.dev", role: "admin", emailVerified: true, banned: false }
  api.users = () => Promise.resolve({ total: 1, users: [{ ...ana, createdAt: new Date(0) }] })
  await show(UsersPage())
  expect(host.querySelectorAll("h1")).toHaveLength(1)
  expect(host.querySelector("nav[aria-label=breadcrumb]")?.textContent).toBe("AdminUsers")
  expect(host.querySelectorAll("tbody tr")).toHaveLength(1)
})
