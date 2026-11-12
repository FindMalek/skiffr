import {
  BookMarkedIcon,
  ChartNoAxesColumnIcon,
  FileTextIcon,
  InboxIcon,
  KeyRoundIcon,
  ListChecksIcon,
  type LucideIcon,
  MailIcon,
  MousePointerClickIcon,
  RadarIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
  ZapIcon,
} from "lucide-react"

type Feature = { icon: LucideIcon; title: string; text: string }

const TODAY: Feature[] = [
  {
    icon: ZapIcon,
    title: "Detect and ask",
    text: "Recognizes application forms on common ATS sites, also in iframes, and shows a small toast. Say yes, no, or never on that site. The shortcut fills without asking.",
  },
  {
    icon: MousePointerClickIcon,
    title: "Framework-safe fill",
    text: "Sets React and Vue controlled inputs, selects and comboboxes, through shadow DOM and same-origin iframes, and skips honeypots. Uncertain fields are outlined for you to check.",
  },
  {
    icon: RefreshCwIcon,
    title: "Learns from your edits",
    text: "After a fill, what you corrected or cleared is recorded and used first next time. Sensitive fields are never recorded.",
  },
  {
    icon: BookMarkedIcon,
    title: "Answer bank",
    text: "Edit saved answers per question, with use and correction counts and keep or drop suggestions. A saved answer beats a model guess.",
  },
  {
    icon: ListChecksIcon,
    title: "Field mapping",
    text: "Optional. A language model matches unfamiliar fields to your profile keys. It cannot invent a key, and cannot see contact details or pay.",
  },
  {
    icon: InboxIcon,
    title: "Job queue",
    text: "Add jobs by link, work through them in order with Open next, mark them applied or skipped. You press submit yourself.",
  },
  {
    icon: MailIcon,
    title: "Gmail job alerts",
    text: "Optional. LinkedIn, Indeed and Glassdoor alert emails become queued jobs. Processed mail is marked read, archived and labelled, never deleted. Needs your own Google OAuth client.",
  },
  {
    icon: RadarIcon,
    title: "Source watcher",
    text: "Watch a careers page, a feed or a Greenhouse, Lever, Ashby or Workable board and queue new postings. Public pages only.",
  },
  {
    icon: ChartNoAxesColumnIcon,
    title: "Funnel stats",
    text: "Applications over time, queue funnel, replies, by source, ATS and role, and how well autofill knows you.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Never submits",
    text: "It does not submit a form, click submit, next or apply, or touch password and hidden fields. You review and press the button.",
  },
  {
    icon: ServerIcon,
    title: "Self-hosted",
    text: "One Dockerfile per app, a Postgres with pgvector, and a Dokploy deploy workflow. No hosted service, no account with us.",
  },
  {
    icon: KeyRoundIcon,
    title: "Scoped tokens",
    text: "The extension uses a personal token, stored hashed on the server. It can only call a short list of procedures.",
  },
]

const NEXT: Feature[] = [
  { icon: MousePointerClickIcon, title: "ATS adapters", text: "Planned." },
  { icon: RefreshCwIcon, title: "Learned HTTP replay", text: "Planned." },
  { icon: FileTextIcon, title: "CV tailoring", text: "Planned. Edits only, never invented facts." },
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
          What works today
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          skiffr is in early development. This is what is on the main branch. The language model, Gmail and embeddings
          are optional and need your own keys.
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
