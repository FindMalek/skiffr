import type { Metadata } from "next"
import { AuthForm } from "@/components/auth-form"
import { authPageProps } from "@/lib/auth-page"
import { authProviders } from "@/lib/auth-providers"

export const metadata: Metadata = { title: "Sign in" }

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const providers = await authProviders()
  return <AuthForm mode="sign-in" providers={providers} {...authPageProps(await searchParams, providers)} />
}
