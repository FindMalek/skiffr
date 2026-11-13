"use client"

import { authClient } from "@skiffr/auth/client"
import { buttonVariants } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@skiffr/ui/components/card"
import { FieldGroup } from "@skiffr/ui/components/field"
import { cn } from "@skiffr/ui/lib/utils"
import Link from "next/link"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { ErrorSummary, PasswordField, SubmitButton, TextField, useAuthErrors } from "@/components/auth-fields"
import { checkField, describeFailure, PASSWORD_RULE, retryTracker } from "@/lib/auth-copy"

function ResetCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: ReactNode
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-2xl font-semibold">{title}</h1>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
      {footer && <CardFooter className="text-sm text-muted-foreground">{footer}</CardFooter>}
    </Card>
  )
}

const LINK = "inline-flex min-h-6 items-center text-foreground underline underline-offset-4 pointer-coarse:min-h-11"

const backToSignIn = (
  <Link href="/sign-in" className={LINK}>
    Back to sign in
  </Link>
)

export function ForgotPasswordForm({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const { errors, summary, formError, clear, set, put, reset } = useAuthErrors()

  if (!enabled) {
    return (
      <ResetCard
        title="Reset your password"
        description="Password reset by email isn't set up on this server. Ask the person who runs it for help."
        footer={backToSignIn}
      />
    )
  }
  if (sentTo) {
    return (
      <ResetCard
        title="Check your email"
        description={
          <span role="status">If an account uses {sentTo}, a reset link is on its way. It expires in 1 hour.</span>
        }
        footer={backToSignIn}
      />
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const email = String(new FormData(event.currentTarget).get("email")).trim()
    const message = checkField("email", email, "sign-in")
    if (message) return set({ email: message })
    setBusy(true)
    reset()
    const retry = retryTracker()
    try {
      const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" }, retry.options)
      if (!error) return setSentTo(email)
      set({}, describeFailure("reset", error, retry.seconds()).message)
    } catch {
      set({}, describeFailure("reset", { status: 0 }).message)
    }
    setBusy(false)
  }

  return (
    <ResetCard
      title="Reset your password"
      description="Enter your email and we send you a link to choose a new one."
      footer={backToSignIn}
    >
      <form method="post" noValidate onSubmit={submit} aria-busy={busy}>
        <FieldGroup>
          <ErrorSummary errors={summary} formError={formError} />
          <TextField
            name="email"
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            error={errors.email}
            onCheck={(value) => put("email", checkField("email", value, "sign-in"))}
            onClear={() => clear("email")}
          />
          <SubmitButton busy={busy}>Send reset link</SubmitButton>
          <p role="status" className="sr-only">
            {busy ? "Sending the reset link" : ""}
          </p>
        </FieldGroup>
      </form>
    </ResetCard>
  )
}

/** `token` came in the url the reset email led to; it is taken out of the address bar at once so it isn't kept in history. */
export function ResetPasswordForm({ token, canRequestNew }: { token: string | null; canRequestNew: boolean }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [dead, setDead] = useState(false)
  const { errors, summary, formError, clear, set, put, reset } = useAuthErrors()

  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname)
  }, [])

  if (done) {
    return (
      <ResetCard
        title="Password changed"
        description={<span role="status">Sign in with your new password.</span>}
        footer={
          <Link href="/sign-in" className={cn(buttonVariants(), "w-full")}>
            Sign in
          </Link>
        }
      />
    )
  }
  if (!token || dead) {
    return (
      <ResetCard
        title="This link doesn't work"
        description={
          canRequestNew
            ? "The reset link has expired or was already used. Ask for a new one."
            : "The reset link has expired or was already used. Ask whoever runs this server for a new one."
        }
        footer={
          canRequestNew ? (
            <Link href="/forgot-password" className={LINK}>
              Send a new link
            </Link>
          ) : (
            backToSignIn
          )
        }
      />
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const newPassword = String(new FormData(event.currentTarget).get("password"))
    const message = checkField("password", newPassword, "reset")
    if (message) return set({ password: message })
    setBusy(true)
    reset()
    const retry = retryTracker()
    try {
      const { error } = await authClient.resetPassword({ newPassword, token }, retry.options)
      if (!error) return setDone(true)
      if (error.code === "INVALID_TOKEN") return setDead(true)
      const failure = describeFailure("reset", error, retry.seconds())
      set(
        failure.field ? { [failure.field]: failure.message } : {},
        failure.field ? null : failure.message,
        failure.field,
      )
    } catch {
      set({}, describeFailure("reset", { status: 0 }).message)
    }
    setBusy(false)
  }

  return (
    <ResetCard title="Choose a new password" description="Pick a password you don't use anywhere else.">
      <form method="post" noValidate onSubmit={submit} aria-busy={busy}>
        <FieldGroup>
          <ErrorSummary errors={summary} formError={formError} />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            required
            error={errors.password}
            hint={PASSWORD_RULE}
            onCheck={(value) => put("password", checkField("password", value, "reset"))}
            onClear={() => clear("password")}
          />
          <SubmitButton busy={busy}>Change password</SubmitButton>
          <p role="status" className="sr-only">
            {busy ? "Changing your password" : ""}
          </p>
        </FieldGroup>
      </form>
    </ResetCard>
  )
}
