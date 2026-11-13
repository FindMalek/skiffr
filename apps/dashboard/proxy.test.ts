import { expect, test } from "bun:test"
import { NextRequest } from "next/server"
import { isFilePath, proxy } from "./proxy"

const request = (path: string, session = false) => {
  const req = new NextRequest(`http://localhost:3002${path}`)
  if (session) req.cookies.set("better-auth.session_token", "x")
  return req
}

test("a path that looks like a file answers 404 at once, signed in or not, and a page never does", () => {
  for (const path of ["/favicon.ico", "/x.png", "/file.txt", "/.env", "/a/b/missing.js"]) {
    expect(isFilePath(path)).toBe(true)
    expect(proxy(request(path)).status).toBe(404)
    expect(proxy(request(path, true)).status).toBe(404)
  }
  for (const path of ["/", "/queue", "/settings/gmail", "/nope/deep/link", "/queue/v1.2/x"]) {
    expect(isFilePath(path)).toBe(false)
  }
})

test("without a session cookie a page goes to sign in, with one it goes on", () => {
  const anon = proxy(request("/queue"))
  expect(anon.status).toBe(307)
  expect(anon.headers.get("location")).toBe("http://localhost:3002/sign-in")
  const signedIn = proxy(request("/queue", true))
  expect(signedIn.status).toBe(200)
  expect(signedIn.headers.get("location")).toBeNull()
})
