import { CV_RESUMES_MAX } from "@skiffr/common/constants"
import { FetchError } from "../watch/errors"
import { fetchPage, type GuardDeps } from "../watch/guard"
import { HostGate, type UserBudget } from "../watch/limits"
import { CvError } from "./errors"
import type { PatchOp } from "./json-patch"
import { assertResumeOps } from "./patch"
import { ID, parseResume, type RrResume } from "./resume"

/** The api key is sealed with this key (`CV_ENCRYPTION_KEY`); the network and the limits are the watcher's guard. */
export interface CvRuntime {
  key: Buffer
  guard: GuardDeps
  /** Tailoring runs a user may start per window: each one is a model call. */
  budget: UserBudget
  /** Copies a user may make per window. */
  copies: UserBudget
  /** Every other call to an instance a user may start per window. */
  calls: UserBudget
  /** One gate per user, so one user's calls to an instance never queue up another's. */
  gapMs: number
  gates: Map<string, HostGate>
}

const GATES_MAX = 5_000

function gateOf(runtime: CvRuntime, userId: string): HostGate {
  let gate = runtime.gates.get(userId)
  if (!gate) {
    if (runtime.gates.size >= GATES_MAX) runtime.gates.clear()
    gate = new HostGate(runtime.gapMs)
    runtime.gates.set(userId, gate)
  }
  return gate
}

export const PDF_BYTES_MAX = 8 * 1024 * 1024
const COPY_TAG = "skiffr"
const PREFIX = "/api/openapi/resumes"

export interface RrConnection {
  baseUrl: string
  apiKey: string
}

export interface ResumeListing {
  id: string
  name: string
  updatedAt: string
}

function failure(error: unknown, write: boolean): CvError {
  if (error instanceof CvError) return error
  if (!(error instanceof FetchError)) return new CvError("network")
  const { status } = error
  if (status === 401) return new CvError("auth", status)
  if (status === 403) return new CvError(write ? "forbidden" : "auth", status)
  if (status === 409) return new CvError("conflict", status)
  if (status === 400 || status === 422) return new CvError("bad_request", status)
  switch (error.kind) {
    case "blocked":
    case "dns":
      return new CvError("blocked")
    case "not_found":
      return new CvError("not_found", status)
    case "rate_limited":
      return new CvError("rate_limited", status)
    case "too_large":
      return new CvError("too_large", status)
    case "timeout":
    case "network":
      return new CvError("network", status)
    default:
      return new CvError("upstream", status)
  }
}

function json(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new CvError("upstream")
  }
}

/** A client for one user's Reactive Resume. Every call goes through the guard: https only, public addresses only, no redirect followed, response size capped. */
export function reactiveResume(runtime: CvRuntime, connection: RrConnection, userId: string) {
  const headers = { "x-api-key": connection.apiKey }

  async function send(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    options: { body?: unknown; accept?: string; media?: readonly string[]; slow?: boolean } = {},
  ) {
    const guard: GuardDeps = {
      ...runtime.guard,
      gate: gateOf(runtime, userId),
      // A pdf is rendered on demand, so it may take a while to start and is bigger than json.
      ...(options.slow
        ? { limits: { ...runtime.guard.limits, maxBytes: PDF_BYTES_MAX, idleMs: 30_000, totalMs: 60_000 } }
        : {}),
    }
    try {
      const page = await fetchPage(guard, {
        url: `${connection.baseUrl}${PREFIX}${path}`,
        accept: options.accept ?? "application/json",
        call: { method, headers, json: options.body, media: options.media },
      })
      if (page.status !== "ok") throw new CvError("upstream")
      return page
    } catch (error) {
      throw failure(error, method !== "GET")
    }
  }

  const idOf = (value: unknown): string => {
    const id = typeof value === "string" ? value : (value as { id?: unknown } | null)?.id
    if (typeof id !== "string" || !ID.test(id)) throw new CvError("upstream")
    return id
  }
  const pathOf = (id: string) => `/${encodeURIComponent(idOf(id))}`

  return {
    async list(): Promise<ResumeListing[]> {
      const body = json((await send("GET", "")).body)
      if (!Array.isArray(body)) throw new CvError("upstream")
      return body
        .slice(0, CV_RESUMES_MAX)
        .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
        .filter((row) => typeof row.id === "string" && ID.test(row.id) && typeof row.name === "string")
        .map((row) => ({ id: row.id as string, name: row.name as string, updatedAt: String(row.updatedAt ?? "") }))
    },

    async get(id: string): Promise<RrResume> {
      return parseResume(json((await send("GET", pathOf(id))).body))
    },

    /** A copy of the resume under a new name. The newer `copies` endpoint first, the older `duplicate` where an instance lacks it. */
    async copy(id: string, name: string): Promise<string> {
      const body = { name, tags: [COPY_TAG] }
      try {
        return idOf(json((await send("POST", `${pathOf(id)}/copies`, { body })).body))
      } catch (error) {
        if (!(error instanceof CvError) || (error.status !== 404 && error.status !== 405)) throw error
        return idOf(json((await send("POST", `${pathOf(id)}/duplicate`, { body })).body))
      }
    },

    async patch(id: string, operations: readonly PatchOp[], expectedUpdatedAt: string): Promise<void> {
      assertResumeOps(operations)
      await send("PATCH", pathOf(id), { body: { operations, expectedUpdatedAt } })
    },

    /** Moves a resume to the trash. Only ever used on a copy skiffr has just made and could not finish. */
    async trash(id: string): Promise<void> {
      await send("DELETE", pathOf(id), { media: [""] })
    },

    async pdf(id: string): Promise<Buffer> {
      const page = await send("GET", `${pathOf(id)}/pdf`, {
        accept: "application/pdf",
        media: ["application/pdf"],
        slow: true,
      })
      if (page.raw.subarray(0, 5).toString("latin1") !== "%PDF-") throw new CvError("upstream")
      return page.raw
    },
  }
}
