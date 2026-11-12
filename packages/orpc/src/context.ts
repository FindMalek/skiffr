import type { Auth, Session } from "@skiffr/auth"
import type { Db } from "@skiffr/db"
import type { Storage } from "@skiffr/storage"
import type { EmbeddingModel, LanguageModel } from "ai"
import type { CvRuntime } from "./lib/cv"
import type { GmailRuntime, TokenCache } from "./lib/gmail"
import { bearerSecret, type TokenAuth, TokenStoreError, tokenErrorFields, verifyToken } from "./lib/tokens"
import type { WatchRuntime } from "./lib/watch/run"

/** Gmail import, present only when the Google client and the encryption key are configured. */
export interface GmailService {
  runtime: GmailRuntime
  tokens: TokenCache
}

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
  /** Null without an OpenAI key: lookup then skips the similarity step and writes skip embeddings. */
  embeddingModel: EmbeddingModel | null
  gmail?: GmailService | null
  /** The job source watcher's network and limits; without it "Run now" is unavailable. */
  watch?: WatchRuntime | null
  /** Reactive Resume tailoring, present only when `CV_ENCRYPTION_KEY` is set. */
  cv?: CvRuntime | null
}

/**
 * `bearer` is set whenever the request carries an `Authorization: Bearer` header: then only the token counts (`token` is
 * null when it is not valid) and cookies are ignored. `tokenUnavailable` means the token could not be checked at all.
 */
export type Context = Services & {
  /** Also returned as `x-request-id`, so a log line can be tied to the failing request. */
  requestId: string
  headers: Headers
  session: Session | null
  bearer: boolean
  token: TokenAuth | null
  tokenUnavailable: boolean
}

export async function createContext(
  services: Services,
  headers: Headers,
  requestId: string = crypto.randomUUID(),
): Promise<Context> {
  const secret = bearerSecret(headers)
  if (secret !== null) {
    try {
      const token = await verifyToken(services.db, secret, services.now())
      return { ...services, requestId, headers, session: null, bearer: true, token, tokenUnavailable: false }
    } catch (error) {
      if (!(error instanceof TokenStoreError)) throw error
      console.error("[tokens] verify failed", tokenErrorFields(error))
      return { ...services, requestId, headers, session: null, bearer: true, token: null, tokenUnavailable: true }
    }
  }
  const session = await services.auth.api.getSession({ headers }).catch(() => null)
  return { ...services, requestId, headers, session, bearer: false, token: null, tokenUnavailable: false }
}
