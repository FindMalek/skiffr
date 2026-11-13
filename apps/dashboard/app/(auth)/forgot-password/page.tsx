import type { Metadata } from "next"
import { ForgotPasswordForm } from "@/components/password-reset-forms"
import { authProviders } from "@/lib/auth-providers"

export const metadata: Metadata = { title: "Reset your password" }

export default async function ForgotPasswordPage() {
  return <ForgotPasswordForm enabled={(await authProviders()).passwordReset} />
}
