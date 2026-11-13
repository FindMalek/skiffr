import type { Metadata } from "next"
import { AuthForm } from "@/components/auth-form"
import { describeOAuthError } from "@/lib/auth-copy"
import { authProviders } from "@/lib/auth-providers"
import { safeNext } from "@/lib/auth-redirect"

export const metadata: Metadata = { title: "Sign in" }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const query = await searchParams
  const next = first(query.next)
  return (
    <AuthForm
      mode="sign-in"
      providers={await authProviders()}
      next={next ? safeNext(next) : null}
      notice={describeOAuthError(first(query.error))}
    />
  )
}
