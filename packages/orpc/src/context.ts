import type { Auth, Session } from "@skiffr/auth"
import type { Db } from "@skiffr/db"
import type { Storage } from "@skiffr/storage"
import type { LanguageModel } from "ai"

/** Everything procedures need, built once by the api at startup (and by tests with their own). */
export interface Services {
  db: Db
  auth: Auth
  now: () => Date
  config: {
    deployEnv: string
    githubAuth: boolean
    githubRepo?: string
    githubToken?: string
  }
  storage: Storage | null
  model: LanguageModel | null
}

export type Context = Services & { headers: Headers; session: Session | null }

export async function createContext(services: Services, headers: Headers): Promise<Context> {
  const session = await services.auth.api.getSession({ headers }).catch(() => null)
  return { ...services, headers, session }
}
