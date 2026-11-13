"use client"

import { authClient } from "@skiffr/auth/client"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@skiffr/ui/components/card"
import { FieldGroup, FieldSeparator } from "@skiffr/ui/components/field"
import Link from "next/link"
import { type FormEvent, useState } from "react"
import { ErrorSummary, PasswordField, SubmitButton, TextField, useAuthErrors } from "@/components/auth-fields"
import { type AuthField, checkField, checkForm, describeFailure, PASSWORD_RULE, retryTracker } from "@/lib/auth-copy"
import { withNext } from "@/lib/auth-redirect"

export interface AuthProviders {
  github: boolean
  passwordReset: boolean
}

interface AuthFormProps {
  mode: "sign-in" | "sign-up"
  providers: AuthProviders
  /** Already validated by `safeNext`; sign up always lands on `/`. */
  next: string | null
  /** A problem reported by the GitHub callback, already turned into words. */
  notice?: string | null
}

export function AuthForm({ mode, providers, next, notice = null }: AuthFormProps) {
  const [busy, setBusy] = useState<"email" | "github" | null>(null)
  const { errors, summary, formError, clear, set, put, reset } = useAuthErrors(notice)
  const signUp = mode === "sign-up"
  const destination = signUp ? "/" : (next ?? "/")

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    const form = new FormData(event.currentTarget)
    const values = {
      ...(signUp ? { name: String(form.get("name")) } : {}),
      email: String(form.get("email")).trim(),
      password: String(form.get("password")),
    }
    const invalid = checkForm(mode, values)
    if (Object.keys(invalid).length > 0) return set(invalid)

    setBusy("email")
    reset()
    let failure: ReturnType<typeof describeFailure> | null = null
    const retry = retryTracker()
    const { options } = retry
    try {
      const { error } = signUp
        ? await authClient.signUp.email(
            { email: values.email, password: values.password, name: values.name ?? "" },
            options,
          )
        : await authClient.signIn.email(values, options)
      if (error) failure = describeFailure(mode, error, retry.seconds())
    } catch {
      failure = describeFailure(mode, { status: 0 })
    }
    if (!failure) return window.location.assign(destination)
    setBusy(null)
    set(
      failure.field ? { [failure.field]: failure.message } : {},
      failure.field ? null : failure.message,
      failure.field,
    )
  }

  const github = async () => {
    if (busy) return
    setBusy("github")
    reset()
    try {
      const { error } = await authClient.signIn.social({
        provider: "github",
        callbackURL: destination,
        newUserCallbackURL: "/",
        errorCallbackURL: withNext("/sign-in", next),
      })
      if (!error) return
      set({}, describeFailure(mode, error).message)
    } catch {
      set({}, describeFailure(mode, { status: 0 }).message)
    }
    setBusy(null)
  }

  const check = (field: AuthField) => (value: string) => put(field, checkField(field, value, mode))

  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-2xl font-semibold">{signUp ? "Create your account" : "Sign in"}</h1>
        <CardDescription>
          {signUp ? "Your profile and answers stay on this server." : "Sign in to your skiffr dashboard."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" noValidate onSubmit={submit} aria-busy={busy !== null}>
          <FieldGroup>
            <ErrorSummary errors={summary} formError={formError} />
            {providers.github && (
              <>
                <Button type="button" variant="outline" disabled={busy !== null} focusableWhenDisabled onClick={github}>
                  {busy === "github" ? "Redirecting to GitHub" : "Continue with GitHub"}
                </Button>
                <FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">or</FieldSeparator>
              </>
            )}
            {signUp && (
              <TextField
                name="name"
                label="Name"
                autoComplete="name"
                autoCapitalize="words"
                required
                error={errors.name}
                onCheck={check("name")}
                onClear={() => clear("name")}
              />
            )}
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
              onCheck={check("email")}
              onClear={() => clear("email")}
            />
            <PasswordField
              autoComplete={signUp ? "new-password" : "current-password"}
              required
              error={errors.password}
              hint={signUp ? PASSWORD_RULE : undefined}
              onCheck={signUp ? check("password") : undefined}
              onClear={() => clear("password")}
              after={
                !signUp && providers.passwordReset ? (
                  <Link
                    href="/forgot-password"
                    className="inline-flex min-h-6 items-center text-xs underline underline-offset-4 pointer-coarse:min-h-11"
                  >
                    Forgot password?
                  </Link>
                ) : null
              }
            />
            <SubmitButton busy={busy === "email"}>{signUp ? "Create account" : "Sign in"}</SubmitButton>
            <p role="status" className="sr-only">
              {busy === "email" ? (signUp ? "Creating your account" : "Signing in") : ""}
            </p>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex-wrap gap-x-1 text-sm text-muted-foreground">
        {signUp ? "Already have an account?" : "New here?"}
        <Link
          href={{ pathname: signUp ? "/sign-in" : "/sign-up", query: next && next !== "/" ? { next } : undefined }}
          className="text-foreground underline underline-offset-4"
        >
          {signUp ? "Sign in" : "Create an account"}
        </Link>
      </CardFooter>
    </Card>
  )
}
