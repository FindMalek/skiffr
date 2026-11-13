import type { Metadata } from "next"
import { ResetPasswordForm } from "@/components/password-reset-forms"

// The reset token is in this page's url: keep it out of the Referer of anything the page links to.
export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" }

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams
  return <ResetPasswordForm token={typeof token === "string" && token && !error ? token : null} />
}
