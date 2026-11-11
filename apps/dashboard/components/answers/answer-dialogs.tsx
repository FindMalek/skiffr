"use client"

import { ANSWER_VALUE_MAX, LABEL_MAX } from "@skiffr/common/constants"
import type { Answer } from "@skiffr/common/schemas"
import { answerInputSchema, answerUpdateSchema } from "@skiffr/common/schemas"
import { normalizeLabel } from "@skiffr/common/utils"
import { errorMessage } from "@skiffr/orpc/errors"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@skiffr/ui/components/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { Textarea } from "@skiffr/ui/components/textarea"
import { PlusIcon } from "lucide-react"
import { type FormEvent, useState } from "react"
import { plainLabel, SafeText } from "./safe-text"
import { useBank, useRemove, useSave } from "./use-answers"

function FormError({ message }: { message: string | null }) {
  return (
    <p role="alert" className="min-h-0 text-destructive text-xs">
      {message}
    </p>
  )
}

export function AddAnswerDialog() {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState("")
  const [value, setValue] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const { data: bank } = useBank()
  const { create } = useSave(() => setOpen(false))

  const key = normalizeLabel(label)
  const replaces = key ? bank?.find((row) => row.normalizedLabel === key) : undefined

  const change = (next: boolean) => {
    if (create.isPending) return
    setOpen(next)
    if (next) {
      setLabel("")
      setValue("")
      setProblem(null)
      create.reset()
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = answerInputSchema.safeParse({ rawLabel: label, value })
    if (!parsed.success) return setProblem(parsed.error.issues[0]?.message ?? "Check the question and the answer.")
    if (!key) return setProblem("The question needs a letter or a digit.")
    setProblem(null)
    create.mutate({ rawLabel: parsed.data.rawLabel, value: parsed.data.value })
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger render={<Button />}>
        <PlusIcon data-icon="inline-start" />
        Add answer
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add an answer</DialogTitle>
            <DialogDescription>
              skiffr fills it when a form asks this question. Saved answers are marked confirmed.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="add-answer-label">Question</FieldLabel>
              <Input
                id="add-answer-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={LABEL_MAX}
                required
                autoComplete="off"
                placeholder="Are you authorized to work in the US?"
              />
              {replaces && (
                <FieldDescription role="status">
                  This replaces your answer for <SafeText text={replaces.rawLabel} lines={1} className="inline" />.
                </FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="add-answer-value">Answer</FieldLabel>
              <Textarea
                id="add-answer-value"
                dir="auto"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                maxLength={ANSWER_VALUE_MAX}
                rows={4}
              />
            </Field>
          </FieldGroup>
          <FormError message={problem ?? (create.error ? errorMessage(create.error) : null)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => change(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save answer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditAnswerDialog({ answer, onClose }: { answer: Answer | null; onClose: () => void }) {
  // The form lives in its own component so each opening starts from the answer's current value.
  return (
    <Dialog open={answer !== null} onOpenChange={(next) => !next && onClose()}>
      {answer && <EditForm key={answer.id} answer={answer} onClose={onClose} />}
    </Dialog>
  )
}

function EditForm({ answer, onClose }: { answer: Answer; onClose: () => void }) {
  const [value, setValue] = useState(answer.value)
  const [problem, setProblem] = useState<string | null>(null)
  const { update } = useSave(onClose)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const parsed = answerUpdateSchema.shape.value.safeParse(value)
    if (!parsed.success) return setProblem(parsed.error.issues[0]?.message ?? "Check the answer.")
    setProblem(null)
    update.mutate({ id: answer.id, value })
  }

  return (
    <DialogContent>
      <form onSubmit={submit} className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Edit answer</DialogTitle>
          <DialogDescription>Saving by hand marks it confirmed, so skiffr keeps using it.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>Question</FieldLabel>
            <SafeText text={answer.rawLabel} lines={3} className="font-medium text-sm" />
          </Field>
          <Field>
            <FieldLabel htmlFor="edit-answer-value">Answer</FieldLabel>
            <Textarea
              id="edit-answer-value"
              dir="auto"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              maxLength={ANSWER_VALUE_MAX}
              rows={5}
            />
          </Field>
        </FieldGroup>
        <FormError message={problem ?? (update.error ? errorMessage(update.error) : null)} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending || value === answer.value}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

export function DeleteAnswerDialog({
  answer,
  onClose,
}: {
  answer: Answer | null
  onClose: (deleted: boolean) => void
}) {
  const remove = useRemove()
  // The last answer shown is kept while the dialog animates out.
  const [last, setLast] = useState(answer)
  if (answer && answer !== last) setLast(answer)
  const target = answer ?? last
  return (
    <AlertDialog open={answer !== null} onOpenChange={(next) => !next && onClose(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this answer?</AlertDialogTitle>
          <AlertDialogDescription>
            {target ? plainLabel(target.rawLabel, 120) : ""}
            <br />
            skiffr stops filling it. If you correct that field again it learns a new answer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              if (!answer) return
              remove.mutate({ id: answer.id })
              onClose(true)
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
