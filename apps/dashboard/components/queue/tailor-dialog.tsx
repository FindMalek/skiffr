"use client"

import { CV_DESCRIPTION_MAX, CV_DESCRIPTION_MIN } from "@skiffr/common/constants"
import type { CvAts, CvChange, CvPreview, Job } from "@skiffr/common/schemas"
import { displayText, safeHref } from "@skiffr/common/utils"
import { errorMessage } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
import { Alert, AlertDescription, AlertTitle } from "@skiffr/ui/components/alert"
import { Badge } from "@skiffr/ui/components/badge"
import { Button, buttonVariants } from "@skiffr/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@skiffr/ui/components/dialog"
import { Field, FieldDescription, FieldLabel } from "@skiffr/ui/components/field"
import { Spinner } from "@skiffr/ui/components/spinner"
import { Textarea } from "@skiffr/ui/components/textarea"
import { useMutation, useQuery } from "@tanstack/react-query"
import { DownloadIcon, ExternalLinkIcon, FileUserIcon, TriangleAlertIcon } from "lucide-react"
import Link from "next/link"
import { type CSSProperties, useState } from "react"
import { diffLines, diffWords, rejectedSummary, reorderedOnly, scoreChange } from "@/lib/cv-copy"
import { keepFocusInside } from "@/lib/keep-focus-inside"

const MISSING_SHOWN = 14

function Words({ before, after }: { before: string; after: string }) {
  return (
    <p className="break-words text-sm leading-relaxed" dir="auto">
      {diffWords(before, after).map((piece, index) =>
        piece.type === "same" ? (
          <span key={index}>{piece.text}</span>
        ) : piece.type === "del" ? (
          <del key={index} className="mr-0.5 bg-destructive/10 px-0.5 text-destructive line-through">
            <span className="sr-only">removed: </span>
            {piece.text}
          </del>
        ) : (
          <ins
            key={index}
            className="bg-primary/15 px-0.5 font-medium underline decoration-primary/60 underline-offset-2"
          >
            <span className="sr-only">added: </span>
            {piece.text}
          </ins>
        ),
      )}
    </p>
  )
}

function Lines({
  title,
  lines,
  removed,
}: {
  title: string
  lines: Array<{ text: string; kept: boolean; moved: boolean }>
  removed: boolean
}) {
  return (
    <div className="min-w-0">
      <h5 className="mb-1 font-medium text-muted-foreground text-xs">{title}</h5>
      <ul className="flex flex-col gap-1 text-sm">
        {lines.map((line, index) => (
          <li
            key={`${index}-${line.text}`}
            dir="auto"
            className={`break-words border-l-2 pl-2 ${
              line.moved
                ? "border-primary"
                : line.kept
                  ? "border-transparent text-muted-foreground"
                  : removed
                    ? "border-destructive"
                    : "border-primary"
            }`}
          >
            {line.moved ? <span className="sr-only">moved: </span> : null}
            {line.kept || line.moved ? null : <span className="sr-only">{removed ? "removed: " : "new: "}</span>}
            {line.text || "(empty)"}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChangeItem({ change }: { change: CvChange }) {
  return (
    <li className="flex flex-col gap-2 border p-3">
      <h4 className="font-medium text-sm" dir="auto">
        {displayText(change.label, 80)}
      </h4>
      {change.kind === "text" && <Words before={change.before[0] ?? ""} after={change.after[0] ?? ""} />}
      {change.kind === "flag" && (
        <p className="text-sm">
          {change.before[0]} <span aria-hidden="true">→</span>
          <span className="sr-only">to</span> <strong>{change.after[0]}</strong>
        </p>
      )}
      {change.kind === "list" && reorderedOnly(change) && (
        <p className="font-medium text-primary text-xs">Same items, new order. The marked ones moved.</p>
      )}
      {change.kind === "list" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Lines title="Before" lines={diffLines(change).before} removed />
          <Lines title="After" lines={diffLines(change).after} removed={false} />
        </div>
      )}
      {change.kind === "order" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <h5 className="mb-1 font-medium text-muted-foreground text-xs">Before</h5>
            <ol className="list-decimal pl-5 text-sm">
              {change.before.map((name, index) => (
                <li key={`${index}-${name}`} dir="auto">
                  {name}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h5 className="mb-1 font-medium text-muted-foreground text-xs">After</h5>
            <ol className="list-decimal pl-5 text-sm">
              {change.after.map((name, index) => (
                <li key={`${index}-${name}`} dir="auto">
                  {name}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </li>
  )
}

function Meter({ label, ats }: { label: string; ats: CvAts }) {
  return (
    <div className="min-w-0 flex-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-heading font-semibold text-2xl tabular-nums">{ats.score}%</dd>
      <div
        role="progressbar"
        aria-label={`${label} keyword match`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ats.score}
        className="mt-1 h-1.5 bg-muted"
      >
        <div className="h-full w-(--w) bg-primary" style={{ "--w": `${ats.score}%` } as CSSProperties} />
      </div>
      <p className="mt-1 text-muted-foreground text-xs">
        {ats.matched.length} of {ats.total} keywords
      </p>
    </div>
  )
}

function Ats({ before, after }: { before: CvAts; after: CvAts }) {
  const missing = after.missing.slice(0, MISSING_SHOWN)
  return (
    <section aria-labelledby="ats-title" className="flex flex-col gap-3 border p-3">
      <h3 id="ats-title" className="font-medium text-sm">
        Keyword match with the posting
      </h3>
      <dl className="flex gap-4">
        <Meter label="Before" ats={before} />
        <Meter label="After" ats={after} />
      </dl>
      <p className="text-sm" role="status">
        {scoreChange(before.score, after.score)}. Counted from the posting's most repeated words, not estimated by the
        AI.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <h4 className="mb-1 font-medium text-muted-foreground text-xs">Matched after</h4>
          <ul className="flex flex-wrap gap-1">
            {after.matched.length === 0 ? (
              <li className="text-muted-foreground text-xs">None</li>
            ) : (
              after.matched.map((word) => (
                <li key={word}>
                  <Badge variant="secondary" dir="auto">
                    {displayText(word, 30)}
                  </Badge>
                </li>
              ))
            )}
          </ul>
        </div>
        <div>
          <h4 className="mb-1 font-medium text-muted-foreground text-xs">Still missing</h4>
          <ul className="flex flex-wrap gap-1">
            {missing.length === 0 ? (
              <li className="text-muted-foreground text-xs">None</li>
            ) : (
              missing.map((word) => (
                <li key={word}>
                  <Badge variant="outline" dir="auto">
                    {displayText(word, 30)}
                  </Badge>
                </li>
              ))
            )}
            {after.missing.length > missing.length && (
              <li className="text-muted-foreground text-xs">+{after.missing.length - missing.length} more</li>
            )}
          </ul>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        {after.score <= before.score
          ? "Reordering and hiding can't add keywords, so the match stays the same or drops (a hidden entry's words no longer count). "
          : "The match went up because a skill from your profile was added. "}
        The copy is your resume reordered, trimmed and partly hidden, not rewritten, and not an ATS booster. A missing
        word is only worth adding if it is true for you, and you do that in Reactive Resume.
      </p>
    </section>
  )
}

function download(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
  const link = document.createElement("a")
  link.href = url
  link.download = `${
    name
      .replace(/[^\p{L}\p{N} _-]+/gu, "")
      .trim()
      .slice(0, 80) || "resume"
  }.pdf`
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function Blocked({ message }: { message: string }) {
  return (
    <Alert role="status">
      <TriangleAlertIcon />
      <AlertTitle>CV tailoring is not ready</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        <Link href="/settings/cv" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })}>
          Open the CV settings
        </Link>
      </AlertDescription>
    </Alert>
  )
}

function Rejected({ rejected }: { rejected: CvPreview["rejected"] }) {
  const lines = rejectedSummary(rejected)
  if (lines.length === 0) return null
  return (
    <Alert role="status">
      <TriangleAlertIcon />
      <AlertTitle>Some suggestions were dropped</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

function Body({ job, onClose }: { job: Job; onClose: () => void }) {
  const status = useQuery({ ...orpc.cv.status.queryOptions(), staleTime: 10_000 })
  const [description, setDescription] = useState("")
  const [preview, setPreview] = useState<CvPreview | null>(null)
  const previewMutation = useMutation(orpc.cv.preview.mutationOptions({ onSuccess: setPreview }))
  const applyMutation = useMutation(orpc.cv.apply.mutationOptions())
  const pdf = useMutation(orpc.cv.pdf.mutationOptions())

  const ready = status.data?.configured && status.data.connected && status.data.baseResume && status.data.aiReady
  const blocked = status.data
    ? !status.data.configured
      ? "This server has no CV key set."
      : !status.data.connected
        ? "Connect Reactive Resume first."
        : !status.data.baseResume
          ? "Pick the base resume first."
          : !status.data.aiReady
            ? "This server has no AI provider key."
            : null
    : null
  const tooShort = description.trim().length < CV_DESCRIPTION_MIN
  const done = applyMutation.data

  const run = (event: React.FormEvent) => {
    event.preventDefault()
    if (!tooShort) previewMutation.mutate({ jobId: job.id, description: description.trim() })
  }

  if (done) {
    const href = safeHref(done.resume.url)
    return (
      <div className="flex min-h-0 flex-col gap-4">
        <Alert role="status">
          <FileUserIcon />
          <AlertTitle>Copy created</AlertTitle>
          <AlertDescription>
            <span dir="auto">{displayText(done.resume.name, 100)}</span> is in your Reactive Resume. Your base resume
            was not changed.
          </AlertDescription>
        </Alert>
        <Ats before={done.before} after={done.after} />
        {pdf.isError && (
          <Alert variant="destructive" role="alert">
            <TriangleAlertIcon />
            <AlertDescription>{errorMessage(pdf.error)}</AlertDescription>
          </Alert>
        )}
        <DialogFooter className="flex-wrap">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button
            variant="outline"
            disabled={pdf.isPending}
            onClick={() =>
              pdf.mutate({ resumeId: done.resume.id }, { onSuccess: (file) => download(file.base64, done.resume.name) })
            }
          >
            {pdf.isPending ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
            {pdf.isPending ? "Preparing…" : "Download PDF"}
          </Button>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
              <ExternalLinkIcon data-icon="inline-start" />
              Open in Reactive Resume
            </a>
          )}
        </DialogFooter>
      </div>
    )
  }

  if (preview) {
    const none = preview.changes.length === 0
    return (
      <div className="flex min-h-0 flex-col gap-4">
        <Ats before={preview.before} after={preview.after} />
        <Rejected rejected={preview.rejected} />
        <section aria-labelledby="changes-title" className="flex flex-col gap-2">
          <h3 id="changes-title" className="font-medium text-sm">
            {none ? "No changes" : `${preview.changes.length} ${preview.changes.length === 1 ? "change" : "changes"}`}
          </h3>
          {none ? (
            <p className="text-muted-foreground text-sm">
              Nothing in your resume needed changing for this posting, or every suggestion would have added something
              new.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {preview.changes.map((change) => (
                <ChangeItem key={change.id} change={change} />
              ))}
            </ul>
          )}
        </section>
        {applyMutation.isError && (
          <Alert variant="destructive" role="alert">
            <TriangleAlertIcon />
            <AlertDescription>{errorMessage(applyMutation.error)}</AlertDescription>
          </Alert>
        )}
        <DialogFooter className="flex-wrap">
          <Button variant="outline" disabled={applyMutation.isPending} onClick={() => setPreview(null)}>
            Back
          </Button>
          <Button
            disabled={none || applyMutation.isPending}
            onClick={() =>
              applyMutation.mutate({
                jobId: job.id,
                description: description.trim(),
                operations: preview.operations,
                baseUpdatedAt: preview.baseUpdatedAt,
              })
            }
          >
            {applyMutation.isPending && <Spinner data-icon="inline-start" />}
            {applyMutation.isPending ? "Creating the copy…" : "Create the copy"}
          </Button>
        </DialogFooter>
        <p className="text-muted-foreground text-xs">
          The copy will be named <span dir="auto">{displayText(preview.copyName, 100)}</span>.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={run} className="flex min-h-0 flex-col gap-4" aria-busy={previewMutation.isPending}>
      {status.isPending ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
          <Spinner /> Checking your Reactive Resume connection…
        </p>
      ) : status.isError ? (
        <Alert variant="destructive" role="alert">
          <TriangleAlertIcon />
          <AlertDescription>{errorMessage(status.error)}</AlertDescription>
        </Alert>
      ) : blocked ? (
        <Blocked message={blocked} />
      ) : null}
      <Field>
        <FieldLabel htmlFor="cv-description">Job description</FieldLabel>
        <Textarea
          id="cv-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={9}
          maxLength={CV_DESCRIPTION_MAX}
          disabled={previewMutation.isPending}
          placeholder="Paste the text of the posting"
          aria-describedby="cv-description-help"
          className="max-h-64"
        />
        <FieldDescription id="cv-description-help">
          Paste the posting. It is only used to decide what to put first: it is never a source of facts about you.{" "}
          <span className="tabular-nums">
            {description.trim().length}/{CV_DESCRIPTION_MAX}
          </span>
        </FieldDescription>
      </Field>
      {previewMutation.isError && (
        <Alert variant="destructive" role="alert">
          <TriangleAlertIcon />
          <AlertDescription>{errorMessage(previewMutation.error)}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || tooShort || previewMutation.isPending}>
          {previewMutation.isPending && <Spinner data-icon="inline-start" />}
          {previewMutation.isPending ? "Reading your resume…" : "Preview changes"}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Tailors the base resume to a queued job: paste the posting, read every change and the keyword score, then make the copy. Nothing is written until the last button. */
export function TailorDialog({ job, onClose }: { job: Job | null; onClose: () => void }) {
  return (
    <Dialog open={job !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent onKeyDown={keepFocusInside} className="max-h-11/12 w-full gap-4 overflow-y-auto sm:max-w-3xl">
        {job && (
          <>
            <DialogHeader>
              <DialogTitle>Tailor your CV</DialogTitle>
              <DialogDescription>
                <span dir="auto">
                  {displayText(job.title, 80)}, {displayText(job.company, 40)}
                </span>
              </DialogDescription>
            </DialogHeader>
            <Body key={job.id} job={job} onClose={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
