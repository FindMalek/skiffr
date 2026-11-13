/**
 * What each profile field is for and where it goes. The claim must match the code: `packages/ai/src/shared-keys.ts`
 * is the allowlist of values a model provider can see, and `apps/docs/content/docs/privacy.mdx` lists it. Change them together.
 */
export const STAYS = "Only used to fill forms. Stays on your server."
export const MODEL = "Only used to fill forms. Your AI provider may see it to map a field."

export const HELP = {
  firstName: `The first name field of an application. ${MODEL}`,
  lastName: `The last name or surname field. ${MODEL}`,
  email: `The email field of an application. ${STAYS}`,
  phone: `The phone field. ${STAYS}`,
  linkedin: `Fills the LinkedIn field. ${MODEL}`,
  github: `Fills the GitHub field. ${MODEL}`,
  portfolio: `Fills the portfolio field. ${MODEL}`,
  website: `Fills the personal website field. ${MODEL}`,
  otherLinks: `Fills other link fields, such as a blog or a design profile. Up to 10. ${MODEL}`,
  countries: `Answers "Are you authorized to work in...?" for each country. Separate countries with commas. ${MODEL}`,
  sponsorship: `Answers "Will you need visa sponsorship?". Not specified leaves the question empty. ${MODEL}`,
  visaStatus: `For questions about your visa or work permit, such as "Citizen" or "Work visa". ${MODEL}`,
  currency: `The currency of the salary fields. ${STAYS}`,
  period: `Whether the amounts are per hour, month or year. ${STAYS}`,
  salaryMin: `The lowest pay you would take, in whole numbers. Fills expected salary fields. ${STAYS}`,
  salaryMax: `The top of your range, in whole numbers. ${STAYS}`,
  city: `The city field of an address or location question. ${MODEL}`,
  region: `The state, province or region field. ${STAYS}`,
  country: `The country field. ${MODEL}`,
  postalCode: `The postal or ZIP code field. ${STAYS}`,
  relocate: `Answers "Are you willing to relocate?". Not specified leaves it empty. ${STAYS}`,
  remote: `Answers questions about remote, hybrid or on-site work. ${STAYS}`,
  extras: `Anything else a form asks that the fields above do not cover, such as notice period or years of experience. skiffr matches the label to the question on the form. Labels ignore case and punctuation. Labels like headline, summary, skills or availability are shown to your AI provider when a field needs mapping, others stay on your server.`,
} as const

export const NEVER_FILLED: readonly { title: string; detail: string }[] = [
  {
    title: "Passwords and codes",
    detail: "Password, one-time code and security answer fields. Hidden and file inputs.",
  },
  { title: "Card and bank details", detail: "Card numbers, IBAN, account and routing numbers." },
  { title: "Government and tax ids", detail: "Social security, passport, national id and tax numbers." },
  { title: "Date of birth", detail: "Date of birth and birthday questions." },
  {
    title: "Equal opportunity questions",
    detail: "Gender, race, ethnicity, disability, veteran status and other protected categories.",
  },
  { title: "Pronouns", detail: "Never filled, even if one was saved earlier." },
  { title: "Consent and signatures", detail: "Terms, privacy and marketing consent, certifications and signatures." },
  { title: "Salary history", detail: "What you earned before. Only your expected range above is used." },
]
