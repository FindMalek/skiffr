import http from "node:http"
import type net from "node:net"
import type { AddressInfo } from "node:net"
import { UserBudget } from "../watch/limits"
import { testTransport } from "../watch/test-support"
import type { CvRuntime } from "./client"
import { applyOps, type PatchOp } from "./json-patch"

export const API_KEY = "rr-test-key-0123456789abcdef"
export const RR_URL = "https://rr.test"
export const CV_KEY = Buffer.alloc(32, 7)

type Json = Record<string, unknown>

export interface MockResume {
  id: string
  name: string
  slug: string
  tags: string[]
  isLocked: boolean
  updatedAt: string
  data: Json
}

export interface MockRr {
  port: number
  resumes: Map<string, MockResume>
  /** Method, path and the key header of every call that arrived, in order. */
  hits: Array<{ call: string; key: string | undefined }>
  /** Bodies of the patch calls. */
  patches: Array<{ id: string; operations: PatchOp[]; expectedUpdatedAt: string }>
  options: { readOnly: boolean; noCopies: boolean; failPatch: boolean; failDelete: boolean }
  close(): Promise<void>
}

const item = (extra: Json) => ({ id: crypto.randomUUID(), hidden: false, ...extra })
const li = (text: string) => `<li><p>${text}</p></li>`

export const BULLETS = {
  acme: [
    "Built the billing API in TypeScript and PostgreSQL, serving 2M requests a day.",
    "Cut deploy time from 40 minutes to 8 with Docker and GitHub Actions.",
    "Mentored two junior engineers.",
  ],
  globex: ["Wrote Go services on Kafka for order events.", "Migrated a monolith to services."],
} as const

/** The part of a Reactive Resume document skiffr reads and changes. */
export function sampleData(): Json {
  return {
    picture: { hidden: true },
    basics: { name: "Ana Silva", headline: "Backend Engineer", email: "ana@example.test" },
    summary: {
      title: "",
      hidden: false,
      content: "<p>Backend engineer with 6 years building payment APIs in TypeScript and Go.</p>",
    },
    sections: {
      skills: {
        title: "",
        hidden: false,
        items: [
          item({ name: "Languages", keywords: ["TypeScript", "Go", "SQL"], level: 0, proficiency: "", icon: "" }),
          item({
            name: "Infrastructure",
            keywords: ["PostgreSQL", "Docker", "AWS", "Kafka"],
            level: 0,
            proficiency: "",
            icon: "",
          }),
        ],
      },
      experience: {
        title: "",
        hidden: false,
        items: [
          item({
            company: "Acme Labs",
            position: "Senior Software Engineer",
            location: "Lisbon",
            period: "2021 - Present",
            description: `<ul>${BULLETS.acme.map(li).join("")}</ul>`,
            roles: [],
          }),
          item({
            company: "Globex",
            position: "Backend Developer",
            location: "Porto",
            period: "2018 - 2021",
            description: `<ul>${BULLETS.globex.map(li).join("")}</ul>`,
            roles: [],
          }),
          item({
            hidden: true,
            company: "Secret Corp",
            position: "Principal Wizard",
            period: "2012 - 2014",
            description: `<ul>${li("Led a team of 40 engineers.")}</ul>`,
            roles: [],
          }),
        ],
      },
      education: {
        title: "",
        hidden: false,
        items: [
          item({ school: "University of Lisbon", degree: "BSc", area: "Computer Science", period: "2014 - 2018" }),
        ],
      },
      interests: { title: "", hidden: false, items: [item({ name: "Chess", keywords: ["Chess"] })] },
      references: { title: "", hidden: true, items: [item({ name: "Priya Private", description: "+351 555 0100" })] },
    },
    customSections: [
      {
        id: "c1",
        type: "cover-letter",
        title: "Letter",
        hidden: false,
        items: [{ id: "c1i", hidden: false, content: "<p>Dear Hiring Manager at Umbrella</p>" }],
      },
    ],
    metadata: { template: "azurill" },
  }
}

let counter = 0
const stamp = () => new Date(Date.UTC(2026, 10, 1, 0, 0, ++counter)).toISOString()

export function sampleResume(id: string, name: string): MockResume {
  return { id, name, slug: id, tags: [], isLocked: false, updatedAt: stamp(), data: sampleData() }
}

export async function startMockRr(resumes: MockResume[] = [sampleResume("base-1", "Master CV")]): Promise<MockRr> {
  const store = new Map(resumes.map((resume) => [resume.id, resume]))
  const hits: MockRr["hits"] = []
  const patches: MockRr["patches"] = []
  const options = { readOnly: false, noCopies: false, failPatch: false, failDelete: false }
  const sockets = new Set<net.Socket>()

  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const body = chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString()) as Json) : {}
    const key = request.headers["x-api-key"]
    const path = (request.url ?? "").split("?")[0] ?? ""
    hits.push({ call: `${request.method} ${path}`, key: typeof key === "string" ? key : undefined })
    const send = (status: number, value: unknown, type = "application/json") => {
      response.statusCode = status
      response.setHeader("content-type", type)
      response.end(type === "application/json" ? JSON.stringify(value) : (value as string))
    }
    if (key !== API_KEY) return send(401, { code: "UNAUTHORIZED" })
    const match = /^\/api\/openapi\/resumes(?:\/([^/]+))?(?:\/(copies|duplicate|pdf))?$/.exec(path)
    if (!match) return send(404, { code: "NOT_FOUND" })
    const [, id, action] = match
    const resume = id ? store.get(id) : undefined
    const writing = request.method !== "GET"

    if (!id) {
      if (request.method !== "GET") return send(405, {})
      return send(
        200,
        [...store.values()].map(({ data: _data, ...rest }) => rest),
      )
    }
    if (!resume) return send(404, { code: "NOT_FOUND" })
    if (writing && options.readOnly) return send(403, { code: "FORBIDDEN" })

    if (request.method === "GET" && !action) return send(200, resume)
    if (request.method === "GET" && action === "pdf")
      return send(200, "%PDF-1.4\nmock resume\n%%EOF", "application/pdf")
    if (request.method === "POST" && (action === "copies" || action === "duplicate")) {
      if (options.noCopies && action === "copies") return send(404, { code: "NOT_FOUND" })
      const copyId = `copy-${store.size + 1}`
      store.set(copyId, {
        ...structuredClone(resume),
        id: copyId,
        name: String(body.name ?? `${resume.name} (copy)`),
        slug: copyId,
        tags: (body.tags as string[]) ?? [],
        updatedAt: stamp(),
      })
      return send(200, copyId)
    }
    if (request.method === "DELETE" && !action) {
      if (options.failDelete) return send(500, {})
      store.delete(resume.id)
      return send(200, null)
    }
    if (request.method === "PATCH" && !action) {
      if (options.failPatch) return send(500, { code: "BOOM" })
      const operations = body.operations as PatchOp[]
      patches.push({ id: resume.id, operations, expectedUpdatedAt: String(body.expectedUpdatedAt) })
      if (body.expectedUpdatedAt !== resume.updatedAt) return send(409, { code: "CONFLICT" })
      try {
        resume.data = applyOps(resume.data, operations) as Json
      } catch {
        return send(400, { code: "BAD_REQUEST" })
      }
      resume.updatedAt = stamp()
      return send(200, resume)
    }
    return send(405, {})
  })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    port: (server.address() as AddressInfo).port,
    resumes: store,
    hits,
    patches,
    options,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      }),
  }
}

/** The mock stands in for `rr.test`, a name that resolves to a public address so the real checks run on it. */
export function mockCvRuntime(
  rr: Pick<MockRr, "port">,
  options: { tailorsPerHour?: number; copiesPerHour?: number; callsPerHour?: number; gapMs?: number } = {},
): CvRuntime {
  const hour = 60 * 60 * 1000
  return {
    key: CV_KEY,
    guard: { transport: testTransport(rr) },
    budget: new UserBudget(options.tailorsPerHour ?? 1_000, hour),
    copies: new UserBudget(options.copiesPerHour ?? 1_000, hour),
    calls: new UserBudget(options.callsPerHour ?? 1_000, hour),
    gapMs: options.gapMs ?? 0,
    gates: new Map(),
  }
}
