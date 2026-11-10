import type { RouterClient } from "@orpc/server"
import { adminRouter, meRouter } from "./account"
import { notesRouter } from "./notes"
import { publicRouter } from "./public"

const admin = {
  ...adminRouter,
}

/** One router, namespaced: `public` needs no session, everything else does (and `admin` needs the admin role). */
export const appRouter = {
  public: publicRouter,
  me: meRouter,
  notes: notesRouter,
  admin,
}

export type AppRouter = typeof appRouter
export type AppRouterClient = RouterClient<AppRouter>
