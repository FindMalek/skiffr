import {
  BookMarkedIcon,
  ChartNoAxesColumnIcon,
  FileTextIcon,
  GlobeIcon,
  KeyRoundIcon,
  ListChecksIcon,
  type LucideIcon,
  MailIcon,
  MapIcon,
  MousePointerClickIcon,
  UserRoundIcon,
} from "lucide-react"

type Feature = { icon: LucideIcon; title: string; text: string }

const TODAY: Feature[] = [
  {
    icon: MousePointerClickIcon,
    title: "Framework-safe fill engine",
    text: "Sets React and Vue controlled inputs, selects and comboboxes so the page registers the value.",
  },
  {
    icon: GlobeIcon,
    title: "Shadow DOM and iframes",
    text: "Finds fields inside open shadow roots and same-origin iframes, and skips honeypot fields a person cannot see.",
  },
  {
    icon: UserRoundIcon,
    title: "Your profile, your database",
    text: "Edit your profile in the dashboard. It lives in your own Postgres, behind your own api.",
  },
  {
    icon: BookMarkedIcon,
    title: "Answer bank",
    text: "Saved answers are stored per question, with use and correction counts, ready for the learning step.",
  },
  {
    icon: ListChecksIcon,
    title: "Field mapping",
    text: "A language model matches unfamiliar fields to your profile keys. It cannot invent a key, and cannot see contact details or pay.",
  },
  {
    icon: KeyRoundIcon,
    title: "Scoped tokens",
    text: "The extension uses a personal token, stored hashed on the server and out of reach of web pages and content scripts.",
  },
]

const NEXT: Feature[] = [
  { icon: MousePointerClickIcon, title: "Form detection and toast", text: "In review." },
  { icon: ListChecksIcon, title: "Learning from corrections", text: "In review." },
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
          skiffr is pre-release. These pieces are built and tested, but the extension does not run the whole loop in the
          browser yet.
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
