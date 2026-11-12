"use client"

import type { GmailRecent, GmailStatus } from "@skiffr/common/schemas"
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
import { Button, buttonVariants } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { Field, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { MailIcon, RefreshCwIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { toast } from "sonner"
import { LocalDate } from "@/components/local-date"
import { errorFor, noticeFor } from "@/lib/gmail-copy"

const CONNECT_URL = "/api/gmail/connect"

const SOURCES: Record<string, string> = {
  "gmail:linkedin": "LinkedIn",
  "gmail:indeed": "Indeed",
  "gmail:glassdoor": "Glassdoor",
  "gmail:wellfound": "Wellfound",
  "gmail:ziprecruiter": "ZipRecruiter",
  "gmail:other": "Other sender",
}

const OUTCOMES: Record<GmailRecent[number]["outcome"], string> = {
  imported: "Added",
  duplicate: "Already queued",
  no_jobs: "No jobs found",
  skipped: "Skipped",
  failed: "Could not read",
}

/** An href from an email is only ever followed if it is a plain web link. */
const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : undefined)

function PrivacyNote() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What skiffr does with your mail</CardTitle>
        <CardDescription>In plain words.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            <strong>Reads</strong> only unread inbox emails from the last 14 days that Gmail matches to the senders you
            watch. A match on a display name is opened too, and skipped when the address is not one you watch.
          </li>
          <li>
            <strong>Stores</strong> the job title, company, link and Gmail's message id. Not the email body, the subject
            or the sender. The refresh token is encrypted on this server.
          </li>
          <li>
            <strong>Changes</strong> an email only when it held jobs: marks it read, takes it out of the inbox and adds
            the <code className="font-mono">skiffr/jobs</code> label. It never deletes or sends anything. Emails with no
            jobs stay exactly where they are.
          </li>
          <li>
            <strong>Revoke</strong> any time with Disconnect here, or at{" "}
            <a
              className="underline underline-offset-4"
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noopener noreferrer"
            >
              myaccount.google.com/permissions
            </a>
            . Your queued jobs and emails stay as they are.
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}

function Senders() {
  const queryClient = useQueryClient()
  const { data } = useSuspenseQuery(orpc.gmail.senders.list.queryOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.gmail.key() })
  const add = useMutation(
    orpc.gmail.senders.add.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const remove = useMutation(
    orpc.gmail.senders.remove.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const sender = String(new FormData(form).get("sender") ?? "")
    add.mutate({ sender }, { onSuccess: () => form.reset() })
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Watched senders</CardTitle>
        <CardDescription>
          Only mail from these is read. An address like jobs@site.com, or a whole domain like site.com.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data.senders.length === 0 ? (
          <p className="text-muted-foreground text-sm">No senders: nothing is read until you add one.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.senders.map((sender) => (
              <li key={sender} className="flex max-w-full items-center gap-1 border py-0.5 pr-0.5 pl-2 text-xs">
                <span className="truncate font-mono" dir="auto">
                  {sender}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Stop reading ${sender}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ sender })}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Field className="min-w-48 flex-1">
            <FieldLabel htmlFor="sender">Add a sender</FieldLabel>
            <Input id="sender" name="sender" required maxLength={120} placeholder="jobs@company.com or company.com" />
          </Field>
          <Button type="submit" variant="outline" disabled={add.isPending || data.senders.length >= data.max}>
            Add
          </Button>
        </form>
        {data.senders.length >= data.max && (
          <p className="text-muted-foreground text-xs">You have {data.max} senders. Remove one to add another.</p>
        )}
      </CardContent>
    </Card>
  )
}

function Recent() {
  const { data } = useSuspenseQuery(orpc.gmail.recent.queryOptions({ input: {} }))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent imports</CardTitle>
        <CardDescription>The latest emails skiffr read and the jobs it took from them.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Nothing imported yet</EmptyTitle>
              <EmptyDescription>Job alert emails show up here after the next sync.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {data.map((message) => (
              <li key={message.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{SOURCES[message.source] ?? "Other sender"}</Badge>
                  <Badge variant={message.outcome === "imported" ? "default" : "outline"}>
                    {OUTCOMES[message.outcome]}
                  </Badge>
                  {message.outcome === "imported" || message.outcome === "duplicate" ? (
                    <span className="text-muted-foreground text-xs">
                      {message.tidied ? "Moved out of your inbox" : "Still in your inbox, tidied on the next sync"}
                    </span>
                  ) : null}
                  <span className="ml-auto text-muted-foreground text-xs">
                    <LocalDate value={message.processedAt} time />
                  </span>
                </div>
                {message.jobs.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {message.jobs.map((job) => {
                      const href = safeHref(job.url)
                      return (
                        <li key={job.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              dir="auto"
                              className="max-w-full truncate font-medium underline-offset-4 hover:underline"
                            >
                              {job.title}
                            </a>
                          ) : (
                            <span dir="auto" className="max-w-full truncate font-medium">
                              {job.title}
                            </span>
                          )}
                          <span dir="auto" className="max-w-full truncate text-muted-foreground">
                            {job.company}
                          </span>
                          {job.unresolved && <Badge variant="outline">Tracking link</Badge>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Connection({ status }: { status: GmailStatus }) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.gmail.key() })
  const [open, setOpen] = useState(false)
  const sync = useMutation(
    orpc.gmail.syncNow.mutationOptions({
      onSuccess: (result) => {
        if (result.state === "busy") toast.message("A sync is already running.")
        else if (result.state === "stopped") toast.error("The sync stopped early. See the message above.")
        else toast.success(result.jobsAdded > 0 ? `Added ${result.jobsAdded} jobs` : "Nothing new")
        return refresh()
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const disconnect = useMutation(
    orpc.gmail.disconnect.mutationOptions({
      onSuccess: (result) => {
        if (result.revoked) toast.success("Gmail disconnected")
        else
          toast.message(
            "Disconnected here. Google could not be reached, so also remove skiffr in your Google account permissions.",
          )
        setOpen(false)
        return refresh()
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const needsReconnect = status.status === "needs_reconnect"
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate" dir="auto">
            {status.email}
          </span>
          <Badge variant={needsReconnect ? "destructive" : "default"}>
            {needsReconnect ? "Needs reconnecting" : status.status === "disabled" ? "Off" : "Connected"}
          </Badge>
        </CardTitle>
        <CardDescription>
          {status.lastSyncAt ? (
            <>
              Last synced <LocalDate value={status.lastSyncAt} time />
            </>
          ) : (
            "Not synced yet"
          )}
          {" · "}
          {status.counts.jobs} jobs from {status.counts.emails} emails
          {" · "}
          checks every {status.syncEveryMinutes} min
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.lastError && !needsReconnect && (
          <p role="status" className="text-muted-foreground text-xs">
            {errorFor(status.lastError)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => sync.mutate(undefined)} disabled={sync.isPending || needsReconnect}>
            <RefreshCwIcon data-icon="inline-start" className={sync.isPending ? "animate-spin" : undefined} />
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
          <AlertDialog open={open} onOpenChange={(next) => !disconnect.isPending && setOpen(next)}>
            <AlertDialogTrigger render={<Button variant="outline" />}>Disconnect</AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Gmail?</AlertDialogTitle>
                <AlertDialogDescription>
                  skiffr revokes its access at Google and deletes the saved connection, the watched senders and the list
                  of emails it read. Jobs already in your queue stay, and so do your emails and the{" "}
                  <code className="font-mono">skiffr/jobs</code> label. You can connect again any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={disconnect.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate(undefined)}
                >
                  {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}

export function GmailSettings({ notice, docsUrl }: { notice: string | null; docsUrl: string }) {
  const { data: status } = useSuspenseQuery(orpc.gmail.status.queryOptions())
  const message = noticeFor(notice)
  useEffect(() => {
    if (!notice) return
    const url = new URL(window.location.href)
    url.searchParams.delete("gmail")
    window.history.replaceState(window.history.state, "", url)
  }, [notice])
  const connectButton = (label: string) => (
    <a href={CONNECT_URL} className={buttonVariants({ className: "self-start" })}>
      <MailIcon data-icon="inline-start" />
      {label}
    </a>
  )

  return (
    <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-3">
      <div className="grid content-start gap-4 lg:col-span-2">
        {message && (
          <Alert variant={message.ok ? "default" : "destructive"} role="status">
            {message.ok ? <MailIcon /> : <TriangleAlertIcon />}
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        {!status.configured && !status.connected && (
          <Card>
            <CardHeader>
              <CardTitle>Not set up on this server</CardTitle>
              <CardDescription>
                Whoever runs skiffr has to create a Google Cloud OAuth client and set GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET and GMAIL_ENCRYPTION_KEY. Until then Gmail can't be connected.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href={docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", className: "self-start" })}
              >
                Read the setup guide
              </a>
            </CardContent>
          </Card>
        )}

        {status.configured && !status.connected && (
          <Card>
            <CardHeader>
              <CardTitle>Connect Gmail</CardTitle>
              <CardDescription>
                Let skiffr read your LinkedIn, Indeed and Glassdoor job alerts and put the jobs in your queue. Google's
                consent screen says skiffr can read, compose and send email from your Gmail account: that is how Google
                words the one permission needed to mark an email read and label it. skiffr never sends or deletes
                anything. Until the app is verified, Google may first show "Google hasn't verified this app": choose
                Advanced, then continue.
              </CardDescription>
            </CardHeader>
            <CardContent>{connectButton("Connect Gmail")}</CardContent>
          </Card>
        )}

        {status.connected && status.status === "needs_reconnect" && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Reconnect Gmail</AlertTitle>
            <AlertDescription>
              <p>{errorFor(status.lastError ?? "auth")} skiffr stopped reading your mail until you connect again.</p>
              {status.configured && <div className="mt-2">{connectButton("Reconnect Gmail")}</div>}
            </AlertDescription>
          </Alert>
        )}

        {status.connected && <Connection status={status} />}
        {status.connected && <Recent />}
      </div>

      <div className="grid content-start gap-4 lg:col-span-1">
        {status.connected && <Senders />}
        <PrivacyNote />
      </div>
    </div>
  )
}
