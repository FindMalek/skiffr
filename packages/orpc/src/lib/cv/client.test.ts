import { afterEach, expect, test } from "bun:test"
import { fetchPage } from "../watch/guard"
import { type MockSite, startMockSite, testTransport } from "../watch/test-support"
import { reactiveResume } from "./client"
import { CvError } from "./errors"
import { API_KEY, mockCvRuntime, RR_URL, startMockRr } from "./test-support"

let site: MockSite | null = null
afterEach(async () => {
  await site?.close()
  site = null
})

const connection = { baseUrl: RR_URL, apiKey: API_KEY }

test("a redirect is not followed, so the key never goes to the host it points at", async () => {
  site = await startMockSite()
  site.route("/api/openapi/resumes", (_request, response) => {
    response.statusCode = 302
    response.setHeader("location", "https://elsewhere.test/steal")
    response.end()
  })
  const runtime = mockCvRuntime(site)
  await expect(reactiveResume(runtime, connection, "ana").list()).rejects.toMatchObject({ kind: "upstream" })
  expect(site.hits).toEqual(["GET /api/openapi/resumes"])
})

test("addresses that are not public https sites are never called", async () => {
  const rr = await startMockRr()
  try {
    for (const baseUrl of [
      "https://localhost",
      "https://127.0.0.1",
      "https://169.254.169.254",
      "https://10.0.0.5",
      "https://rr.internal",
    ]) {
      await expect(
        reactiveResume(mockCvRuntime(rr), { baseUrl, apiKey: API_KEY }, "ana").list(),
        baseUrl,
      ).rejects.toMatchObject({
        kind: "blocked",
      })
    }
    expect(rr.hits).toEqual([])
  } finally {
    await rr.close()
  }
})

test("the key goes in a header, a wrong key is an auth error and a read only key can't write", async () => {
  const rr = await startMockRr()
  try {
    const runtime = mockCvRuntime(rr)
    await expect(
      reactiveResume(runtime, { ...connection, apiKey: "wrong-key-wrong-key" }, "ana").list(),
    ).rejects.toMatchObject({
      kind: "auth",
    })
    expect(await reactiveResume(runtime, connection, "ana").list()).toEqual([
      { id: "base-1", name: "Master CV", updatedAt: expect.any(String) },
    ])
    expect(rr.hits.map((hit) => hit.key)).toEqual(["wrong-key-wrong-key", API_KEY])

    rr.options.readOnly = true
    await expect(reactiveResume(runtime, connection, "ana").copy("base-1", "x")).rejects.toMatchObject({
      kind: "forbidden",
    })
  } finally {
    await rr.close()
  }
})

test("an instance without the copies endpoint is asked to duplicate instead, and a pdf is checked before it is returned", async () => {
  const rr = await startMockRr()
  try {
    rr.options.noCopies = true
    const client = reactiveResume(mockCvRuntime(rr), connection, "ana")
    const id = await client.copy("base-1", "Acme - Engineer")
    expect(rr.hits.map((hit) => hit.call)).toEqual([
      "POST /api/openapi/resumes/base-1/copies",
      "POST /api/openapi/resumes/base-1/duplicate",
    ])
    expect((await client.pdf(id)).subarray(0, 5).toString()).toBe("%PDF-")
  } finally {
    await rr.close()
  }
})

test("a patch outside the allowlist is refused before any call", async () => {
  const rr = await startMockRr()
  try {
    const client = reactiveResume(mockCvRuntime(rr), connection, "ana")
    await expect(
      client.patch("base-1", [{ op: "replace", path: "/basics/name", value: "x" }], "t"),
    ).rejects.toBeInstanceOf(CvError)
    await expect(
      client.patch("base-1", [{ op: "replace", path: "/metadata/template", value: "x" }], "t"),
    ).rejects.toBeInstanceOf(CvError)
    expect(rr.hits).toEqual([])
  } finally {
    await rr.close()
  }
})

test("a delete is only ever one resume by id: the guard refuses any other path, and a hostile id never leaves the client", async () => {
  const rr = await startMockRr()
  try {
    const runtime = mockCvRuntime(rr)
    const call = (path: string) =>
      fetchPage(
        { transport: testTransport(rr) },
        {
          url: `${RR_URL}${path}`,
          accept: "application/json",
          call: { method: "DELETE", headers: { "x-api-key": API_KEY }, media: [""] },
        },
      )
    for (const path of [
      "/api/openapi/resumes",
      "/api/openapi/resumes/",
      "/api/openapi/resumes/base-1/pdf",
      "/api/openapi/resumes/base-1?all=1",
      "/api/openapi/resumes/base-1#x",
      "/api/openapi/other/base-1",
      "/api/openapi/resumes/%2e%2e/x",
    ]) {
      await expect(call(path), path).rejects.toMatchObject({ kind: "blocked" })
    }
    expect(rr.hits).toEqual([])

    const client = reactiveResume(runtime, connection, "ana")
    for (const id of ["../base-1", "a/b", "base-1/pdf", "..", "x".repeat(101), "a b"]) {
      await expect(client.trash(id), id).rejects.toBeInstanceOf(CvError)
    }
    expect(rr.hits).toEqual([])

    await client.trash("base-1")
    expect(rr.hits.map((hit) => hit.call)).toEqual(["DELETE /api/openapi/resumes/base-1"])
  } finally {
    await rr.close()
  }
})
