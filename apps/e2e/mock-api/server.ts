import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import {
  type ApplicantProfile,
  applicantProfileSchema,
  type DraftAnswerResult,
  draftAnswerInputSchema,
  draftAnswerOutputSchema,
  type FieldDescriptor,
  type FieldMapping,
  lookupInputSchema,
  lookupOutputSchema,
  mapFieldsInputSchema,
  mapFieldsOutputSchema,
  profileDataSchema,
  recordInputSchema,
  recordOutputSchema,
} from "@skiffr/common/schemas"
import type { z } from "zod"

export const MOCK_TOKEN = "skp_e2e_fake_token_not_a_secret"

export type MapFieldsHandler = (fields: FieldDescriptor[]) => FieldMapping[]

export type LookupMatch =
  | { fieldId: string; source: "none" }
  | {
      fieldId: string
      source: "site" | "exact" | "label" | "similar"
      value: string
      autofill: boolean
      answerId?: string
      score?: number
    }
export type LookupHandler = (input: { siteKey: string; fields: { id: string; label: string }[] }) => LookupMatch[]

export type RecordedBatch = z.output<typeof recordInputSchema>

/** What the extension reads of a queued job. The ids must be uuids: the extension checks them. */
export interface MockJob {
  id: string
  url: string
  canonicalId: string
  title: string
  company: string
}

export interface RecordedApplication {
  jobId: string
  ats: string
}

export interface RecordedRequest {
  method: string
  path: string
  authorization: string | undefined
  body: unknown
}

export interface MockApi {
  url: string
  /** Every request the extension made, in order. A test that must not touch the network asserts this is empty. */
  requests: RecordedRequest[]
  /** Batches `learning.record` accepted, in order. A repeat of a batch id with the same events is answered but not added. */
  records: RecordedBatch[]
  /** The queued jobs `jobs.list` answers with, oldest first. */
  setQueue: (jobs: MockJob[]) => void
  /** Make `jobs.list` fail with this status until reset, whatever else is asked. */
  failQueue: (status: number) => void
  /** Applications `applications.create` accepted, in order. Each one takes its job out of the queue. */
  applications: RecordedApplication[]
  /** Replace the canned `ai.mapFields` answer. */
  onMapFields: (handler: MapFieldsHandler) => void
  /** Replace the canned `learning.lookup` answer (no saved answers by default). */
  onLookup: (handler: LookupHandler) => void
  /** Make the next request fail with this status (oRPC error body), then go back to normal. */
  failNext: (status: number, code?: string) => void
  reset: () => void
  stop: () => Promise<void>
}

const PROFILE: ApplicantProfile = applicantProfileSchema.parse({
  id: "profile-e2e",
  data: profileDataSchema.parse({
    identity: { firstName: "Ana", lastName: "Silva", email: "ana.silva@example.com", phone: "+351 912 345 678" },
    links: { linkedin: "https://www.linkedin.com/in/ana-silva", github: "https://github.com/ana-silva" },
    location: { city: "Lisbon", country: "Portugal" },
  }),
  fields: {},
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
})

/** Field text to profile key, checked in order against label, name, aria label, placeholder and id. */
const KEY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/first.?name|given.?name|^firstname$/i, "identity.firstName"],
  [/last.?name|family.?name|surname|^lastname$/i, "identity.lastName"],
  [/e-?mail/i, "identity.email"],
  [/phone|mobile|tel/i, "identity.phone"],
  [/linkedin/i, "links.linkedin"],
  [/github/i, "links.github"],
  [/city|location|located/i, "location.city"],
]

function fieldText(field: FieldDescriptor): string {
  return [field.label, field.name, field.ariaLabel, field.placeholder, field.id].filter(Boolean).join(" ")
}

export const defaultMapFields: MapFieldsHandler = (fields) =>
  fields.map((field): FieldMapping => {
    const text = fieldText(field)
    const rule = field.type === "password" ? undefined : KEY_RULES.find(([pattern]) => pattern.test(text))
    if (!rule) return { id: field.id, action: "skip", confidence: 0.1, reason: "mock: no rule" }
    return { id: field.id, action: "profile", key: rule[1], confidence: 0.95, reason: "mock: matched rule" }
  })

const labelKey = (label: string): string => label.trim().toLowerCase()

const DRAFT: DraftAnswerResult = { ok: true, text: "Mock answer drafted from the profile." }

const recordedOutput = (input: RecordedBatch) =>
  recordOutputSchema.parse({
    recorded: input.events.length,
    skipped: 0,
    siteProfile: { status: "saved" },
    answers: { status: "saved", skipped: 0 },
  })

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString("utf8")
  return text ? JSON.parse(text) : undefined
}

function parseInput<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new HttpError(400, "BAD_REQUEST", parsed.error.message)
  return parsed.data
}

export async function startMockApi(): Promise<MockApi> {
  const requests: RecordedRequest[] = []
  let mapFields: MapFieldsHandler = defaultMapFields
  const records: RecordedBatch[] = []
  const batches = new Map<string, string>()
  /** What the person corrected to, by question: the answers a real server would learn. */
  const learned = new Map<string, string>()
  const fromLearned: LookupHandler = ({ fields }) =>
    fields.map(({ id, label }): LookupMatch => {
      const value = learned.get(labelKey(label))
      return value === undefined
        ? { fieldId: id, source: "none" }
        : { fieldId: id, source: "label", value, autofill: true }
    })
  let lookup: LookupHandler = fromLearned
  let failure: { status: number; code: string } | null = null
  let queue: MockJob[] = []
  let queueStatus: number | null = null
  const applications: RecordedApplication[] = []

  // oRPC's wire format: POST /rpc/<router>/<procedure> with `{ json: input }`, answered with `{ json: output }`
  const route = (method: string, path: string, body: unknown): unknown => {
    if (method === "POST" && path === "/rpc/extension/whoami") {
      return { user: { id: "user-e2e", name: "Ana Silva", email: "ana.silva@example.com" } }
    }
    if (method === "POST" && path === "/rpc/profile/get") return applicantProfileSchema.parse(PROFILE)
    if (method === "POST" && path === "/rpc/ai/mapFields") {
      const input = parseInput(mapFieldsInputSchema, body)
      return mapFieldsOutputSchema.parse({ mappings: mapFields(input.fields) })
    }
    if (method === "POST" && path === "/rpc/ai/draftAnswer") {
      parseInput(draftAnswerInputSchema, body)
      return draftAnswerOutputSchema.parse(DRAFT)
    }
    if (method === "POST" && path === "/rpc/learning/lookup") {
      const input = parseInput(lookupInputSchema, body)
      const matches = lookup(input).map((match) =>
        match.source === "none" ? match : { score: 1, timesUsed: 0, timesCorrected: 0, ...match },
      )
      return lookupOutputSchema.parse({ matches })
    }
    if (method === "POST" && path === "/rpc/learning/record") {
      const input = parseInput(recordInputSchema, body)
      const same = JSON.stringify(input)
      if (input.batchId) {
        const seen = batches.get(input.batchId)
        if (seen !== undefined && seen !== same) {
          throw new HttpError(409, "CONFLICT", "That batch id was already used for different events.")
        }
        batches.set(input.batchId, same)
        if (seen !== undefined) return recordedOutput(input)
      }
      records.push(input)
      for (const { label, filledValue, finalValue } of input.events) {
        if (finalValue && finalValue !== filledValue) learned.set(labelKey(label), finalValue)
      }
      return recordedOutput(input)
    }
    if (method === "POST" && path === "/rpc/jobs/list") {
      if (queueStatus !== null) throw new HttpError(queueStatus, "INTERNAL_SERVER_ERROR", "mock: queue down")
      return queue
    }
    if (method === "POST" && path === "/rpc/applications/create") {
      const input = body as RecordedApplication
      if (!queue.some((job) => job.id === input.jobId)) throw new HttpError(404, "NOT_FOUND", "Job not found.")
      applications.push({ jobId: input.jobId, ats: input.ats })
      queue = queue.filter((job) => job.id !== input.jobId)
      return { id: "application-e2e", jobId: input.jobId, ats: input.ats, status: "applied" }
    }
    throw new HttpError(404, "NOT_FOUND", `The mock api has no ${method} ${path}`)
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      res.setHeader("access-control-allow-origin", "*")
      res.setHeader("access-control-allow-headers", "authorization, content-type, x-csrf-token")
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
      if (req.method === "OPTIONS") return void res.writeHead(204).end()
      try {
        const method = req.method ?? "GET"
        const path = new URL(req.url ?? "/", "http://mock.local").pathname
        const body = ((await readJson(req)) as { json?: unknown } | undefined)?.json
        const authorization = req.headers.authorization
        requests.push({ method, path, authorization, body })
        if (failure) {
          const { status, code } = failure
          failure = null
          throw new HttpError(status, code, "mock: forced failure")
        }
        if (authorization !== `Bearer ${MOCK_TOKEN}`) throw new HttpError(401, "UNAUTHORIZED", "Invalid token")
        send(res, 200, { json: route(method, path, body), meta: [] })
      } catch (error) {
        const failed = error instanceof HttpError ? error : new HttpError(500, "INTERNAL_SERVER_ERROR", String(error))
        send(res, failed.status, {
          json: { defined: false, code: failed.code, status: failed.status, message: failed.message },
          meta: [],
        })
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    records,
    applications,
    setQueue: (jobs) => {
      queue = jobs
    },
    failQueue: (status) => {
      queueStatus = status
    },
    onMapFields: (handler) => {
      mapFields = handler
    },
    onLookup: (handler) => {
      lookup = handler
    },
    failNext: (status, code = "INTERNAL_SERVER_ERROR") => {
      failure = { status, code }
    },
    reset: () => {
      requests.length = 0
      mapFields = defaultMapFields
      lookup = fromLearned
      records.length = 0
      applications.length = 0
      queue = []
      queueStatus = null
      batches.clear()
      learned.clear()
      failure = null
    },
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
