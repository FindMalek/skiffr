"use client"

import { Input } from "@skiffr/ui/components/input"
import { cn } from "@skiffr/ui/lib/utils"
import { CircleAlertIcon } from "lucide-react"
import { type ComponentProps, createContext, type ReactNode, use, useId } from "react"
import type { ProfileForm } from "@/lib/profile-form"

/** DOM ids of the controls are `profile-<id>`, so the error summary and the focus-first-error step can find them. */
export const FIELD_PREFIX = "profile-"
export const fieldId = (id: string): string => `${FIELD_PREFIX}${id}`

type Ctx = {
  form: ProfileForm
  set: <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => void
  /** The message to show for a control: only after it was left or after a save attempt. */
  errorFor: (id: string) => string | undefined
}

export const ProfileFormContext = createContext<Ctx | null>(null)

export function useProfileForm(): Ctx {
  const ctx = use(ProfileFormContext)
  if (!ctx) throw new Error("ProfileFormContext is missing")
  return ctx
}

type ControlProps = { id: string; "aria-invalid": true | undefined; "aria-describedby": string }

/**
 * Label above the control, helper below, the error replaces nothing: it sits under the helper and both are tied to the
 * control with `aria-describedby` (DESIGN.md 4.4). `group` renders a text label for a radio group or select, which a
 * `<label for>` cannot name.
 */
export function ProfileField({
  id,
  label,
  help,
  group = false,
  className,
  children,
}: {
  id: string
  label: string
  help: string
  group?: boolean
  className?: string
  children: (props: ControlProps & { labelledBy: string }) => ReactNode
}) {
  const { errorFor } = useProfileForm()
  const dom = fieldId(id)
  const error = errorFor(id)
  const labelId = `${dom}-label`
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {group ? (
        <span id={labelId} className="font-medium text-sm leading-snug">
          {label}
        </span>
      ) : (
        <label htmlFor={dom} id={labelId} className="font-medium text-sm leading-snug">
          {label}
        </label>
      )}
      {children({
        id: dom,
        labelledBy: labelId,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? `${dom}-help ${dom}-error` : `${dom}-help`,
      })}
      <p id={`${dom}-help`} className="text-muted-foreground text-xs leading-normal">
        {help}
      </p>
      {error ? (
        <p id={`${dom}-error`} className="flex items-start gap-1.5 text-destructive text-xs leading-normal">
          <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

type TextKey = {
  [K in keyof ProfileForm]: ProfileForm[K] extends string ? K : never
}[keyof ProfileForm]

export function TextField({
  name,
  label,
  help,
  className,
  ...input
}: { name: TextKey; label: string; help: string } & Omit<
  ComponentProps<typeof Input>,
  "value" | "onChange" | "name" | "id"
>) {
  const { form, set } = useProfileForm()
  return (
    <ProfileField id={name} label={label} help={help} className={className}>
      {({ labelledBy: _labelledBy, ...control }) => (
        <Input
          {...control}
          name={name}
          value={form[name]}
          onChange={(event) => set(name, event.target.value as never)}
          {...input}
        />
      )}
    </ProfileField>
  )
}

/** One bordered block of the settings form: title and what it is for on the left, the controls on the right (stacked below 768px of content width). */
export function ProfileGroup({
  title,
  description,
  children,
}: {
  title: string
  description: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-b py-8 first:pt-0 @3xl:flex-row @3xl:gap-12">
      <div className="flex min-w-0 flex-col gap-1 @3xl:w-60 @3xl:shrink-0">
        <h2 id={id} className="font-heading font-semibold text-base">
          {title}
        </h2>
        <div className="text-muted-foreground text-sm">{description}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-5 @3xl:max-w-120">{children}</div>
    </section>
  )
}
