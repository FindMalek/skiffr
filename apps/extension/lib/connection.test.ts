import { expect, test } from "bun:test"
import { CONNECTION_TEXT, testConnection } from "./connection"

const settings = { apiUrl: "http://localhost:3001", token: "skp_abc" }
const load = async () => settings

const reply = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const orpcError = (code: string, status: number) =>
  reply(status, { json: { defined: false, code, status, message: code } })

test("the api's answer to whoami becomes the message the options page shows", async () => {
  const seen: Request[] = []
  const ok = async (request: Request) => {
    seen.push(request)
    return reply(200, { json: { user: { name: "Ana", email: "ana@test.dev" }, token: null } })()
  }
  expect(await testConnection(load, ok as never)).toEqual({ ok: true, name: "Ana" })
  expect(seen[0]?.headers.get("authorization")).toBe("Bearer skp_abc")

  const failure = async (fetch: () => Promise<Response>) => {
    const result = await testConnection(load, fetch as never)
    return result.ok ? "connected" : CONNECTION_TEXT[result.reason]
  }
  expect(await failure(orpcError("UNAUTHORIZED", 401))).toBe(CONNECTION_TEXT.rejected)
  expect(await failure(orpcError("SERVICE_UNAVAILABLE", 503))).toBe(CONNECTION_TEXT.unavailable)
  expect(await failure(async () => Promise.reject(new TypeError("fetch failed")))).toBe(CONNECTION_TEXT.unreachable)
  expect(await testConnection(async () => ({ ...settings, token: "" }))).toEqual({ ok: false, reason: "missing-token" })
})
