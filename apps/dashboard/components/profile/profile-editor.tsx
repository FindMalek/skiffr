"use client"

import { errorMessage, isUnauthorized } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
import { Alert, AlertDescription, AlertTitle } from "@skiffr/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@skiffr/ui/components/alert-dialog"
import { Button } from "@skiffr/ui/components/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { ErrorState } from "@skiffr/ui/components/error-state"
import { Skeleton } from "@skiffr/ui/components/skeleton"
import { Spinner } from "@skiffr/ui/components/spinner"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleAlertIcon } from "lucide-react"
import { type FormEvent, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useActionBar } from "@/components/shell/use-action-bar"
import { Time } from "@/components/time"
import {
  COUNTED_FIELDS,
  formToProfile,
  isDirty,
  type ProfileForm,
  profileToForm,
  type SavedProfile,
  validateProfileForm,
} from "@/lib/profile-form"
import { NeverFilled } from "./never-filled"
import { FIELD_PREFIX, fieldId, ProfileFormContext } from "./profile-field"
import { ProfileMeter } from "./profile-meter"
import { ExtrasGroup, IdentityGroup, LinksGroup, LocationGroup, SalaryGroup, WorkAuthGroup } from "./profile-sections"
import { useUnsavedGuard } from "./use-unsaved-guard"

const LABELS = new Map(COUNTED_FIELDS.map((field) => [field.id, field.label]))

/** A name for an error in the summary: the field label, or "Other link 2" for a row of a list. */
function nameOf(id: string, form: ProfileForm): string {
  const known = LABELS.get(id)
  if (known) return known
  const key = Number(id.split("-").at(-1))
  if (id.startsWith("other-")) return `Other link ${form.otherLinks.findIndex((row) => row.key === key) + 1}`
  const index = form.extras.findIndex((row) => row.key === key) + 1
  if (id.startsWith("extra-label-")) return `Extra field ${index} label`
  if (id.startsWith("extra-value-")) return `Extra field ${index} value`
  return "Extra fields"
}

function focusField(id: string) {
  const element = document.getElementById(fieldId(id))
  element?.focus()
  element?.scrollIntoView?.({ block: "center" })
}

function ProfileEditor({ saved }: { saved: SavedProfile | null }) {
  const queryClient = useQueryClient()
  const getKey = orpc.profile.get.queryOptions().queryKey
  const [form, setForm] = useState<ProfileForm>(() => profileToForm(saved))
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [submitted, setSubmitted] = useState(false)
  const [saveFailure, setSaveFailure] = useState<string | null>(null)
  const [signedOut, setSignedOut] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const submitting = useRef(false)

  const errors = useMemo(() => validateProfileForm(form), [form])
  const dirty = isDirty(form, saved)

  // A refetch (or another tab's save) changed the saved profile: follow it only while the form has no edits of its own.
  const [seen, setSeen] = useState(saved)
  if (saved !== seen) {
    setSeen(saved)
    if (!isDirty(form, seen) && isDirty(form, saved) && !saveFailure && !submitting.current)
      setForm(profileToForm(saved))
  }

  const save = useMutation(
    orpc.profile.upsert.mutationOptions({
      onMutate: async (input) => {
        submitting.current = true
        await queryClient.cancelQueries({ queryKey: getKey })
        const previous = queryClient.getQueryData(getKey)
        const now = new Date()
        queryClient.setQueryData(getKey, {
          id: previous?.id ?? "pending",
          data: input.data,
          fields: input.fields ?? {},
          createdAt: previous?.createdAt ?? now,
          updatedAt: now,
        } as NonNullable<typeof previous>)
        setSavedAt(now)
        return { previous }
      },
      onError: (error, _input, context) => {
        queryClient.setQueryData(getKey, context?.previous ?? null)
        setSavedAt(null)
        setSaveFailure(errorMessage(error))
        setSignedOut(isUnauthorized(error))
        toast.error(errorMessage(error))
      },
      onSuccess: (row) => {
        queryClient.setQueryData(getKey, row)
        setSavedAt(row.updatedAt)
        toast.success("Profile saved")
      },
      onSettled: () => {
        submitting.current = false
      },
    }),
  )

  // `onMutate` clears `dirty` (the cache already holds the new values), so the guard stays up until the api has answered.
  const guard = useUnsavedGuard(dirty || save.isPending)
  const actionBar = useActionBar()

  const set: <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => void = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }))

  const errorFor = (id: string): string | undefined =>
    submitted || touched.has(id) ? errors.find((error) => error.id === id)?.message : undefined

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    const first = errors[0]
    if (first) {
      setAnnouncement(`${errors.length} ${errors.length === 1 ? "field needs" : "fields need"} a change.`)
      focusField(first.id)
      return
    }
    setSaveFailure(null)
    save.mutate(formToProfile(form, saved?.data))
  }

  const status = save.isPending ? (
    <>
      <Spinner aria-hidden="true" role="presentation" />
      Saving…
    </>
  ) : dirty ? (
    "Unsaved changes"
  ) : savedAt ? (
    <>
      Saved <Time value={savedAt} />
    </>
  ) : saved ? (
    "No changes"
  ) : (
    "Nothing saved yet"
  )

  return (
    <ProfileFormContext value={{ form, set, errorFor }}>
      <div className="flex max-w-4xl flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-col gap-4">
          <ProfileMeter saved={profileToForm(saved)} />
          <p className="max-w-prose text-muted-foreground text-sm">
            skiffr fills application forms from this page. Every field is optional, and an empty one stays empty: skiffr
            never makes up a value. It is saved in your own database. See{" "}
            <a href="#never-filled" className="text-foreground underline underline-offset-4">
              the fields skiffr never fills
            </a>
            .
          </p>
        </div>

        {saved === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No profile saved yet</EmptyTitle>
              <EmptyDescription>
                Without a profile the extension has nothing to fill and stops with "No profile saved yet". Start with
                your name and email, add links and your location, then save.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button type="button" variant="outline" onClick={() => focusField("firstName")}>
                Start with your name
              </Button>
            </EmptyContent>
          </Empty>
        ) : null}

        <form
          noValidate
          onSubmit={submit}
          onBlur={(event) => {
            const id = (event.target as HTMLElement).id
            if (!id.startsWith(FIELD_PREFIX)) return
            const field = id.slice(FIELD_PREFIX.length)
            setTouched((current) => new Set(current).add(field))
            setAnnouncement(errors.find((error) => error.id === field)?.message ?? "")
          }}
          className="flex flex-col"
        >
          {submitted && errors.length > 1 ? (
            <Alert variant="destructive" className="mb-8">
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle>{errors.length} fields need a change before you can save</AlertTitle>
              <AlertDescription>
                <ul className="mt-1 flex flex-col gap-1">
                  {errors.map((error) => (
                    <li key={error.id}>
                      <a
                        href={`#${fieldId(error.id)}`}
                        className="text-foreground underline underline-offset-4"
                        onClick={(event) => {
                          event.preventDefault()
                          focusField(error.id)
                        }}
                      >
                        {nameOf(error.id, form)}
                      </a>
                      : {error.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          {saveFailure ? (
            <Alert variant="destructive" className="mb-8">
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle>The profile was not saved</AlertTitle>
              <AlertDescription>
                {saveFailure} Your changes are still on this page.
                {signedOut ? (
                  <>
                    {" "}
                    <a
                      href="/sign-in"
                      target="_blank"
                      rel="noopener"
                      className="text-foreground underline underline-offset-4"
                    >
                      Sign in in a new tab
                    </a>
                    , then press Save profile again.
                  </>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <IdentityGroup />
          <LinksGroup />
          <WorkAuthGroup />
          <SalaryGroup />
          <LocationGroup />
          <ExtrasGroup />
          <NeverFilled />

          <div
            ref={actionBar}
            className="sticky bottom-[calc(var(--tab-bar-h)+env(safe-area-inset-bottom))] z-action -mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t bg-background px-4 py-3 max-md:mb-[calc(var(--action-bar-h)*-1)] md:-mx-6 md:bottom-0 md:px-6"
          >
            <p role="status" className="flex min-h-9 items-center gap-2 text-sm">
              {status}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  setForm(profileToForm(saved))
                  setTouched(new Set())
                  setSubmitted(false)
                  setSaveFailure(null)
                }}
              >
                Discard changes
              </Button>
              <Button type="submit" disabled={save.isPending || !dirty} className="min-w-32">
                {save.isPending ? "Saving…" : "Save profile"}
              </Button>
            </div>
          </div>
        </form>
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>

      <AlertDialog open={guard.pending !== null} onOpenChange={(open) => !open && guard.stay()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to the profile are not saved. If you leave, they are lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={guard.leave}>Leave page</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ProfileFormContext>
  )
}

/** Reads the profile the page prefetched, then hands it to the editor once. A failed read shows the error box, never an empty form that would overwrite the real profile. */
export function ProfileSettings() {
  const query = useQuery(orpc.profile.get.queryOptions())
  if (query.data === undefined) {
    return query.isError ? (
      <div className="max-w-4xl p-4 md:p-6">
        <ErrorState
          title="The profile could not load"
          description={`${errorMessage(query.error)} Nothing was changed.`}
          action={
            <Button type="button" variant="outline" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        />
      </div>
    ) : (
      <div className="flex max-w-4xl flex-col gap-4 p-4 md:p-6" aria-busy="true">
        <Skeleton className="h-3 w-full max-w-md" />
        <Skeleton className="h-9 w-full max-w-120" />
        <Skeleton className="h-9 w-full max-w-120" />
      </div>
    )
  }
  return <ProfileEditor saved={query.data} />
}
