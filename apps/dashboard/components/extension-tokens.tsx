"use client"

import { TOKEN_NAME_MAX } from "@skiffr/common/constants"
import type { ApiToken } from "@skiffr/common/schemas"
import { errorMessage } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
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
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { CheckIcon, CopyIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { LocalDate } from "./local-date"

const EXPIRIES = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
  { label: "Never", days: null },
]

function status(token: ApiToken): { label: string; variant: "default" | "secondary" | "outline" } {
  if (token.revokedAt) return { label: "Revoked", variant: "secondary" }
  if (token.expiresAt && token.expiresAt <= new Date()) return { label: "Expired", variant: "secondary" }
  return { label: "Active", variant: "outline" }
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          aria-label={label}
          className="font-mono"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Field>
  )
}

export function ExtensionTokens({ apiUrl }: { apiUrl: string }) {
  const queryClient = useQueryClient()
  const { data: tokens } = useSuspenseQuery(orpc.tokens.list.queryOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.tokens.key() })
  const onError = (error: Error) => toast.error(errorMessage(error))
  const [secret, setSecret] = useState<string | null>(null)

  const create = useMutation(
    orpc.tokens.create.mutationOptions({
      onSuccess: (created) => {
        setSecret(created.secret)
        return refresh()
      },
      onError,
    }),
  )
  const revoke = useMutation(
    orpc.tokens.revoke.mutationOptions({
      onSuccess: () => {
        toast.success("Token revoked")
        return refresh()
      },
      onError,
    }),
  )

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
    <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-3">
      <div className="grid content-start gap-4 lg:col-span-1">
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
                <Button type="submit" className="self-start" disabled={create.isPending}>
                  Create token
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-4 lg:col-span-2">
        {secret && (
          <Card role="status">
            <CardHeader>
              <CardTitle>Copy your token now</CardTitle>
              <CardDescription>It is shown once. If you lose it, revoke it and create another.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <CopyField label="Token" value={secret} />
              <ol className="flex list-decimal flex-col gap-1 pl-5 text-muted-foreground text-sm">
                <li>Open the Skiffr extension options (right click the toolbar icon, then Options).</li>
                <li>
                  Set <strong className="text-foreground">API url</strong> to <code>{apiUrl}</code>.
                </li>
                <li>
                  Paste the token into <strong className="text-foreground">Token</strong>, press Save, then Test
                  connection.
                </li>
              </ol>
              <CopyField label="API url" value={apiUrl} />
              <Button variant="outline" className="self-start" onClick={() => setSecret(null)}>
                I have copied it
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your tokens</CardTitle>
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
                  const state = status(token)
                  return (
                    <li key={token.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{token.name}</span>
                          <Badge variant={state.variant}>{state.label}</Badge>
                        </div>
                        <code className="text-muted-foreground text-xs">
                          {token.prefix}…{token.last4}
                        </code>
                        <span className="text-muted-foreground text-xs">
                          Created <LocalDate value={token.createdAt} />
                          {" · "}
                          {token.lastUsedAt ? (
                            <>
                              Last used <LocalDate value={token.lastUsedAt} time />
                            </>
                          ) : (
                            "Never used"
                          )}
                          {" · "}
                          {token.expiresAt ? (
                            <>
                              Expires <LocalDate value={token.expiresAt} />
                            </>
                          ) : (
                            "No expiry"
                          )}
                        </span>
                      </div>
                      {state.label === "Active" && (
                        <AlertDialog>
                          <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
                            Revoke
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Revoke {token.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The extension using it stops working right away. You can't undo this.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={() => revoke.mutate({ id: token.id })}>
                                Revoke
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
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
