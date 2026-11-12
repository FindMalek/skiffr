"use client"

import type { CvStatus } from "@skiffr/common/schemas"
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
import { Field, FieldDescription, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { Spinner } from "@skiffr/ui/components/spinner"
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { PlugZapIcon, TriangleAlertIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { toast } from "sonner"

function ConnectForm({ status }: { status: CvStatus }) {
  const queryClient = useQueryClient()
  const connect = useMutation(
    orpc.cv.connect.mutationOptions({
      onSuccess: async () => {
        toast.success("Connected to Reactive Resume")
        await queryClient.invalidateQueries({ queryKey: orpc.cv.key() })
      },
    }),
  )
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    connect.mutate(
      { baseUrl: String(data.get("baseUrl") ?? ""), apiKey: String(data.get("apiKey") ?? "") },
      { onSuccess: () => form.reset() },
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{status.connected ? "Replace the connection" : "Connect Reactive Resume"}</CardTitle>
        <CardDescription>
          Use {status.defaultUrl} or the https address of your own instance. In Reactive Resume, create an API key with
          read, write and delete access under Settings, then paste it here. skiffr calls your instance once to check the
          key before saving it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={connect.isPending}>
          <Field>
            <FieldLabel htmlFor="cv-url">Address</FieldLabel>
            <Input
              id="cv-url"
              name="baseUrl"
              type="url"
              required
              maxLength={2048}
              autoComplete="off"
              defaultValue={status.baseUrl ?? status.defaultUrl}
              key={status.baseUrl ?? status.defaultUrl}
              dir="ltr"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cv-key">API key</FieldLabel>
            <Input
              id="cv-key"
              name="apiKey"
              type="password"
              required
              minLength={8}
              maxLength={256}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              aria-describedby="cv-key-help"
            />
            <FieldDescription id="cv-key-help">
              Stored encrypted on this server and never shown again. Only the last 4 characters are kept readable.
            </FieldDescription>
          </Field>
          {connect.isError && (
            <Alert variant="destructive" role="alert">
              <TriangleAlertIcon />
              <AlertDescription>{errorMessage(connect.error)}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" className="self-start" disabled={connect.isPending}>
            {connect.isPending ? <Spinner data-icon="inline-start" /> : <PlugZapIcon data-icon="inline-start" />}
            {connect.isPending ? "Checking…" : "Test and save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function BaseResume({ status }: { status: CvStatus }) {
  const queryClient = useQueryClient()
  const resumes = useQuery({ ...orpc.cv.resumes.queryOptions(), staleTime: 15_000 })
  const [choice, setChoice] = useState<string | null>(null)
  const setBase = useMutation(
    orpc.cv.setBase.mutationOptions({
      onSuccess: async () => {
        toast.success("Base resume saved")
        await queryClient.invalidateQueries({ queryKey: orpc.cv.status.key() })
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const selected = choice ?? status.baseResume?.id ?? ""
  return (
    <Card>
      <CardHeader>
        <CardTitle>Base resume</CardTitle>
        <CardDescription>
          The resume skiffr tailors. It is only read: every tailored version is a separate copy named after the company
          and role.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {resumes.isPending ? (
          <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
            <Spinner /> Loading your resumes…
          </p>
        ) : resumes.isError ? (
          <Alert variant="destructive" role="alert">
            <TriangleAlertIcon />
            <AlertTitle>Could not load your resumes</AlertTitle>
            <AlertDescription>
              <p>{errorMessage(resumes.error)}</p>
              <Button className="mt-2" variant="outline" size="sm" onClick={() => resumes.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : resumes.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            That account has no resumes yet. Create one in Reactive Resume, then reload this page.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-48 flex-1">
              <FieldLabel htmlFor="cv-base">Resume</FieldLabel>
              <select
                id="cv-base"
                value={selected}
                onChange={(event) => setChoice(event.target.value)}
                className="h-8 w-full border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="" disabled>
                  Choose a resume
                </option>
                {resumes.data.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.name}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              variant="outline"
              disabled={!selected || selected === status.baseResume?.id || setBase.isPending}
              onClick={() => setBase.mutate({ resumeId: selected })}
            >
              {setBase.isPending ? "Saving…" : "Use as base"}
            </Button>
          </div>
        )}
        {status.baseResume && (
          <p className="text-sm">
            Tailoring <strong dir="auto">{status.baseResume.name}</strong>
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Connection({ status }: { status: CvStatus }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const test = useMutation(
    orpc.cv.test.mutationOptions({
      onSuccess: (result) =>
        toast.success(`Works: ${result.resumes} ${result.resumes === 1 ? "resume" : "resumes"} found`),
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  const disconnect = useMutation(
    orpc.cv.disconnect.mutationOptions({
      onSuccess: async () => {
        toast.success("Disconnected")
        setOpen(false)
        await queryClient.invalidateQueries({ queryKey: orpc.cv.key() })
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate" dir="ltr">
            {status.baseUrl}
          </span>
          <Badge>Connected</Badge>
        </CardTitle>
        <CardDescription>
          API key ending in <code className="font-mono">{status.keyLast4}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button onClick={() => test.mutate(undefined)} disabled={test.isPending}>
          {test.isPending ? <Spinner data-icon="inline-start" /> : <PlugZapIcon data-icon="inline-start" />}
          {test.isPending ? "Testing…" : "Test connection"}
        </Button>
        <AlertDialog open={open} onOpenChange={(next) => !disconnect.isPending && setOpen(next)}>
          <AlertDialogTrigger render={<Button variant="outline" />}>Disconnect</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect Reactive Resume?</AlertDialogTitle>
              <AlertDialogDescription>
                skiffr deletes the saved address and API key. Your resumes and the copies it made stay in Reactive
                Resume. You can also revoke the key there.
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
      </CardContent>
    </Card>
  )
}

function SecurityNote() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What skiffr does with your resume</CardTitle>
        <CardDescription>In plain words.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            <strong>Reads</strong> your base resume and your profile, and sends the text to the AI together with the job
            description you paste.
          </li>
          <li>
            <strong>Never invents.</strong> The AI can reword, reorder and hide. Every suggestion is checked in code
            against what you wrote, and one that adds a company, title, date, degree, skill, tool or number is dropped.
          </li>
          <li>
            <strong>Shows first.</strong> You see every change and the keyword score before a copy is made.
          </li>
          <li>
            <strong>Copies.</strong> Changes go to a new copy. Your base resume is never edited.
          </li>
          <li>
            <strong>Keeps the key safe.</strong> It is encrypted on this server, never sent to your browser and never
            logged.
          </li>
        </ul>
      </CardContent>
    </Card>
  )
}

export function CvSettings({ docsUrl }: { docsUrl: string }) {
  const { data: status } = useSuspenseQuery(orpc.cv.status.queryOptions())
  return (
    <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-3">
      <div className="grid content-start gap-4 lg:col-span-2">
        {!status.configured && (
          <Card>
            <CardHeader>
              <CardTitle>Not set up on this server</CardTitle>
              <CardDescription>
                Whoever runs skiffr has to set CV_ENCRYPTION_KEY, which encrypts the API keys. Until then Reactive
                Resume can't be connected.
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
        {status.configured && !status.aiReady && (
          <Alert role="status">
            <TriangleAlertIcon />
            <AlertTitle>No AI key on this server</AlertTitle>
            <AlertDescription>
              You can connect Reactive Resume, but tailoring needs an AI provider key (GROQ_API_KEY or another) on the
              server.
            </AlertDescription>
          </Alert>
        )}
        {status.configured && status.connected && <Connection status={status} />}
        {status.configured && status.connected && <BaseResume status={status} />}
        {status.configured && <ConnectForm status={status} />}
      </div>
      <div className="grid content-start gap-4 lg:col-span-1">
        <SecurityNote />
      </div>
    </div>
  )
}
