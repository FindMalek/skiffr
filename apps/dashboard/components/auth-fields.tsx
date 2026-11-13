"use client"

import { Alert, AlertDescription, AlertTitle } from "@skiffr/ui/components/alert"
import { Button } from "@skiffr/ui/components/button"
import { Field, FieldDescription, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@skiffr/ui/components/input-group"
import { Spinner } from "@skiffr/ui/components/spinner"
import { CircleXIcon, EyeIcon, EyeOffIcon } from "lucide-react"
import { type ComponentProps, type FocusEvent, type ReactNode, useEffect, useId, useState } from "react"
import type { AuthField, FieldErrors } from "@/lib/auth-copy"

/** Errors of one auth form: per field, plus one for the form itself (rate limit, server down). */
export function useAuthErrors(initialFormError: string | null = null) {
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(initialFormError)
  const [submitted, setSubmitted] = useState(false)
  const [focus, setFocus] = useState<{ field: AuthField } | null>(null)

  useEffect(() => {
    if (!focus) return
    const input = document.getElementById(focus.field) as HTMLInputElement | null
    input?.focus()
    input?.select()
  }, [focus])

  return {
    errors,
    /** What the summary alert lists: only after a submit, so a blur never pushes the button away under the pointer. */
    summary: submitted ? errors : {},
    formError,
    clear: (field: AuthField) => {
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
      setFormError(null)
    },
    set: (next: FieldErrors, form: string | null = null, focusField?: AuthField) => {
      setErrors(next)
      setFormError(form)
      setSubmitted(true)
      const first = focusField ?? (["name", "email", "password"] as const).find((field) => next[field])
      if (first) setFocus({ field: first })
    },
    put: (field: AuthField, message: string | undefined) => setErrors((current) => ({ ...current, [field]: message })),
    reset: () => {
      setErrors({})
      setFormError(null)
      setSubmitted(false)
    },
  }
}

/** Focus is going to the submit button: the submit validates, and a message appearing now would move the button off the click. */
const toSubmit = (event: FocusEvent<HTMLInputElement>) =>
  !event.currentTarget.value ||
  (event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.type === "submit")

function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error) {
    return (
      <p id={id} className="flex items-start gap-1.5 text-xs text-destructive">
        <CircleXIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        <span>{error}</span>
      </p>
    )
  }
  return hint ? <FieldDescription id={id}>{hint}</FieldDescription> : null
}

interface TextFieldProps extends Omit<ComponentProps<"input">, "id" | "name"> {
  name: AuthField
  label: string
  error?: string
  hint?: ReactNode
  onCheck?: (value: string) => void
  onClear?: () => void
}

export function TextField({ name, label, error, hint, onCheck, onClear, onBlur, onInput, ...input }: TextFieldProps) {
  const messageId = `${useId()}-${name}`
  return (
    <Field>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? messageId : undefined}
        onBlur={(event) => {
          onBlur?.(event)
          if (!toSubmit(event)) onCheck?.(event.currentTarget.value)
        }}
        onInput={(event) => {
          onInput?.(event)
          onClear?.()
        }}
        {...input}
      />
      <FieldMessage id={messageId} error={error} hint={hint} />
    </Field>
  )
}

interface PasswordFieldProps extends Omit<TextFieldProps, "name" | "type" | "label"> {
  label?: string
  after?: ReactNode
}

export function PasswordField({
  label = "Password",
  error,
  hint,
  onCheck,
  onClear,
  onBlur,
  onInput,
  after,
  ...input
}: PasswordFieldProps) {
  const [shown, setShown] = useState(false)
  const messageId = `${useId()}-password`
  return (
    <Field>
      <FieldLabel htmlFor="password">{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id="password"
          name="password"
          type={shown ? "text" : "password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? messageId : undefined}
          onBlur={(event) => {
            onBlur?.(event)
            if (!toSubmit(event)) onCheck?.(event.currentTarget.value)
          }}
          onInput={(event) => {
            onInput?.(event)
            onClear?.()
          }}
          {...input}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            aria-label="Show password"
            aria-pressed={shown}
            className="size-(--control-h) -me-2"
            onClick={() => setShown((value) => !value)}
          >
            {shown ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <FieldMessage id={messageId} error={error} hint={hint} />
      {after}
    </Field>
  )
}

/** Keeps its width while pending: the label stays (hidden) and the spinner sits on top. */
export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={busy} focusableWhenDisabled className="relative">
      <span className={busy ? "opacity-0" : undefined}>{children}</span>
      {busy && <Spinner aria-hidden="true" role="presentation" aria-label={undefined} className="absolute" />}
    </Button>
  )
}

/** One alert for what the fields can't say: several errors at once, or a problem with the form or server. */
export function ErrorSummary({ errors, formError }: { errors: FieldErrors; formError: string | null }) {
  const listed = (["name", "email", "password"] as const).flatMap((field) =>
    errors[field] ? [{ field, message: errors[field] }] : [],
  )
  if (!formError && listed.length < 2) return null
  return (
    <Alert variant="destructive">
      <CircleXIcon aria-hidden="true" />
      <AlertTitle>{formError ? "That didn't work" : `Fix ${listed.length} things to continue`}</AlertTitle>
      <AlertDescription>
        {formError ?? (
          <ul className="flex list-none flex-col gap-1 p-0">
            {listed.map(({ field, message }) => (
              <li key={field}>
                <a
                  href={`#${field}`}
                  className="text-foreground underline underline-offset-3"
                  onClick={(event) => {
                    event.preventDefault()
                    document.getElementById(field)?.focus()
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  )
}
