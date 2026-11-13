import type { Metadata } from "next"
import { AuthForm } from "@/components/auth-form"
import { authPageProps } from "@/lib/auth-page"
import { authProviders } from "@/lib/auth-providers"

export const metadata: Metadata = { title: "Create an account" }

export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const providers = await authProviders()
  return <AuthForm mode="sign-up" providers={providers} {...authPageProps(await searchParams, providers)} />
}
