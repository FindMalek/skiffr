import { ORPCError, os } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import { user as userTable } from "@skiffr/db"
import { eq } from "drizzle-orm"
import { getObservability } from "@skiffr/observability"
import type { Context } from "./context"
import { budgetExhausted, budgetedModels, isBudgetSpent } from "./lib/ai-usage"
import { safeErrorFields } from "./lib/errors"
import type { LimitClass } from "./lib/rate-limit"
import type { TokenAuth } from "./lib/tokens"

export const o = os.$context<Context>()

/** Unexpected errors are logged with the procedure path and a few safe fields, never the error itself: driver errors carry the statement and its params, which hold the user's data. ORPCErrors are answers, not failures. */
const logErrors = o.middleware(async (options) => {
  const route = options.path.join(".")
  try {
    return await options.next()
  } catch (error) {
    const requestId = (options.context as { requestId?: string }).requestId
    if (!(error instanceof ORPCError)) {
      console.error(`[${route}]`, { route, requestId, ...safeErrorFields(error) })
      getObservability().captureError(error, { route, request_id: requestId })
    } else if (error.status >= 500)
      console.error(`[${route}]`, { route, requestId, code: error.code, status: error.status })
    throw error
  }
})

export const publicProcedure = o.use(logErrors)

/**
 * Procedures the extension may call with a bearer token. Everything else is session only, so a new procedure is
 * out of a token's reach until it is listed here (account, auth and token management never are).
 */
export const TOKEN_PROCEDURES: ReadonlySet<string> = new Set([
  "extension.whoami",
  "profile.get",
  "answers.list",
  "answers.create",
  "answers.update",
  "answers.recordUse",
  "jobs.list",
  "jobs.next",
  "jobs.create",
  "jobs.update",
  "applications.create",
  "applications.update",
  "ai.mapFields",
  "ai.draftAnswer",
  "learning.lookup",
  "learning.record",
])

/**
 * Cookie sessions also need `x-csrf-token: orpc`, which the oRPC link sends and a cross-site form can't. That covers the
 * REST (OpenAPI) routes too, not just RPC. A bearer token needs neither: a browser never attaches it by itself.
 */
const requireSession = o.middleware(async ({ context, path, next }) => {
  let identity: { user: Session["user"]; token: TokenAuth | null }
  if (context.bearer) {
    if (context.tokenUnavailable) {
      throw new ORPCError("SERVICE_UNAVAILABLE", { message: "The API is unavailable, try again." })
    }
    if (!context.token) throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized." })
    if (!TOKEN_PROCEDURES.has(path.join("."))) {
      throw new ORPCError("FORBIDDEN", { message: "This token can't call that." })
    }
    identity = { user: context.token.user, token: context.token }
  } else {
    if (context.headers.get("x-csrf-token") !== "orpc") {
      throw new ORPCError("FORBIDDEN", { message: "Missing the x-csrf-token header." })
    }
    if (!context.session) throw new ORPCError("UNAUTHORIZED", { message: "Please sign in." })
    identity = { user: context.session.user, token: null }
  }
  return next({ context: identity })
})

/**
 * Procedures that are not an ordinary read or write. Model calls are also metered against the daily budget, whatever
 * their class (see `budgetedModels`): `ai` is the request pace, `embed` is the pace of writes that call the embedding provider.
 */
export const CLASS_OVERRIDES: Readonly<Record<string, LimitClass>> = {
  "ai.mapFields": "ai",
  "ai.draftAnswer": "ai",
  "cv.preview": "ai",
  "notes.summarize": "ai",
  "learning.lookup": "embed",
  "learning.record": "embed",
  "answers.create": "embed",
  "answers.update": "embed",
  "cv.connect": "expensive",
  "cv.test": "expensive",
  "cv.resumes": "expensive",
  "cv.setBase": "expensive",
  "cv.apply": "expensive",
  "cv.pdf": "expensive",
  "gmail.syncNow": "expensive",
  "jobSources.runNow": "expensive",
  "me.avatar": "upload",
  "account.export": "sensitive",
  "account.delete": "sensitive",
}

/** Every other procedure is a read when it is a GET and a write otherwise, so a new one is limited without being listed. */
export function limitClassOf(path: string, method: string | undefined): LimitClass {
  return CLASS_OVERRIDES[path] ?? (method === "GET" ? "read" : "write")
}

/** Per user, whether the caller is a session or a token. The message holds a wait time and nothing of the request. */
const limitRate = o.middleware(async ({ context, path, procedure, next }) => {
  const user = (context as { user?: { id: string } }).user
  if (user && context.limits) {
    const verdict = context.limits.take(user.id, limitClassOf(path.join("."), procedure["~orpc"].route.method))
    if (!verdict.ok) {
      getObservability().count("skiffr.rate_limit.rejected", 1, {
        limit_class: limitClassOf(path.join("."), procedure["~orpc"].route.method),
      })
      const seconds = verdict.retryAfterSeconds
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: `Too many requests. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
        data: { retryAfterSeconds: seconds },
      })
    }
  }
  return next()
})

/**
 * Every model a procedure sees is metered for this user. A spent budget stops the request before the provider is called;
 * it is an error for a chat call and a quiet skip for the best effort embedding work, which handles its own failure.
 */
const meterAi = o.middleware(async ({ context, next }) => {
  const user = (context as { user?: { id: string } }).user
  if (!user) return next()
  const models = budgetedModels({ ...context, user }, { model: context.model, embeddingModel: context.embeddingModel })
  try {
    return await next({ context: models })
  } catch (error) {
    if (isBudgetSpent(error)) {
      getObservability().track("ai_budget_exhausted", { limit: "daily" })
      throw budgetExhausted(context.now())
    }
    throw error
  }
})

export const protectedProcedure = publicProcedure.use(requireSession).use(limitRate).use(meterAi)

/** The role comes from the database, not the session: a cached session keeps the role (and the account) it had. */
const requireAdmin = o.middleware(async ({ context, next }) => {
  const [row] = context.session
    ? await context.db.select({ role: userTable.role }).from(userTable).where(eq(userTable.id, context.session.user.id))
    : []
  if (row?.role !== "admin") throw new ORPCError("FORBIDDEN", { message: "Admins only." })
  return next()
})

export const adminProcedure = protectedProcedure.use(requireAdmin)
