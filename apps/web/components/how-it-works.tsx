import { LoopIllustration } from "./loop-illustration"
import { MockForm } from "./mock-form"

const STEPS = [
  {
    title: "Detect",
    state: "Planned, in review",
    text: "A page that looks like a job application would show a small toast asking whether to fill it. Saying no would keep it quiet on that page.",
    art: <MockForm step="detect" />,
  },
  {
    title: "Fill",
    state: "Engine built, not connected",
    text: "Your profile and saved answers would be put into the form the way a person types them, so React and Vue forms accept them. Passwords and hidden fields are skipped, honeypots ignored, and the form is never submitted.",
    art: <MockForm step="fill" />,
  },
  {
    title: "Learn",
    state: "API built, extension side planned",
    text: "A fix you make would be logged as a correction, and the better answer used first next time. skiffr would also tell you which learned answers are worth keeping.",
    art: <LoopIllustration />,
  },
]

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="how-title" className="font-heading font-semibold text-3xl tracking-tight">
          How it is meant to work
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          This is the design, not what runs in a browser today. The drawings are illustrations, not screenshots.
        </p>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {STEPS.map(({ title, state, text, art }, index) => (
            <li key={title} className="flex flex-col gap-4">
              {art}
              <div>
                <h3 className="font-medium text-lg">
                  <span className="mr-2 font-mono text-muted-foreground">{index + 1}</span>
                  {title}
                </h3>
                <p className="mt-0.5 font-mono text-muted-foreground text-xs uppercase tracking-wide">{state}</p>
                <p className="mt-2 text-muted-foreground text-sm leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
