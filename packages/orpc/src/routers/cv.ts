import { ORPCError } from "@orpc/server"
import { CV_DEFAULT_URL } from "@skiffr/common/constants"
import {
  cvApplyInputSchema,
  cvApplySchema,
  cvConnectInputSchema,
  cvPdfInputSchema,
  cvPdfSchema,
  cvPreviewInputSchema,
  cvPreviewSchema,
  cvResumesSchema,
  cvSetBaseInputSchema,
  cvStatusSchema,
  cvTestSchema,
  okSchema,
} from "@skiffr/common/schemas"
import { cvConnection, job } from "@skiffr/db"
import { eq } from "drizzle-orm"
import type { Context } from "../context"
import { reactiveResume } from "../lib/cv/client"
import { CvError, type CvErrorKind, logCvFailure } from "../lib/cv/errors"
import { patchTooLarge } from "../lib/cv/patch"
import { apply, connect, openConnection, preview, setBaseResume, testConnection } from "../lib/cv/service"
import { CryptoError } from "../lib/gmail/crypto"
import { mine, orNotFound } from "../lib/owned"
import type { UserBudget } from "../lib/watch/limits"
import { protectedProcedure } from "../procedures"
import { guarded } from "./ai"

/** Everything here is session only: `cv` is not on `TOKEN_PROCEDURES`, so a leaked extension token can't reach a Reactive Resume key or tailor anything. */
const FAILURES: Record<CvErrorKind, [ConstructorParameters<typeof ORPCError>[0], string]> = {
  auth: ["PRECONDITION_FAILED", "Reactive Resume rejected the API key. Connect again in settings."],
  forbidden: ["PRECONDITION_FAILED", "That API key can't change resumes. Create one with write access."],
  not_found: ["NOT_FOUND", "That resume was not found. Pick the base resume again in settings."],
  conflict: ["CONFLICT", "The resume changed in the meantime. Preview the changes again."],
  rate_limited: [
    "TOO_MANY_REQUESTS",
    "Too many tailoring runs or Reactive Resume asked to slow down. Try again later.",
  ],
  upstream: ["BAD_GATEWAY", "Reactive Resume answered with an error. Try again."],
  network: ["BAD_GATEWAY", "Reactive Resume could not be reached. Check the address and try again."],
  too_large: ["BAD_GATEWAY", "Reactive Resume answered with more data than skiffr reads."],
  blocked: ["BAD_REQUEST", "That address is not a public https site, so skiffr will not call it."],
  invalid_resume: ["BAD_REQUEST", "That resume is in a format skiffr can't read."],
  bad_request: ["BAD_REQUEST", "Nothing could be applied from that request."],
  not_connected: ["PRECONDITION_FAILED", "Connect Reactive Resume in settings first."],
  no_base: ["PRECONDITION_FAILED", "Pick a base resume in settings first."],
}

async function guard<T>(route: string, run: () => Promise<T>): Promise<T> {
  try {
    return await guarded(route, run)
  } catch (error) {
    if (error instanceof CryptoError) {
      throw new ORPCError("PRECONDITION_FAILED", {
        message: "The saved API key can't be read. Connect again in settings.",
      })
    }
    if (!(error instanceof CvError)) throw error
    logCvFailure(route, error)
    const [code, message] = FAILURES[error.kind]
    const left = error.leftover
      ? ` A copy named "${error.leftover}" was made and could not be removed: delete it in Reactive Resume.`
      : ""
    throw new ORPCError(code, { message: `${message}${left}` })
  }
}

function needCv(context: Context) {
  if (!context.cv)
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: "CV tailoring is not configured on this server." })
  return context.cv
}

/** Every call that reaches an instance is counted per user, so one account can't turn the api into a request cannon. */
function spend(budget: UserBudget, context: Context & { user: { id: string } }) {
  if (!budget.take(context.user.id, context.now())) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "Too many requests to Reactive Resume this hour. Try again later.",
    })
  }
}

async function jobOf(context: Context & { user: { id: string } }, id: string) {
  const [row] = await context.db
    .select({ company: job.company, title: job.title })
    .from(job)
    .where(mine(job, context.user.id, id))
  return orNotFound(row, "Job")
}

export const cvRouter = {
  status: protectedProcedure
    .route({
      method: "GET",
      path: "/cv",
      summary: "Whether Reactive Resume is connected and which resume is the base",
      tags: ["cv"],
    })
    .output(cvStatusSchema)
    .handler(async ({ context }) => {
      const [row] = await context.db
        .select({
          baseUrl: cvConnection.baseUrl,
          keyLast4: cvConnection.keyLast4,
          baseResumeId: cvConnection.baseResumeId,
          baseResumeName: cvConnection.baseResumeName,
        })
        .from(cvConnection)
        .where(eq(cvConnection.userId, context.user.id))
      return {
        configured: Boolean(context.cv),
        aiReady: Boolean(context.model),
        defaultUrl: CV_DEFAULT_URL,
        connected: Boolean(row),
        baseUrl: row?.baseUrl ?? null,
        keyLast4: row?.keyLast4 ?? null,
        baseResume: row?.baseResumeId && row.baseResumeName ? { id: row.baseResumeId, name: row.baseResumeName } : null,
      }
    }),

  connect: protectedProcedure
    .route({
      method: "POST",
      path: "/cv/connect",
      summary: "Save the Reactive Resume address and API key after a test call",
      tags: ["cv"],
    })
    .input(cvConnectInputSchema)
    .output(okSchema)
    .handler(async ({ context, input }) => {
      const runtime = needCv(context)
      spend(runtime.calls, context)
      await guard("cv.connect", () => connect(context.db, runtime, context.user.id, input, context.now()))
      return { ok: true as const }
    }),

  test: protectedProcedure
    .route({ method: "POST", path: "/cv/test", summary: "Call Reactive Resume with the saved key", tags: ["cv"] })
    .output(cvTestSchema)
    .handler(async ({ context }) => {
      const runtime = needCv(context)
      spend(runtime.calls, context)
      const resumes = await guard("cv.test", () => testConnection(context.db, runtime, context.user.id))
      return { ok: true as const, resumes }
    }),

  resumes: protectedProcedure
    .route({
      method: "GET",
      path: "/cv/resumes",
      summary: "The resumes in the connected Reactive Resume",
      tags: ["cv"],
    })
    .output(cvResumesSchema)
    .handler(async ({ context }) => {
      const runtime = needCv(context)
      spend(runtime.calls, context)
      return guard("cv.resumes", async () =>
        reactiveResume(runtime, await openConnection(context.db, runtime, context.user.id), context.user.id).list(),
      )
    }),

  setBase: protectedProcedure
    .route({ method: "PUT", path: "/cv/base", summary: "Pick the resume that is tailored", tags: ["cv"] })
    .input(cvSetBaseInputSchema)
    .output(okSchema)
    .handler(async ({ context, input }) => {
      const runtime = needCv(context)
      spend(runtime.calls, context)
      await guard("cv.setBase", () =>
        setBaseResume(context.db, runtime, context.user.id, input.resumeId, context.now()),
      )
      return { ok: true as const }
    }),

  disconnect: protectedProcedure
    .route({ method: "DELETE", path: "/cv", summary: "Forget the Reactive Resume address and key", tags: ["cv"] })
    .output(okSchema)
    .handler(async ({ context }) => {
      await context.db.delete(cvConnection).where(eq(cvConnection.userId, context.user.id))
      return { ok: true as const }
    }),

  preview: protectedProcedure
    .route({
      method: "POST",
      path: "/cv/preview",
      summary: "Propose changes that tailor the base resume to a job. Nothing is written",
      tags: ["cv"],
    })
    .input(cvPreviewInputSchema)
    .output(cvPreviewSchema)
    .handler(async ({ context, input }) => {
      const runtime = needCv(context)
      if (!context.model) throw new ORPCError("SERVICE_UNAVAILABLE", { message: "No AI provider key is configured." })
      const target = await jobOf(context, input.jobId)
      const model = context.model
      const result = await guard("cv.preview", () =>
        preview({
          db: context.db,
          runtime,
          model,
          userId: context.user.id,
          job: target,
          description: input.description,
          spend: () => runtime.budget.take(context.user.id, context.now()),
        }),
      )
      return {
        baseUpdatedAt: result.baseUpdatedAt,
        copyName: result.copyName,
        operations: result.evaluation.operations,
        changes: result.evaluation.changes,
        rejected: result.evaluation.rejected,
        before: result.before,
        after: result.after,
      }
    }),

  apply: protectedProcedure
    .route({
      method: "POST",
      path: "/cv/apply",
      summary: "Make a copy of the base resume with the previewed changes. The base resume is never changed",
      tags: ["cv"],
    })
    .input(cvApplyInputSchema)
    .output(cvApplySchema)
    .handler(async ({ context, input }) => {
      const runtime = needCv(context)
      if (patchTooLarge(input.operations)) throw new ORPCError("BAD_REQUEST", { message: "That patch is too large." })
      const target = await jobOf(context, input.jobId)
      const result = await guard("cv.apply", () =>
        apply({
          db: context.db,
          runtime,
          userId: context.user.id,
          job: target,
          description: input.description,
          operations: input.operations,
          baseUpdatedAt: input.baseUpdatedAt,
          spend: () => runtime.copies.take(context.user.id, context.now()),
        }),
      )
      return {
        resume: result.resume,
        changes: result.evaluation.changes,
        rejected: result.evaluation.rejected,
        before: result.before,
        after: result.after,
      }
    }),

  pdf: protectedProcedure
    .route({
      method: "POST",
      path: "/cv/pdf",
      summary: "The PDF export of a resume in the connected Reactive Resume",
      tags: ["cv"],
    })
    .input(cvPdfInputSchema)
    .output(cvPdfSchema)
    .handler(async ({ context, input }) => {
      const runtime = needCv(context)
      spend(runtime.calls, context)
      const pdf = await guard("cv.pdf", async () =>
        reactiveResume(runtime, await openConnection(context.db, runtime, context.user.id), context.user.id).pdf(
          input.resumeId,
        ),
      )
      return { filename: "resume.pdf", base64: pdf.toString("base64") }
    }),
}
