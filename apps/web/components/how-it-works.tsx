import { MockForm, type MockStep } from "./mock-form"

const STEPS: { step: MockStep; title: string; text: string }[] = [
  {
    step: "detect",
    title: "Detect",
    text: "When a page looks like a job application, a small toast asks if you want it filled. Say no and it stays quiet on that page.",
  },
  {
    step: "fill",
    title: "Fill",
    text: "Your profile and saved answers go into the form the way a person would type them, so React and Vue forms accept them. Passwords, hidden fields and honeypots are skipped, and nothing is submitted.",
  },
  {
    step: "learn",
    title: "Learn",
    text: "Fix a value and the fix is logged as a correction. Next time the better answer is used first, and skiffr tells you which learned answers are worth keeping.",
  },
]

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="how-title" className="font-heading font-semibold text-3xl tracking-tight">
          How it works
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Three steps, repeated on every application. The drawings below are illustrations, not screenshots.
        </p>
        <ol className="mt-10 grid gap-8 md:grid-cols-3">
          {STEPS.map(({ step, title, text }, index) => (
            <li key={step} className="flex flex-col gap-4">
              <MockForm step={step} />
              <div>
                <h3 className="font-medium text-lg">
                  <span className="mr-2 font-mono text-muted-foreground">{index + 1}</span>
                  {title}
                </h3>
                <p className="mt-1.5 text-muted-foreground text-sm leading-relaxed">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
