import { ArrowDownIcon } from "lucide-react"

const STEPS = [
  { title: "It fills", text: "from your profile and saved answers" },
  { title: "You edit", text: "the values that are wrong" },
  { title: "It learns", text: "your edit becomes the answer for that question" },
  { title: "Fewer edits", text: "on the next application" },
]

/** A diagram of the learning loop. Not a screenshot and not real data. */
export function LoopIllustration() {
  return (
    <div aria-hidden className="flex flex-col border bg-card p-4 text-card-foreground shadow-sm">
      {STEPS.map(({ title, text }, index) => (
        <div key={title} className="flex flex-col items-center">
          <div className="w-full border px-3 py-2">
            <p className="font-medium text-xs">{title}</p>
            <p className="text-muted-foreground text-xs">{text}</p>
          </div>
          {index < STEPS.length - 1 && <ArrowDownIcon className="my-1 size-3 text-muted-foreground" />}
        </div>
      ))}
    </div>
  )
}
