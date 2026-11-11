import { ORPCError, os } from "@orpc/server"
import type { Session } from "@skiffr/auth"
import type { Context } from "./context"
import { safeErrorFields } from "./lib/errors"
import type { TokenAuth } from "./lib/tokens"

export const o = os.$context<Context>()

/** Unexpected errors are logged with the procedure path and a few safe fields, never the error itself: driver errors carry the statement and its params, which hold the user's data. ORPCErrors are answers, not failures. */
const logErrors = o.middleware(async (options) => {
  const route = options.path.join(".")
  try {
    return await options.next()
  } catch (error) {
    const requestId = (options.context as { requestId?: string }).requestId
    if (!(error instanceof ORPCError)) console.error(`[${route}]`, { route, requestId, ...safeErrorFields(error) })
    else if (error.status >= 500)
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

export const protectedProcedure = publicProcedure.use(requireSession)

const requireAdmin = o.middleware(async ({ context, next }) => {
  if (context.session?.user.role !== "admin") throw new ORPCError("FORBIDDEN", { message: "Admins only." })
  return next()
})

export const adminProcedure = protectedProcedure.use(requireAdmin)
