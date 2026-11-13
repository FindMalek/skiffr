export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "file"
  | "date"

export interface Field {
  key: string
  kind: FieldKind
  label: string
  required?: boolean
  options?: string[]
  autocomplete?: string
  help?: string
}

export const COUNTRIES = ["Portugal", "United States", "United Kingdom", "Germany", "France", "Spain"]
export const SOURCES = ["LinkedIn", "Referral", "Job board", "Company website", "Other"]

/** What every board asks first. */
export const CORE: Field[] = [
  { key: "first_name", kind: "text", label: "First name", required: true, autocomplete: "given-name" },
  { key: "last_name", kind: "text", label: "Last name", required: true, autocomplete: "family-name" },
  { key: "email", kind: "email", label: "Email", required: true, autocomplete: "email" },
  { key: "phone", kind: "tel", label: "Phone", autocomplete: "tel" },
  { key: "location", kind: "text", label: "Current location (city)", autocomplete: "address-level2" },
  { key: "resume", kind: "file", label: "Resume/CV", required: true },
]

export const LINKS: Field[] = [
  { key: "linkedin", kind: "url", label: "LinkedIn profile" },
  { key: "github", kind: "url", label: "GitHub profile" },
  { key: "website", kind: "url", label: "Portfolio or website" },
]

export const QUESTIONS: Field[] = [
  { key: "why", kind: "textarea", label: "Why do you want to work at Acme?", required: true },
  { key: "notice", kind: "text", label: "Notice period" },
  {
    key: "authorized",
    kind: "select",
    label: "Are you authorized to work in the country of this role?",
    options: ["Yes", "No"],
  },
  {
    key: "sponsorship",
    kind: "select",
    label: "Will you now or in the future require visa sponsorship?",
    options: ["Yes", "No"],
  },
  { key: "source", kind: "select", label: "How did you hear about this job?", options: SOURCES },
]

/** Questions the guard must leave alone: who a person is. */
export const EEO: Field[] = [
  {
    key: "gender",
    kind: "select",
    label: "Gender",
    options: ["Male", "Female", "Non-binary", "Decline to self-identify"],
  },
  {
    key: "race",
    kind: "select",
    label: "Race / ethnicity",
    options: ["Asian", "Black or African American", "Hispanic or Latino", "White", "Decline to self-identify"],
  },
  {
    key: "veteran",
    kind: "select",
    label: "Veteran status",
    options: ["I am a protected veteran", "I am not a protected veteran", "I decline to self-identify"],
  },
  {
    key: "disability",
    kind: "select",
    label: "Disability status",
    options: ["Yes, I have a disability", "No, I do not have a disability", "I do not want to answer"],
  },
]

/** Boxes and signatures a person must tick or write on their own. */
export const CONSENT: Field[] = [
  {
    key: "privacy",
    kind: "checkbox",
    label: "I agree to the Acme privacy policy and the processing of my data",
    required: true,
  },
  { key: "talent", kind: "checkbox", label: "Keep my data for future roles at Acme for 12 months" },
  { key: "arbitration", kind: "checkbox", label: "I acknowledge and consent to the arbitration agreement" },
  { key: "signature", kind: "text", label: "Signature (type your full legal name)", required: true },
  { key: "signed_on", kind: "date", label: "Date signed" },
]

export const JOB = {
  title: "Senior Engineer",
  company: "Acme",
  location: "Lisbon, Portugal (remote friendly)",
  intro:
    "Acme builds tools that help small teams ship reliable software. This is a made up posting on a test page: nothing here is real and nothing you type leaves the playground.",
  sections: [
    {
      heading: "About the role",
      text: "You will own services end to end, from the first design note to the pager. We value small diffs, clear writing and boring technology that works.",
    },
    {
      heading: "What you will do",
      list: [
        "Design and ship backend features with a small team",
        "Review code and mentor teammates",
        "Keep production healthy and the on-call rota calm",
      ],
    },
    {
      heading: "What we look for",
      list: [
        "Five or more years building production systems",
        "Comfort with TypeScript and SQL",
        "Clear written communication",
      ],
    },
  ],
} as const
