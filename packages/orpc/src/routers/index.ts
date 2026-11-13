import type { RouterClient } from "@orpc/server"
import { accountRouter, adminRouter, meRouter } from "./account"
import { activityRouter } from "./activity"
import { aiRouter } from "./ai"
import { answersRouter } from "./answers"
import { applicationsRouter } from "./applications"
import { cvRouter } from "./cv"
import { gmailRouter } from "./gmail"
import { jobSourcesRouter } from "./job-sources"
import { jobsRouter } from "./jobs"
import { learningRouter } from "./learning"
import { profileRouter } from "./profile"
import { publicRouter } from "./public"
import { statsRouter } from "./stats"
import { extensionRouter, tokensRouter } from "./tokens"

const admin = {
  ...adminRouter,
}

/** One router, namespaced: `public` needs no session, everything else does (and `admin` needs the admin role). */
export const appRouter = {
  public: publicRouter,
  me: meRouter,
  account: accountRouter,
  activity: activityRouter,
  profile: profileRouter,
  answers: answersRouter,
  ai: aiRouter,
  learning: learningRouter,
  gmail: gmailRouter,
  cv: cvRouter,
  jobs: jobsRouter,
  applications: applicationsRouter,
  jobSources: jobSourcesRouter,
  stats: statsRouter,
  tokens: tokensRouter,
  extension: extensionRouter,
  admin,
}

export type AppRouter = typeof appRouter
export type AppRouterClient = RouterClient<AppRouter>
