"use client"

import { NOTE_TITLE_MAX } from "@skiffr/common/constants"
import { errorMessage } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { Field, FieldGroup, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { Textarea } from "@skiffr/ui/components/textarea"
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { PinIcon, PinOffIcon, Trash2Icon } from "lucide-react"
import { type FormEvent, useRef } from "react"
import { toast } from "sonner"
import { LocalDate } from "./local-date"
import { SummarizeButton } from "./summarize-button"

export function NotesBoard() {
  const queryClient = useQueryClient()
  const { data: notes } = useSuspenseQuery(orpc.notes.list.queryOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.notes.key() })
  const onError = (error: Error) => toast.error(errorMessage(error))

  const form = useRef<HTMLFormElement>(null)
  const create = useMutation(
    orpc.notes.create.mutationOptions({
      onSuccess: () => {
        form.current?.reset()
        return refresh()
      },
      onError,
    }),
  )
  const update = useMutation(orpc.notes.update.mutationOptions({ onSuccess: refresh, onError }))
  const remove = useMutation(orpc.notes.remove.mutationOptions({ onSuccess: refresh, onError }))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    create.mutate({ title: String(data.get("title")), body: String(data.get("body") ?? "") })
  }

  return (
    <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-3">
      <Card className="self-start">
        <CardHeader>
          <CardTitle>New note</CardTitle>
        </CardHeader>
        <CardContent>
          <form ref={form} onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="title">Title</FieldLabel>
                <Input id="title" name="title" required maxLength={NOTE_TITLE_MAX} />
              </Field>
              <Field>
                <FieldLabel htmlFor="body">Body</FieldLabel>
                <Textarea id="body" name="body" rows={4} />
              </Field>
              <Button type="submit" disabled={create.isPending}>
                Add note
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <div className="grid content-start gap-4 md:grid-cols-2 lg:col-span-2">
        {notes.map((note) => (
          <Card key={note.id}>
            <CardHeader>
              <CardTitle>{note.title}</CardTitle>
              <CardDescription>
                <LocalDate value={note.updatedAt} time />
              </CardDescription>
              <CardAction className="flex gap-1">
                <SummarizeButton id={note.id} />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={note.pinned ? "Unpin" : "Pin"}
                  onClick={() => update.mutate({ id: note.id, pinned: !note.pinned })}
                >
                  {note.pinned ? <PinOffIcon /> : <PinIcon />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete"
                  onClick={() => remove.mutate({ id: note.id })}
                >
                  <Trash2Icon />
                </Button>
              </CardAction>
            </CardHeader>
            {note.body && <CardContent className="text-muted-foreground text-sm">{note.body}</CardContent>}
          </Card>
        ))}
        {!notes.length && (
          <Empty className="border md:col-span-2">
            <EmptyHeader>
              <EmptyTitle>No notes yet</EmptyTitle>
              <EmptyDescription>Write the first one on the left.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
