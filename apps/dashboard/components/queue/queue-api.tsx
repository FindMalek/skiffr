"use client"

import type { Job } from "@skiffr/common/schemas"
import { atsFromCanonicalId } from "@skiffr/common/utils"
import { browserClient } from "@skiffr/orpc/react"
import { createContext, useContext } from "react"

export type JobInput = { url: string; title: string; company: string }

/** Everything the queue page sends to the api. A context so the page can be driven with a fake in tests. */
export type QueueApi = {
  create(input: JobInput): Promise<Job & { created: boolean }>
  setStatus(ids: readonly string[], status: "queued" | "skipped"): Promise<unknown>
  remove(ids: readonly string[]): Promise<unknown>
  markApplied(job: Job): Promise<unknown>
  /** The server's oldest queued job right now, never a cached one. */
  next(): Promise<Job | null>
}

export const orpcQueueApi: QueueApi = {
  create: (input) => browserClient.jobs.create({ ...input, source: "manual" }),
  setStatus: (ids, status) =>
    ids.length === 1
      ? browserClient.jobs.update({ id: ids[0]!, status })
      : browserClient.jobs.bulkUpdate({ ids: [...ids], status }),
  remove: (ids) =>
    ids.length === 1 ? browserClient.jobs.remove({ id: ids[0]! }) : browserClient.jobs.bulkRemove({ ids: [...ids] }),
  next: () => browserClient.jobs.next(),
  markApplied: (job) => browserClient.applications.create({ jobId: job.id, ats: atsFromCanonicalId(job.canonicalId) }),
}

const QueueApiContext = createContext<QueueApi>(orpcQueueApi)

export const QueueApiProvider = QueueApiContext.Provider
export const useQueueApi = () => useContext(QueueApiContext)
