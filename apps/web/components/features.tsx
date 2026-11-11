import {
  BookMarkedIcon,
  ChartNoAxesColumnIcon,
  FileTextIcon,
  KeyRoundIcon,
  ListChecksIcon,
  type LucideIcon,
  MailIcon,
  MapIcon,
  MousePointerClickIcon,
  RefreshCwIcon,
  UserRoundIcon,
} from "lucide-react"

type Feature = { icon: LucideIcon; title: string; text: string }

const TODAY: Feature[] = [
  {
    icon: MousePointerClickIcon,
    title: "Framework-safe fill engine",
    text: "Sets React and Vue controlled inputs, selects and comboboxes, through shadow DOM and same-origin iframes, and skips honeypots. Tested on fixture pages, not connected to the extension yet.",
  },
  {
    icon: UserRoundIcon,
    title: "Your profile, your database",
    text: "Edit your profile in the dashboard. It lives in your own Postgres, behind your own api.",
  },
  {
    icon: BookMarkedIcon,
    title: "Answer bank",
    text: "Saved answers are stored per question, with use and correction counts.",
  },
  {
    icon: RefreshCwIcon,
    title: "Learning API",
    text: "A correction log, answer lookup and keep or drop suggestions. The extension does not send corrections yet.",
  },
  {
    icon: ListChecksIcon,
    title: "Field mapping",
    text: "A language model matches unfamiliar fields to your profile keys. It cannot invent a key, and cannot see contact details or pay.",
  },
  {
    icon: KeyRoundIcon,
    title: "Scoped tokens",
    text: "The extension uses a personal token, stored hashed on the server. It can only call a short list of procedures.",
  },
]

const NEXT: Feature[] = [
  { icon: MousePointerClickIcon, title: "Form detection and toast", text: "In review." },
  { icon: RefreshCwIcon, title: "The whole loop in the browser", text: "Planned. Detect, fill and learn, connected." },
  { icon: MailIcon, title: "Gmail job alerts to a queue", text: "Planned." },
  { icon: MapIcon, title: "Per-site learned field maps", text: "Planned." },
  { icon: FileTextIcon, title: "CV tailoring", text: "Planned. Edits only, never invented facts." },
  { icon: ChartNoAxesColumnIcon, title: "Funnel stats", text: "Planned." },
]

function Item({ icon: Icon, title, text, muted }: Feature & { muted?: boolean }) {
  return (
    <li className={muted ? "flex gap-3 border border-dashed p-4" : "flex gap-3 border bg-card p-4"}>
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div>
        <h3 className="font-medium text-sm">{title}</h3>
        <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{text}</p>
      </div>
    </li>
  )
}

export function Features() {
  return (
    <section aria-labelledby="features-title" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="features-title" className="font-heading font-semibold text-3xl tracking-tight">
          What exists today
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          skiffr is in early development. These pieces are built and tested, but they are not connected into a working
          extension yet.
        </p>
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TODAY.map((feature) => (
            <Item key={feature.title} {...feature} />
          ))}
        </ul>
        <h3 className="mt-14 font-heading font-semibold text-xl tracking-tight">Coming next</h3>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NEXT.map((feature) => (
            <Item key={feature.title} {...feature} muted />
          ))}
        </ul>
      </div>
    </section>
  )
}
