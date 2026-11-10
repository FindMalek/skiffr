import type { RouterClient } from "@orpc/server"
import { adminRouter, meRouter } from "./account"
import { aiRouter } from "./ai"
import { answersRouter } from "./answers"
import { applicationsRouter } from "./applications"
import { jobSourcesRouter } from "./job-sources"
import { jobsRouter } from "./jobs"
import { notesRouter } from "./notes"
import { profileRouter } from "./profile"
import { publicRouter } from "./public"
import { extensionRouter, tokensRouter } from "./tokens"

const admin = {
  ...adminRouter,
}

/** One router, namespaced: `public` needs no session, everything else does (and `admin` needs the admin role). */
export const appRouter = {
  public: publicRouter,
  me: meRouter,
  notes: notesRouter,
  profile: profileRouter,
  answers: answersRouter,
  ai: aiRouter,
  jobs: jobsRouter,
  applications: applicationsRouter,
  jobSources: jobSourcesRouter,
  tokens: tokensRouter,
  extension: extensionRouter,
  admin,
}

export type AppRouter = typeof appRouter
export type AppRouterClient = RouterClient<AppRouter>
