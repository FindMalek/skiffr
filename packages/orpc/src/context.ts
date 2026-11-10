import type { Auth, Session } from "@skiffr/auth"
import type { Db } from "@skiffr/db"
import type { Storage } from "@skiffr/storage"
import type { LanguageModel } from "ai"
import { bearerSecret, type TokenAuth, verifyToken } from "./lib/tokens"

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

/** `bearer` is set whenever the request carries an `Authorization: Bearer` header: then only the token counts (`token` is null when it is not valid) and cookies are ignored. */
export type Context = Services & { headers: Headers; session: Session | null; bearer: boolean; token: TokenAuth | null }

export async function createContext(services: Services, headers: Headers): Promise<Context> {
  const secret = bearerSecret(headers)
  if (secret !== null) {
    const token = await verifyToken(services.db, secret, services.now()).catch(() => null)
    return { ...services, headers, session: null, bearer: true, token }
  }
  const session = await services.auth.api.getSession({ headers }).catch(() => null)
  return { ...services, headers, session, bearer: false, token: null }
}
