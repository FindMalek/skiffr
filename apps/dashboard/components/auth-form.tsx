"use client"

import { authClient } from "@skiffr/auth/client"
import { orpc } from "@skiffr/orpc/react"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { Spinner } from "@skiffr/ui/components/spinner"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { type FormEvent, useState } from "react"

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const providers = useQuery(orpc.public.authProviders.queryOptions())
  const signUp = mode === "sign-up"

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email"))
    const password = String(form.get("password"))
    setBusy(true)
    setError(null)
    const result = signUp
      ? await authClient.signUp.email({ email, password, name: String(form.get("name")) })
      : await authClient.signIn.email({ email, password })
    if (result.error) {
      setError(result.error.message ?? "That didn't work, try again.")
      setBusy(false)
      return
    }
    window.location.assign("/")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-2xl">{signUp ? "Create your account" : "Welcome back"}</CardTitle>
        <CardDescription>{signUp ? "It takes a few seconds." : "Sign in to continue."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            {providers.data?.github && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/" })}
                >
                  Continue with GitHub
                </Button>
                <FieldSeparator>or</FieldSeparator>
              </>
            )}
            {signUp && (
              <Field>
                <FieldLabel htmlFor="name">Name</FieldLabel>
                <Input id="name" name="name" autoComplete="name" required />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={10}
                autoComplete={signUp ? "new-password" : "current-password"}
                required
                aria-invalid={Boolean(error)}
              />
              {error && <FieldError>{error}</FieldError>}
            </Field>
            <Button type="submit" disabled={busy}>
              {busy && <Spinner />}
              {signUp ? "Create account" : "Sign in"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-muted-foreground text-sm">
        {signUp ? "Already have an account?" : "New here?"}
        <Link
          href={signUp ? "/sign-in" : "/sign-up"}
          className="ml-1 text-foreground underline-offset-4 hover:underline"
        >
          {signUp ? "Sign in" : "Create an account"}
        </Link>
      </CardFooter>
    </Card>
  )
}
