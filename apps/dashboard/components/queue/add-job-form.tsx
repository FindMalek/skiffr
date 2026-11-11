"use client"

import { SHORT_TEXT_MAX, URL_MAX } from "@skiffr/common/constants"
import { CREDENTIALS_MESSAGE, type Job, jobUrlSchema, NOT_PUBLIC_MESSAGE } from "@skiffr/common/schemas"
import { linkHost } from "@skiffr/common/utils"
import { errorMessage } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Field, FieldGroup, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useRef, useState } from "react"
import { STATUS_LABEL } from "@/lib/queue"
import { SafeText } from "./job-text"
import { useQueueApi } from "./queue-api"

type Result = { kind: "added" | "duplicate"; job: Job } | { kind: "error"; message: string } | null

const URL_HELP = "Enter a full web address that starts with http:// or https://, like https://company.com/jobs/123."
const OWN_MESSAGES = new Set([CREDENTIALS_MESSAGE, NOT_PUBLIC_MESSAGE, "Control characters are not allowed."])

export function AddJobForm({ announce }: { announce: (message: string) => void }) {
  const api = useQueueApi()
  const queryClient = useQueryClient()
  const sending = useRef(false)
  const urlField = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending.current) return
    const form = event.currentTarget
    const data = new FormData(form)
    const raw = String(data.get("url") ?? "")
    const parsed = jobUrlSchema.safeParse(raw)
    if (!parsed.success) {
      const own = parsed.error.issues.map((issue) => issue.message).find((message) => OWN_MESSAGES.has(message))
      // `http://localhost/` and `http://10.0.0.1/` do start with http: say the address is the problem.
      setResult({
        kind: "error",
        message: own ?? (/^https?:\/\/\S+$/i.test(raw.trim()) ? NOT_PUBLIC_MESSAGE : URL_HELP),
      })
      urlField.current?.focus()
      return
    }
    sending.current = true
    setPending(true)
    setResult(null)
    try {
      const created = await api.create({
        url: parsed.data,
        title: String(data.get("title") ?? "").trim() || "Untitled role",
        company: String(data.get("company") ?? "").trim() || (linkHost(parsed.data) ?? "Unknown company"),
      })
      if (created.created) {
        form.reset()
        announce("Added to the queue.")
      } else announce("That job was already saved. Nothing was added.")
      setResult({ kind: created.created ? "added" : "duplicate", job: created })
      void queryClient.invalidateQueries({ queryKey: orpc.jobs.key() })
    } catch (error) {
      setResult({ kind: "error", message: errorMessage(error) })
      urlField.current?.focus()
    } finally {
      sending.current = false
      setPending(false)
    }
  }

  const failed = result?.kind === "error"
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a job</CardTitle>
        <CardDescription>
          Paste the link of a job you want to apply to. Only http and https links are accepted.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate>
          <FieldGroup className="gap-3 md:grid md:grid-cols-5 md:items-end">
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="job-url">Job link</FieldLabel>
              <Input
                id="job-url"
                name="url"
                ref={urlField}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://company.com/jobs/123"
                aria-invalid={failed}
                aria-describedby="job-url-result"
                maxLength={URL_MAX}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="job-title">Title (optional)</FieldLabel>
              <Input id="job-title" name="title" autoComplete="off" maxLength={SHORT_TEXT_MAX} />
            </Field>
            <Field>
              <FieldLabel htmlFor="job-company">Company (optional)</FieldLabel>
              <Input id="job-company" name="company" autoComplete="off" maxLength={SHORT_TEXT_MAX} />
            </Field>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add to queue"}
            </Button>
          </FieldGroup>
          <div id="job-url-result" className="min-h-5 pt-2 text-xs" role={failed ? "alert" : "status"}>
            {result?.kind === "error" && <p className="text-destructive">{result.message}</p>}
            {result?.kind === "added" && (
              <p className="text-muted-foreground">
                Added <SafeText value={result.job.title} max={80} /> at <SafeText value={result.job.company} max={40} />
                .
              </p>
            )}
            {result?.kind === "duplicate" && (
              <p>
                Already saved as <SafeText value={result.job.title} max={80} /> at{" "}
                <SafeText value={result.job.company} max={40} /> ({STATUS_LABEL[result.job.status].toLowerCase()}).
                Nothing was added.
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
