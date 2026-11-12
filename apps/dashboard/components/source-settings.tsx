"use client"

import { WATCH_LABEL_MAX, WATCH_SOURCES_MAX } from "@skiffr/common/constants"
import { type JobSource, jobUrlSchema } from "@skiffr/common/schemas"
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
import { Button, buttonVariants } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { Field, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { Switch } from "@skiffr/ui/components/switch"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"
import { LocalDate } from "@/components/local-date"
import { JobHost, SafeText } from "@/components/queue/job-text"
import { errorFor, kindLabel } from "@/lib/watch-copy"

function useRefresh() {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.jobSources.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.jobs.key() }),
    ])
  }
}

function statusBadge(source: JobSource) {
  if (!source.enabled) return <Badge variant="outline">Paused</Badge>
  if (source.status === "error") return <Badge variant="destructive">Problem</Badge>
  if (source.status === "ok") return <Badge variant="default">Watching</Badge>
  return <Badge variant="secondary">Not checked yet</Badge>
}

function AddSource({ count }: { count: number }) {
  const refresh = useRefresh()
  const add = useMutation(
    orpc.jobSources.create.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const url = String(data.get("url") ?? "")
    if (!jobUrlSchema.safeParse(url).success) {
      toast.error("Use a public address that starts with http:// or https://.")
      return
    }
    add.mutate(
      { url, label: String(data.get("label") ?? "") },
      {
        onSuccess: () => {
          form.reset()
          toast.success("Source added. It is fetched within a few minutes, or press Run now.")
        },
      },
    )
  }
  const full = count >= WATCH_SOURCES_MAX
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a source</CardTitle>
        <CardDescription>
          A careers page, an RSS or Atom feed, a JSON feed, or a Greenhouse, Lever, Ashby or Workable board.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <Field className="min-w-64 flex-[2]">
            <FieldLabel htmlFor="source-url">Address</FieldLabel>
            <Input
              id="source-url"
              name="url"
              type="url"
              required
              maxLength={2048}
              placeholder="https://company.com/careers"
              autoComplete="off"
            />
          </Field>
          <Field className="min-w-40 flex-1">
            <FieldLabel htmlFor="source-label">Name</FieldLabel>
            <Input
              id="source-label"
              name="label"
              required
              maxLength={WATCH_LABEL_MAX}
              placeholder="Company"
              autoComplete="off"
            />
          </Field>
          <Button type="submit" disabled={add.isPending || full}>
            <PlusIcon data-icon="inline-start" />
            Add
          </Button>
        </form>
        {full && (
          <p className="mt-3 text-muted-foreground text-xs">
            You watch {WATCH_SOURCES_MAX} sources. Remove one to add another.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function SourceRow({ source }: { source: JobSource }) {
  const refresh = useRefresh()
  const [open, setOpen] = useState(false)
  const toggle = useMutation(
    orpc.jobSources.update.mutationOptions({
      onSuccess: refresh,
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const run = useMutation(
    orpc.jobSources.runNow.mutationOptions({
      onSuccess: (result) => {
        if (result.state === "busy") toast.message("This source is already being fetched.")
        else if (result.state === "stopped") toast.error("The fetch failed. The reason is under the source.")
        else toast.success(result.added > 0 ? `Added ${result.added} jobs` : "Nothing new")
        return refresh()
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const remove = useMutation(
    orpc.jobSources.remove.mutationOptions({
      onSuccess: () => {
        setOpen(false)
        toast.success("Source removed. Jobs already in your queue stay.")
        return refresh()
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <SafeText value={source.label || "Unnamed"} max={60} className="min-w-0 truncate font-medium" />
        {statusBadge(source)}
        {source.kind !== "auto" && <Badge variant="outline">{kindLabel(source.kind)}</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Switch
            size="sm"
            checked={source.enabled}
            disabled={toggle.isPending}
            aria-label={`Watch ${source.label || "this source"}`}
            onCheckedChange={(enabled) => toggle.mutate({ id: source.id, enabled })}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={run.isPending || !source.enabled}
            onClick={() => run.mutate({ id: source.id })}
          >
            <RefreshCwIcon data-icon="inline-start" className={run.isPending ? "animate-spin" : undefined} />
            {run.isPending ? "Fetching…" : "Run now"}
          </Button>
          <AlertDialog open={open} onOpenChange={(next) => !remove.isPending && setOpen(next)}>
            <AlertDialogTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={`Remove ${source.label || "this source"}`} />}
            >
              <Trash2Icon />
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Stop watching this source?</AlertDialogTitle>
                <AlertDialogDescription>
                  skiffr stops fetching it. Jobs it already added stay in your queue.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: source.id })}
                >
                  {remove.isPending ? "Removing…" : "Remove"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-muted-foreground text-xs">
        <JobHost url={source.url} className="max-w-full truncate font-mono" />
        <span>
          {source.lastCheckedAt ? (
            <>
              Checked <LocalDate value={source.lastCheckedAt} time />
            </>
          ) : (
            "Not checked yet"
          )}
        </span>
        {source.lastCheckedAt && source.status === "ok" && (
          <span>
            {source.lastFound} postings, {source.lastAdded} new
          </span>
        )}
      </div>
      {source.lastError && source.enabled && (
        <p role="status" className="text-muted-foreground text-xs">
          {errorFor(source.lastError)}
        </p>
      )}
    </li>
  )
}

function Sources() {
  const { data } = useSuspenseQuery(orpc.jobSources.list.queryOptions({ input: {} }))
  return (
    <>
      <AddSource count={data.length} />
      <Card>
        <CardHeader>
          <CardTitle>Your sources</CardTitle>
          <CardDescription>
            {data.length} of {WATCH_SOURCES_MAX}. Each one is fetched about once an hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No sources yet</EmptyTitle>
                <EmptyDescription>Add a careers page above. New postings show up in your queue.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y">
              {data.map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function PrivacyNote({ docsUrl }: { docsUrl: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What skiffr does with these addresses</CardTitle>
        <CardDescription>In plain words.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            <strong>Fetches</strong> only public web pages and feeds, from the server, with a plain request that names
            skiffr. Addresses that point inside a network are refused, and so is every redirect to one.
          </li>
          <li>
            <strong>Stores</strong> the job title, company and link of each posting. Not the page.
          </li>
          <li>
            <strong>Never opens</strong> the job links it finds. You open them yourself from the queue.
          </li>
          <li>
            <strong>Slow down</strong> on its own: about once an hour per source, and longer after a failure.
          </li>
        </ul>
        <a
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline", className: "self-start" })}
        >
          Read the guide
        </a>
      </CardContent>
    </Card>
  )
}

export function SourceSettings({ docsUrl }: { docsUrl: string }) {
  return (
    <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-3">
      <div className="grid content-start gap-4 lg:col-span-2">
        <Sources />
      </div>
      <div className="grid content-start gap-4 lg:col-span-1">
        <PrivacyNote docsUrl={docsUrl} />
      </div>
    </div>
  )
}
