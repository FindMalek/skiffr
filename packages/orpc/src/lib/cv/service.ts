import { type AiProfile, profileFacts, tailorResume } from "@skiffr/ai"
import type { CvAts, CvOperation } from "@skiffr/common/schemas"
import { cvConnection, type Db, profile } from "@skiffr/db"
import type { LanguageModel } from "ai"
import { eq } from "drizzle-orm"
import { open, seal } from "../gmail/crypto"
import { atsScore } from "./ats"
import { type CvRuntime, type RrConnection, reactiveResume } from "./client"
import { CvError } from "./errors"
import { buildSource, type Evaluation, evaluatePatch, patched } from "./patch"
import { buildView, modelView, resumeTexts, visibleTexts } from "./resume"
import { squash } from "./text"

export interface Opened extends RrConnection {
  baseResumeId: string | null
}

const last4 = (key: string) => key.slice(-4)

export async function openConnection(db: Db, runtime: CvRuntime, userId: string): Promise<Opened> {
  const [row] = await db.select().from(cvConnection).where(eq(cvConnection.userId, userId))
  if (!row) throw new CvError("not_connected")
  return { baseUrl: row.baseUrl, apiKey: open(runtime.key, row.apiKeyEnc, userId), baseResumeId: row.baseResumeId }
}

/** Calls the instance once with the key (listing resumes), and stores the key sealed only if that works. A new key forgets the base resume: ids differ per account. */
export async function connect(
  db: Db,
  runtime: CvRuntime,
  userId: string,
  input: RrConnection,
  now: Date,
): Promise<void> {
  await reactiveResume(runtime, input).list()
  const values = {
    baseUrl: input.baseUrl,
    apiKeyEnc: seal(runtime.key, input.apiKey, userId),
    keyLast4: last4(input.apiKey),
    baseResumeId: null,
    baseResumeName: null,
    updatedAt: now,
  }
  await db
    .insert(cvConnection)
    .values({ ...values, userId })
    .onConflictDoUpdate({ target: cvConnection.userId, set: values })
}

export async function testConnection(db: Db, runtime: CvRuntime, userId: string): Promise<number> {
  const connection = await openConnection(db, runtime, userId)
  return (await reactiveResume(runtime, connection).list()).length
}

export async function setBaseResume(db: Db, runtime: CvRuntime, userId: string, resumeId: string, now: Date) {
  const connection = await openConnection(db, runtime, userId)
  const found = (await reactiveResume(runtime, connection).list()).find((resume) => resume.id === resumeId)
  if (!found) throw new CvError("not_found")
  await db
    .update(cvConnection)
    .set({ baseResumeId: found.id, baseResumeName: found.name, updatedAt: now })
    .where(eq(cvConnection.userId, userId))
}

export const copyNameOf = (company: string, title: string): string =>
  squash(`${company} - ${title}`.replace(/[\p{Cc}\p{Cf}]/gu, " ")).slice(0, 100) || "Tailored resume"

interface Request {
  db: Db
  runtime: CvRuntime
  userId: string
  job: { company: string; title: string }
  description: string
}

type Propose = (context: {
  resume: ReturnType<typeof modelView>
  profile?: AiProfile
}) => Promise<readonly unknown[]> | readonly unknown[]

async function evaluate(request: Request, propose: Propose) {
  const connection = await openConnection(request.db, request.runtime, request.userId)
  if (!connection.baseResumeId) throw new CvError("no_base")
  const client = reactiveResume(request.runtime, connection)
  const base = await client.get(connection.baseResumeId)
  const view = buildView(base.data)
  const [row] = await request.db.select().from(profile).where(eq(profile.userId, request.userId))
  const facts = row ? profileFacts(row) : []
  const source = buildSource([...resumeTexts(base.data), ...facts])
  const proposed = await propose({ resume: modelView(view), profile: row })
  const evaluation = evaluatePatch({ data: base.data, view, operations: proposed, source })
  const data = patched(base.data, evaluation.resumeOps)
  return {
    client,
    connection,
    base,
    evaluation,
    before: atsScore(visibleTexts(base.data), request.description),
    after: atsScore(visibleTexts(data), request.description),
  }
}

export interface Preview {
  baseUpdatedAt: string
  copyName: string
  evaluation: Evaluation
  before: CvAts
  after: CvAts
}

export async function preview(request: Request & { model: LanguageModel }): Promise<Preview> {
  const result = await evaluate(request, ({ resume, profile }) =>
    tailorResume({ model: request.model, resume, profile, job: { ...request.job, description: request.description } }),
  )
  return {
    baseUpdatedAt: result.base.updatedAt,
    copyName: copyNameOf(request.job.company, request.job.title),
    evaluation: result.evaluation,
    before: result.before,
    after: result.after,
  }
}

export async function apply(
  request: Request & { operations: readonly CvOperation[]; baseUpdatedAt: string },
): Promise<Preview & { resume: { id: string; name: string; url: string } }> {
  const result = await evaluate(request, () => request.operations)
  if (result.base.updatedAt !== request.baseUpdatedAt) throw new CvError("conflict")
  if (result.evaluation.resumeOps.length === 0) throw new CvError("bad_request")
  const name = copyNameOf(request.job.company, request.job.title)
  const id = await result.client.copy(result.base.id, name)
  const copy = await result.client.get(id)
  await result.client.patch(copy.id, result.evaluation.resumeOps, copy.updatedAt)
  return {
    baseUpdatedAt: result.base.updatedAt,
    copyName: name,
    evaluation: result.evaluation,
    before: result.before,
    after: result.after,
    resume: { id: copy.id, name, url: `${result.connection.baseUrl}/builder/${encodeURIComponent(copy.id)}` },
  }
}
