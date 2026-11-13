import type { Metadata } from "next"
import { AuthForm } from "@/components/auth-form"
import { authProviders } from "@/lib/auth-providers"
import { safeNext } from "@/lib/auth-redirect"

export const metadata: Metadata = { title: "Create an account" }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const next = first((await searchParams).next)
  return <AuthForm mode="sign-up" providers={await authProviders()} next={next ? safeNext(next) : null} />
}
