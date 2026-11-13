export type AuthField = "name" | "email" | "password"
export type FieldErrors = Partial<Record<AuthField, string>>

/** The server rule (`minPasswordLength` in `packages/auth`, better-auth's default max); the server stays the authority. */
export const PASSWORD_MIN = 10
export const PASSWORD_MAX = 128

export const PASSWORD_RULE = `At least ${PASSWORD_MIN} characters.`

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function checkField(field: AuthField, value: string, mode: "sign-in" | "sign-up" | "reset"): string | undefined {
  if (field === "name") return value.trim() ? undefined : "Enter your name."
  if (field === "email") {
    if (!value.trim()) return "Enter your email."
    return EMAIL.test(value.trim()) ? undefined : "Enter a valid email, like name@example.com."
  }
  if (!value) return mode === "reset" ? "Enter a new password." : "Enter your password."
  if (mode === "sign-in") return undefined
  if (value.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (value.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`
}

export function checkForm(
  mode: "sign-in" | "sign-up" | "reset",
  values: Partial<Record<AuthField, string>>,
): FieldErrors {
  const errors: FieldErrors = {}
  for (const field of ["name", "email", "password"] as const) {
    if (values[field] === undefined) continue
    const message = checkField(field, values[field], mode)
    if (message) errors[field] = message
  }
  return errors
}

export interface AuthFailure {
  /** The field to point at; none means the problem is the form or the server, not one input. */
  field?: AuthField
  message: string
}

interface AuthErrorLike {
  status?: number
  code?: string
}

function wait(seconds: number | null): string {
  if (!seconds || seconds < 1) return "in a minute"
  if (seconds < 60) return `in ${Math.ceil(seconds)} ${seconds <= 1 ? "second" : "seconds"}`
  const minutes = Math.ceil(seconds / 60)
  return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
}

/**
 * What the user reads for a failed attempt. Only the error code and status are used, never the server's message, and a
 * wrong email and a wrong password read the same, so the page can't be used to find out which emails have an account.
 */
export function describeFailure(
  mode: "sign-in" | "sign-up" | "reset",
  error: AuthErrorLike,
  retryAfter: number | null = null,
): AuthFailure {
  if (error.status === 429) return { message: `Too many attempts. Try again ${wait(retryAfter)}.` }
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return { field: "password", message: "That email and password don't match. Check both and try again." }
    case "INVALID_EMAIL":
      return { field: "email", message: "Enter a valid email, like name@example.com." }
    case "PASSWORD_TOO_SHORT":
      return { field: "password", message: `Use at least ${PASSWORD_MIN} characters.` }
    case "PASSWORD_TOO_LONG":
      return { field: "password", message: `Use at most ${PASSWORD_MAX} characters.` }
    case "INVALID_TOKEN":
      return { message: "This reset link has expired or was already used. Ask for a new one." }
    case "RESET_PASSWORD_DISABLED":
      return { message: "Password reset isn't set up on this server." }
  }
  if (mode === "sign-up" && error.status === 422) {
    return { message: "We couldn't create that account. If you already have one, sign in instead." }
  }
  if (!error.status || error.status === 0)
    return { message: "Can't reach the server. Check your connection and try again." }
  return { message: "Something went wrong on our side. Try again in a moment." }
}

/** The `error` query param the GitHub callback adds. Only a few known values get their own words. */
export function describeOAuthError(code: string | undefined): string | null {
  if (!code) return null
  if (code === "access_denied") return "GitHub sign in was cancelled."
  return "We couldn't sign you in with GitHub. Try again, or use your email."
}

/** Passed as a request option to read how long the server asks to wait after a 429. */
export function retryTracker() {
  let seconds: number | null = null
  return {
    options: {
      onError: ({ response }: { response: Response }) => {
        seconds = Number(response.headers.get("x-retry-after")) || null
      },
    },
    seconds: () => seconds,
  }
}
