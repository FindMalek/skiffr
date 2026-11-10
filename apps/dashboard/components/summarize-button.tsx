"use client"

import { errorMessage } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
import { Button } from "@skiffr/ui/components/button"
import { useMutation } from "@tanstack/react-query"
import { SparklesIcon } from "lucide-react"
import { toast } from "sonner"

export function SummarizeButton({ id }: { id: string }) {
  const summarize = useMutation(
    orpc.notes.summarize.mutationOptions({
      onSuccess: ({ summary }) => toast(summary),
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Summarize" onClick={() => summarize.mutate({ id })}>
      <SparklesIcon />
    </Button>
  )
}
