import { docsUrl } from "@/lib/seo"

const POINTS = [
  {
    title: "Your data stays on your server",
    text: "Profile, answers and tokens are in your own Postgres. The extension talks only to the api you point it at, and has no analytics.",
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
    text: "The fill engine never clicks submit and never touches password, hidden or file inputs. You review, you press the button.",
  },
]

export function PrivacySection() {
  return (
    <section aria-labelledby="privacy-title" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="privacy-title" className="font-heading font-semibold text-3xl tracking-tight">
          Privacy first
        </h2>
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
            href={`${docsUrl()}/docs/privacy`}
            className="underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Read exactly what leaves your machine
          </a>
        </p>
      </div>
    </section>
  )
}
