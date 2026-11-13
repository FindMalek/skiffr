import Link from "next/link"
import { NEVER_FILLED } from "@/lib/profile-copy"

/** The trust list: sensitive questions the extension skips on every site. The guard is `apps/extension/lib/fill/sensitive.ts`. */
export function NeverFilled() {
  return (
    <section id="never-filled" aria-labelledby="never-filled-title" className="flex scroll-mt-4 flex-col gap-4 py-8">
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="never-filled-title" className="font-heading font-semibold text-base">
          Fields skiffr never fills
        </h2>
        <p className="text-muted-foreground text-sm">
          A check in the extension skips these on every site, whatever your profile holds, and never saves them as
          answers. It reads the wording of the question, so an unusual phrasing can slip through: look over what was
          filled before you submit. skiffr never presses submit, next or apply.
        </p>
      </div>
      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {NEVER_FILLED.map((item) => (
          <li key={item.title} className="flex flex-col gap-0.5 text-sm">
            <span className="font-medium">{item.title}</span>
            <span className="text-muted-foreground text-xs">{item.detail}</span>
          </li>
        ))}
      </ul>
      <p className="max-w-prose text-muted-foreground text-xs">
        To delete the whole profile, open{" "}
        <Link href="/settings/privacy" className="text-foreground underline underline-offset-4">
          Data and privacy
        </Link>
        .
      </p>
    </section>
  )
}
