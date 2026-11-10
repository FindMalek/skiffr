import { ORPCError, os } from "@orpc/server"
import type { Context } from "./context"

export const o = os.$context<Context>()

/** Unexpected errors are logged with the procedure path; ORPCErrors are answers, not failures. Every call is rate limited per route and caller first. */
const logErrors = o.middleware(async (options) => {
  const route = options.path.join(".")
  try {
    return await options.next()
  } catch (error) {
    if (!(error instanceof ORPCError)) console.error(`[${route}]`, error)
    throw error
  }
})

export const publicProcedure = o.use(logErrors)

/**
 * Sessions are cookies, so signed-in calls also need `x-csrf-token: orpc`, which the oRPC link sends and a
 * cross-site form can't. That covers the REST (OpenAPI) routes too, not just RPC.
 */
const requireSession = o.middleware(async ({ context, next }) => {
  if (context.headers.get("x-csrf-token") !== "orpc") {
    throw new ORPCError("FORBIDDEN", { message: "Missing the x-csrf-token header." })
  }
  if (!context.session) throw new ORPCError("UNAUTHORIZED", { message: "Please sign in." })
  return next({ context: { session: context.session, user: context.session.user } })
})

export const protectedProcedure = publicProcedure.use(requireSession)

const requireAdmin = o.middleware(async ({ context, next }) => {
  if (context.session?.user.role !== "admin") throw new ORPCError("FORBIDDEN", { message: "Admins only." })
  return next()
})

export const adminProcedure = protectedProcedure.use(requireAdmin)
