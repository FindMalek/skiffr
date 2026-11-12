import { cn } from "@skiffr/ui/lib/utils"
import { CheckIcon } from "lucide-react"

export type MockStep = "detect" | "fill"

const VALUES = { name: "Ada Example", email: "ada@example.com" }

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className={cn("flex h-8 items-center border bg-background px-2 text-xs", value && "border-foreground/40")}>
        {value ? <span>{value}</span> : <span className="h-1.5 w-1/3 bg-muted-foreground/25" />}
      </div>
    </div>
  )
}

function Toast() {
  return (
    <div className="absolute right-3 bottom-12 w-52 border bg-popover p-3 text-popover-foreground shadow-md">
      <p className="font-medium text-xs">Autofill this application?</p>
      <div className="mt-2.5 flex gap-1.5">
        <span className="inline-flex h-6 items-center bg-primary px-2 text-primary-foreground text-xs">Yes</span>
        <span className="inline-flex h-6 items-center border px-2 text-xs">No</span>
      </div>
    </div>
  )
}

const NOTES: Record<MockStep, string> = {
  detect: "Form found. It asks first.",
  fill: "Fields filled. Nothing submitted.",
}

/** A static drawing of a form and the toast. Not a screenshot, and it does nothing. */
export function MockForm({ step, className }: { step: MockStep; className?: string }) {
  const filled = step === "fill"
  return (
    <div aria-hidden className={cn("relative flex flex-col border bg-card text-card-foreground shadow-sm", className)}>
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="ml-2 truncate font-mono text-muted-foreground text-xs">jobs.example.com/apply</span>
      </div>
      <div className={cn("flex flex-col gap-3 p-4", filled ? "pb-14" : "pb-32")}>
        <Field label="Full name" value={filled ? VALUES.name : undefined} />
        <Field label="Email" value={filled ? VALUES.email : undefined} />
        <Field label="Why do you want this role?" value={filled ? "I enjoy building tools." : undefined} />
        <span className="inline-flex h-8 w-24 items-center justify-center border text-muted-foreground text-xs">
          Submit
        </span>
      </div>
      {!filled && <Toast />}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 border-t bg-muted px-3 py-2 text-foreground text-xs">
        {filled && <CheckIcon className="size-3" />}
        {NOTES[step]}
      </div>
    </div>
  )
}
