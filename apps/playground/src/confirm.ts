import { esc } from "./html.ts"
import { shell } from "./pages/shell.ts"
import type { Submission } from "./submissions.ts"

const WORDS: Record<string, { title: string; text: string }> = {
  greenhouse: {
    title: "Thank you for applying.",
    text: "Your application has been submitted. We will be in touch if there is a match.",
  },
  "greenhouse-legacy": { title: "Thank you for applying.", text: "Your application has been submitted." },
  lever: { title: "Application submitted!", text: "Thanks for your interest in Acme. We received your application." },
  ashby: { title: "Your application was successfully submitted.", text: "We will review it and follow up by email." },
  workable: { title: "Thank you!", text: "Your application was submitted. You will receive a confirmation email." },
  linkedin: { title: "Your application was sent to Acme", text: "Applied just now. You can track it under My jobs." },
  workday: {
    title: "Application Submitted",
    text: "Thank you for applying. A confirmation was sent to your email address.",
  },
  personio: { title: "Application sent", text: "Thank you for your application. We will get back to you soon." },
}

const FALLBACK = { title: "Thank you for your application", text: "We received it and will get back to you." }

export function confirmationPage(submission: Submission): string {
  const words = WORDS[submission.site] ?? FALLBACK
  const red = submission.counts.sensitiveTouched + submission.counts.trapTouched > 0
  return shell({
    title: `${words.title} - Acme`,
    body: `<main class="wrap" data-confirmation="${esc(submission.id)}"><h1>${esc(words.title)}</h1><p>${esc(words.text)}</p>
<p>Reference <strong>APP-${esc(submission.id.toUpperCase())}</strong></p>
<hr><p style="font-size:13px;color:#555">Playground page. This submission was recorded in memory on this server and sent nowhere else.
<a href="/inspect?${submission.run ? `run=${encodeURIComponent(submission.run)}&` : ""}id=${esc(submission.id)}">See what was filled</a>${red ? " (a sensitive field was touched)" : ""}.</p></main>`,
  })
}
