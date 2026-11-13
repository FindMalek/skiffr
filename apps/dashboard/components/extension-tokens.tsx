"use client"

import { TOKEN_ACTIVE_MAX, TOKEN_HISTORY_DAYS, TOKEN_NAME_MAX } from "@skiffr/common/constants"
import type { ApiToken } from "@skiffr/common/schemas"
import { errorMessage } from "@skiffr/orpc/errors"
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
  AlertDialogTrigger,
} from "@skiffr/ui/components/alert-dialog"
import { Badge } from "@skiffr/ui/components/badge"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { Field, FieldGroup, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { Textarea } from "@skiffr/ui/components/textarea"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

const EXPIRIES = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "Never", days: null },
]

type TokenState = {
  label: "Active" | "Revoked" | "Expired"
  variant: "default" | "secondary" | "outline"
  className?: string
}

function status(token: ApiToken, now: Date): TokenState {
  if (token.revokedAt) return { label: "Revoked", variant: "outline", className: "border-destructive text-destructive" }
  if (token.expiresAt && token.expiresAt <= now) return { label: "Expired", variant: "secondary" }
  return { label: "Active", variant: "default" }
}

// One fixed format, in UTC: the server and every browser print the same text, whatever their locale or timezone.
const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" })

function Stamp({ value, time = false }: { value: Date; time?: boolean }) {
  const text = DATE.format(value)
  return <time dateTime={value.toISOString()}>{time ? `${text}, ${value.toISOString().slice(11, 16)} UTC` : text}</time>
}

function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(value)
      setState("copied")
      timer.current = setTimeout(() => setState("idle"), 2000)
    } catch {
      field.current?.focus()
      field.current?.select()
      setState("failed")
    }
  }
  const props = {
    readOnly: true,
    value,
    "aria-label": label,
    onFocus: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => e.currentTarget.select(),
  }
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2">
        {multiline ? (
          <Textarea {...props} ref={field as never} rows={2} className="font-mono min-w-0 resize-none break-all" />
        ) : (
          <Input {...props} ref={field as never} className="font-mono min-w-0" />
        )}
        <Button type="button" variant="outline" onClick={copy}>
          {state === "copied" ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {state === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      {state === "failed" && (
        <p role="alert" className="text-destructive text-xs">
          Could not copy automatically. The text is selected, press Ctrl+C (Cmd+C on mac).
        </p>
      )}
    </Field>
  )
}

function RevokeButton({ token }: { token: ApiToken }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const revoke = useMutation(
    orpc.tokens.revoke.mutationOptions({
      onSuccess: () => {
        toast.success("Token revoked")
        setOpen(false)
        return queryClient.invalidateQueries({ queryKey: orpc.tokens.key() })
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  return (
    <AlertDialog open={open} onOpenChange={(next) => !revoke.isPending && setOpen(next)}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>Revoke</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {token.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The extension using it stops working right away. You can't undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={revoke.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate({ id: token.id })}
          >
            {revoke.isPending ? "Revoking…" : "Revoke"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ExtensionTokens({ apiUrl }: { apiUrl: string }) {
  const queryClient = useQueryClient()
  const { data: tokens } = useSuspenseQuery(orpc.tokens.list.queryOptions())
  const [secret, setSecret] = useState<string | null>(null)
  const [now] = useState(() => new Date())

  // gcTime 0: once this page unmounts the mutation, and the secret in its result, is dropped from the cache.
  const create = useMutation(
    orpc.tokens.create.mutationOptions({
      gcTime: 0,
      onSuccess: (created) => {
        setSecret(created.secret)
        return queryClient.invalidateQueries({ queryKey: orpc.tokens.key() })
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const dismiss = () => {
    setSecret(null)
    create.reset()
  }
  const activeCount = tokens.filter((token) => status(token, now).label === "Active").length
  const atCap = activeCount >= TOKEN_ACTIVE_MAX

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const days = String(data.get("expires"))
    create.mutate(
      { name: String(data.get("name")), expiresInDays: days === "never" ? null : Number(days) },
      { onSuccess: () => form.reset() },
    )
  }

  return (
    <div className="grid gap-4 p-4 md:p-6 @4xl:grid-cols-3">
      <div className="grid content-start gap-4 @4xl:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle>New token</CardTitle>
            <CardDescription>One per browser or machine, so you can revoke them separately.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input id="name" name="name" required maxLength={TOKEN_NAME_MAX} placeholder="Chrome on my laptop" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="expires">Expires</FieldLabel>
                  <select
                    id="expires"
                    name="expires"
                    defaultValue="90"
                    className="h-8 w-full border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-input/30"
                  >
                    {EXPIRIES.map((option) => (
                      <option key={option.label} value={option.days ?? "never"}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button type="submit" className="self-start" disabled={create.isPending || secret !== null || atCap}>
                  Create token
                </Button>
                {secret !== null && (
                  <p className="text-muted-foreground text-xs">Dismiss the new token first to create another.</p>
                )}
                {atCap && (
                  <p className="text-muted-foreground text-xs">
                    You have {TOKEN_ACTIVE_MAX} active tokens. Revoke one to create another.
                  </p>
                )}
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-4 @4xl:col-span-2">
        <p role="status" className="sr-only">
          {secret ? "Token created" : ""}
        </p>
        {secret && (
          <Card>
            <CardHeader>
              <CardTitle>Your new token</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Alert variant="destructive" role="note">
                <TriangleAlertIcon />
                <AlertTitle>Copy it now, you will not see it again</AlertTitle>
                <AlertDescription>
                  Skiffr only keeps a hash. If you lose it, revoke it and create another.
                </AlertDescription>
              </Alert>
              <CopyField label="Token" value={secret} multiline />
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted-foreground text-sm">
                <li>Open the Skiffr extension options (right click the toolbar icon, then Options).</li>
                <li>
                  Set <strong className="text-foreground">API url</strong> to{" "}
                  <code className="font-mono">{apiUrl}</code>.
                </li>
                <li>
                  Paste the token into <strong className="text-foreground">Token</strong>, press Save, then Test
                  connection.
                </li>
              </ol>
              <CopyField label="API url" value={apiUrl} />
              <Button variant="outline" className="self-start" onClick={dismiss}>
                I have copied it
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your tokens</CardTitle>
            <CardDescription>
              Active tokens, and the ones revoked or expired in the last {TOKEN_HISTORY_DAYS} days.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tokens.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>No tokens yet</EmptyTitle>
                  <EmptyDescription>Create one to connect the extension.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="divide-y">
                {tokens.map((token) => {
                  const state = status(token, now)
                  return (
                    <li key={token.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`truncate font-medium ${state.label === "Active" ? "" : "opacity-75"}`}>
                            {token.name}
                          </span>
                          <Badge variant={state.variant} className={state.className}>
                            {state.label}
                          </Badge>
                        </div>
                        <code className="font-mono text-muted-foreground text-xs">
                          {token.prefix}…{token.last4}
                        </code>
                        <span className="text-muted-foreground text-xs">
                          Created <Stamp value={token.createdAt} />
                          {" · "}
                          {token.lastUsedAt ? (
                            <>
                              Last used <Stamp value={token.lastUsedAt} time />
                            </>
                          ) : (
                            "Never used"
                          )}
                          {" · "}
                          {token.revokedAt ? (
                            <>
                              Revoked <Stamp value={token.revokedAt} />
                            </>
                          ) : token.expiresAt ? (
                            <>
                              {state.label === "Expired" ? "Expired" : "Expires"} <Stamp value={token.expiresAt} />
                            </>
                          ) : (
                            "No expiry"
                          )}
                        </span>
                      </div>
                      {state.label === "Active" && <RevokeButton token={token} />}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
