import { docsHref } from "@/lib/seo"

const POINTS = [
  {
    title: "Your data stays on your server",
    text: "Profile, answers and tokens are in your own Postgres. The extension is built to talk only to the api you point it at, and has no analytics.",
  },
  {
    title: "The model sees a small slice",
    text: "Field labels, your profile key names, and values for a short allowlist such as name, city, links and skills. Email, phone, address, pay and ids are never sent.",
  },
  {
    title: "Embeddings use questions only",
    text: "Similar-question matching embeds the question label, never your answer. It is optional and needs an OpenAI key.",
  },
  {
    title: "Nothing is submitted for you",
    text: "The fill engine never submits a form or clicks submit, next or apply buttons, and never touches password or hidden inputs. It sets a file only on a resume or CV slot, and only when handed one. You review, you press the button.",
  },
  {
    title: "Sensitive fields are not learned",
    text: "Labels for secrets, cards, bank and government ids, birth dates and equal opportunity data are skipped, and so are values that look like a card number, an IBAN or a US social security number.",
  },
  {
    title: "The learning log is bounded",
    text: "It keeps raw labels and the filled and final values per user. Events older than 90 days are deleted when learning is next used, and they go with your account.",
  },
]

export function PrivacySection() {
  return (
    <section aria-labelledby="privacy-title" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="privacy-title" className="font-heading font-semibold text-3xl tracking-tight">
          Privacy first
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          These are the rules the code follows. The extension does not fill pages yet, so none of this has reached a
          real application.
        </p>
        <dl className="mt-8 grid gap-x-10 gap-y-6 md:grid-cols-2">
          {POINTS.map(({ title, text }) => (
            <div key={title}>
              <dt className="font-medium">{title}</dt>
              <dd className="mt-1 text-muted-foreground text-sm leading-relaxed">{text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-sm">
          <a
            href={docsHref("privacy")}
            className="underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Read exactly what leaves your machine
          </a>
        </p>
      </div>
    </section>
  )
}
