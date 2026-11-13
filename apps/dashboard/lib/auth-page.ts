import type { AuthProviders } from "@/components/auth-form"
import { describeOAuthError } from "@/lib/auth-copy"
import { safeNext } from "@/lib/auth-redirect"

type Query = Record<string, string | string[] | undefined>

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/** What an auth page takes from its url: a validated `next`, and the GitHub callback problem when GitHub is on. */
export function authPageProps(query: Query, providers: AuthProviders): { next: string | null; notice: string | null } {
  const next = first(query.next)
  return {
    next: next ? safeNext(next) : null,
    notice: providers.github ? describeOAuthError(first(query.error)) : null,
  }
}
