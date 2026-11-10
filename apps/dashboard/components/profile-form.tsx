"use client"

import { PROFILE_NAME_MAX } from "@skiffr/common/constants"
import { errorMessage } from "@skiffr/orpc/errors"
import { orpc } from "@skiffr/orpc/react"
import { Avatar, AvatarFallback, AvatarImage } from "@skiffr/ui/components/avatar"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@skiffr/ui/components/field"
import { Input } from "@skiffr/ui/components/input"
import { useMutation } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import type { FormEvent } from "react"
import { useRef } from "react"
import { toast } from "sonner"

export function ProfileForm({ me }: { me: { name: string; email: string; image: string | null } }) {
  const router = useRouter()
  const file = useRef<HTMLInputElement>(null)
  const onError = (error: Error) => toast.error(errorMessage(error))
  const save = useMutation(
    orpc.me.update.mutationOptions({
      onSuccess: () => {
        toast.success("Saved")
        router.refresh()
      },
      onError,
    }),
  )
  const avatar = useMutation(orpc.me.avatar.mutationOptions({ onSuccess: () => router.refresh(), onError }))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate({ name: String(new FormData(event.currentTarget).get("name")) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            <div className="flex items-center gap-4">
              <Avatar className="size-14">
                {me.image && <AvatarImage src={me.image} alt="" />}
                <AvatarFallback>{me.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <input
                ref={file}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files?.[0]
                  if (picked) avatar.mutate({ file: picked })
                }}
              />
              <Button type="button" variant="outline" disabled={avatar.isPending} onClick={() => file.current?.click()}>
                Change picture
              </Button>
            </div>
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input id="name" name="name" defaultValue={me.name} required maxLength={PROFILE_NAME_MAX} />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" defaultValue={me.email} disabled />
              <FieldDescription>Signed in with this address.</FieldDescription>
            </Field>
            <Button type="submit" className="self-start" disabled={save.isPending}>
              Save
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
