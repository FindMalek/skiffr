import type { ProfileData, ProfileFields } from "@skiffr/common/schemas"

type AnswerStatus = "learned" | "confirmed" | "rejected"
type AnswerSource = "manual" | "autofill" | "ai" | "import"

export interface PreviewUser {
  id: string
  name: string
  email: string
  role: "admin" | "user"
}

export const DEMO_USER: PreviewUser = { id: "seed-demo", name: "Jordan Ellis", email: "demo@skiffr.test", role: "user" }
export const ADMIN_USER: PreviewUser = {
  id: "seed-admin",
  name: "Alex Admin",
  email: "admin@skiffr.test",
  role: "admin",
}
export const SECOND_USER: PreviewUser = {
  id: "seed-second",
  name: "Riley Morgan",
  email: "second@skiffr.test",
  role: "user",
}
export const PREVIEW_USERS = [DEMO_USER, ADMIN_USER, SECOND_USER] as const

/** Public on purpose: it only ever exists where `assertPreviewSeedAllowed` lets the seed run. Override with `SEED_DEMO_PASSWORD`. */
export const DEFAULT_DEMO_PASSWORD = "skiffr-preview-demo"

type Profile = { data: ProfileData; fields: ProfileFields }

export const DEMO_PROFILE: Profile = {
  data: {
    identity: {
      firstName: "Jordan",
      lastName: "Ellis",
      email: DEMO_USER.email,
      phone: "+1 303 555 0142",
      pronouns: "they/them",
    },
    links: {
      linkedin: "https://links.example.invalid/in/jordan-ellis",
      github: "https://code.example.invalid/jordan-ellis",
      portfolio: "https://jordan-ellis.example.com",
      website: "https://jordan-ellis.example.com/blog",
      other: ["https://jordan-ellis.example.com/talks"],
    },
    workAuth: { authorizedCountries: ["United States"], requiresSponsorship: false, visaStatus: "US citizen" },
    salary: { currency: "USD", min: 150000, max: 180000, period: "year" },
    location: {
      city: "Denver",
      region: "Colorado",
      country: "United States",
      postalCode: "80202",
      willingToRelocate: false,
      remotePreference: "remote",
    },
  },
  fields: {
    "current job title": "Senior Software Engineer",
    "current company": "Harborline Systems",
    "years of experience": "9",
    "highest education": "Bachelor's degree",
    university: "Northgate University",
    "field of study": "Computer Science",
    "graduation year": "2015",
    education: "B.S. Computer Science, Northgate University, 2015",
    experience:
      "Senior Software Engineer, Harborline Systems, 2021 to present. Software Engineer, Brightpath, 2017 to 2021. Junior Developer, Lakeside Apps, 2015 to 2017.",
    skills: "TypeScript, Go, PostgreSQL, React, Node.js, Kubernetes, AWS, Kafka",
    languages: "English (native), Spanish (conversational)",
    "notice period": "4 weeks",
    "earliest start date": "Within 4 weeks of an offer",
    "desired salary": "USD 165,000 per year",
    "salary expectation": "165000",
    "preferred name": "Jordan",
    "time zone": "America/Denver",
  },
}

export const SECOND_PROFILE: Profile = {
  data: {
    identity: { firstName: "Riley", lastName: "Morgan", email: SECOND_USER.email, phone: "+49 30 555 0178" },
    links: { github: "https://code.example.invalid/riley-morgan", other: [] },
    workAuth: { authorizedCountries: ["Germany", "European Union"], requiresSponsorship: false },
    salary: { currency: "EUR", min: 75000, max: 95000, period: "year" },
    location: { city: "Berlin", country: "Germany", willingToRelocate: true, remotePreference: "hybrid" },
  },
  fields: { "notice period": "3 months", "current job title": "Data Engineer", "years of experience": "5" },
}

export const ADMIN_PROFILE: Profile = {
  data: {
    identity: { firstName: "Alex", lastName: "Admin", email: ADMIN_USER.email },
    links: { other: [] },
    workAuth: { authorizedCountries: [] },
    salary: {},
    location: { city: "Austin", country: "United States" },
  },
  fields: {},
}

export interface AnswerSpec {
  label: string
  type: string
  options?: string[]
  value: string
  status: AnswerStatus
  source: AnswerSource
  used: number
  corrected: number
  cleared: number
}

const YES_NO = ["Yes", "No"]
const a = (
  label: string,
  type: string,
  value: string,
  status: AnswerStatus,
  source: AnswerSource,
  used: number,
  corrected: number,
  cleared = 0,
  options?: string[],
): AnswerSpec => ({ label, type, value, status, source, used, corrected, cleared, ...(options ? { options } : {}) })

const WHY_HERE =
  "I like small teams that own a product end to end. I have spent the last few years building payment and data services in TypeScript and Go, and your engineering blog reads like a team that cares about boring, reliable infrastructure. I would like to work on that."
const PROUD_PROJECT =
  "I led the move of our billing service from a monolith to three services on Kafka. Deploy time went from 40 minutes to 8, and incidents during invoicing dropped by about two thirds. I wrote the migration plan, paired with two juniors on the rollout and kept the old path alive until the numbers matched."
const CLOUD =
  "Most of my work is on AWS: ECS and EKS for services, RDS for PostgreSQL, SQS and MSK for messaging, Terraform for everything. I have also run small workloads on GCP."
const LEAVING =
  "I want more ownership of the product and a team where I can mentor, and my current role has no path to either."

/** The demo user's answer bank: 62 questions in every state. Choice fields carry their options so the fingerprint matches a real select. */
export const ANSWERS: AnswerSpec[] = [
  a(
    "Are you legally authorized to work in the United States?",
    "select",
    "Yes",
    "confirmed",
    "autofill",
    24,
    0,
    0,
    YES_NO,
  ),
  a(
    "Will you now or in the future require visa sponsorship?",
    "radio",
    "No",
    "confirmed",
    "autofill",
    24,
    0,
    0,
    YES_NO,
  ),
  a("How did you hear about this position?", "select", "Company website", "learned", "autofill", 11, 5, 0, [
    "LinkedIn",
    "Indeed",
    "Company website",
    "Referral",
    "Other",
  ]),
  a("What is your notice period?", "text", "4 weeks", "confirmed", "manual", 19, 1),
  a("When can you start?", "text", "Within 4 weeks of an offer", "confirmed", "manual", 16, 0),
  a("Desired salary", "text", "USD 165,000 per year", "confirmed", "manual", 21, 2),
  a("Salary expectations (USD)", "number", "165000", "learned", "autofill", 9, 3),
  a("Current compensation", "text", "Prefer not to say", "rejected", "autofill", 6, 4, 3),
  a("Years of experience with TypeScript", "number", "8", "confirmed", "manual", 17, 0),
  a("Years of experience with PostgreSQL", "number", "9", "learned", "autofill", 12, 1),
  a("Years of experience with Go", "number", "4", "learned", "autofill", 7, 1),
  a("Years of experience with React", "number", "6", "learned", "autofill", 10, 0),
  a("Years of experience with Kubernetes", "number", "3", "learned", "autofill", 5, 2),
  a("Total years of professional experience", "number", "9", "confirmed", "manual", 22, 0),
  a("Are you willing to relocate?", "radio", "No", "confirmed", "autofill", 15, 0, 0, YES_NO),
  a("Are you open to remote work?", "radio", "Yes", "learned", "autofill", 14, 0, 0, YES_NO),
  a("Preferred work arrangement", "select", "Remote", "learned", "autofill", 13, 2, 0, ["Remote", "Hybrid", "On-site"]),
  a("Current employer", "text", "Harborline Systems", "confirmed", "manual", 18, 0),
  a("Current job title", "text", "Senior Software Engineer", "confirmed", "manual", 18, 0),
  a("Highest level of education", "select", "Bachelor's degree", "learned", "autofill", 9, 1, 0, [
    "High school",
    "Associate degree",
    "Bachelor's degree",
    "Master's degree",
    "Doctorate",
  ]),
  a("University", "text", "Northgate University", "learned", "autofill", 9, 0),
  a("Field of study", "text", "Computer Science", "learned", "autofill", 8, 0),
  a("Graduation year", "number", "2015", "learned", "autofill", 8, 0),
  a("GitHub profile", "url", "https://code.example.invalid/jordan-ellis", "confirmed", "import", 20, 0),
  a("LinkedIn profile URL", "url", "https://links.example.invalid/in/jordan-ellis", "confirmed", "import", 23, 0),
  a("Personal website", "url", "https://jordan-ellis.example.com", "learned", "import", 10, 1),
  a("Portfolio link", "url", "https://jordan-ellis.example.com", "learned", "import", 6, 0),
  a("Languages spoken", "text", "English (native), Spanish (conversational)", "learned", "manual", 7, 0),
  a("English proficiency", "select", "Native or bilingual", "learned", "autofill", 6, 0, 0, [
    "Basic",
    "Conversational",
    "Fluent",
    "Native or bilingual",
  ]),
  a("Do you have experience leading a team?", "radio", "Yes", "learned", "autofill", 9, 0, 0, YES_NO),
  a("How many people have you managed?", "number", "4", "learned", "autofill", 4, 2),
  a("Why do you want to work here?", "textarea", WHY_HERE, "learned", "ai", 14, 9),
  a("Tell us about a project you are proud of", "textarea", PROUD_PROJECT, "confirmed", "ai", 8, 3),
  a("Describe your experience with cloud platforms", "textarea", CLOUD, "learned", "ai", 5, 1),
  a(
    "What are your greatest strengths?",
    "textarea",
    "Turning vague problems into small, shippable steps, and writing things down so the team does not have to ask twice.",
    "learned",
    "manual",
    6,
    0,
  ),
  a("What is your biggest weakness?", "textarea", "I say yes to too much early on.", "rejected", "ai", 3, 3, 3),
  a("Cover letter", "textarea", "Dear hiring team, I would like to apply for this role.", "rejected", "ai", 4, 4, 3),
  a("Do you have a valid driver's license?", "radio", "Yes", "learned", "autofill", 3, 0, 0, YES_NO),
  a("Time zone", "select", "America/Denver (UTC-7)", "learned", "autofill", 12, 1, 0, [
    "America/New_York (UTC-5)",
    "America/Chicago (UTC-6)",
    "America/Denver (UTC-7)",
    "America/Los_Angeles (UTC-8)",
    "Europe/London (UTC+0)",
  ]),
  a("Preferred contact method", "select", "Email", "learned", "autofill", 5, 0, 3, ["Email", "Phone", "Text message"]),
  a("Best time to reach you", "text", "Weekdays after 9am Mountain", "learned", "manual", 3, 0),
  a("Are you currently employed?", "radio", "Yes", "confirmed", "autofill", 13, 0, 0, YES_NO),
  a("Reason for leaving your current role", "textarea", LEAVING, "learned", "ai", 4, 2),
  a("Referred by (employee name)", "text", "N/A", "rejected", "autofill", 5, 5, 3),
  a("Expected hourly rate for contract work", "text", "USD 90 per hour", "learned", "manual", 2, 0),
  a("Contract type preference", "select", "Full-time", "confirmed", "autofill", 15, 0, 0, [
    "Full-time",
    "Part-time",
    "Contract",
  ]),
  a("Are you available for on-call rotations?", "radio", "Yes", "learned", "autofill", 6, 1, 0, YES_NO),
  a("Are you comfortable with occasional travel?", "radio", "Yes", "learned", "autofill", 5, 0, 0, YES_NO),
  a("Primary programming language", "select", "TypeScript", "confirmed", "autofill", 11, 0, 0, [
    "TypeScript",
    "Go",
    "Python",
    "Java",
    "Rust",
    "Other",
  ]),
  a("Preferred tech stack", "text", "TypeScript, Node.js, PostgreSQL, React", "learned", "manual", 6, 1),
  a("Link to open source contributions", "url", "https://code.example.invalid/jordan-ellis", "learned", "import", 4, 0),
  a("Preferred team size", "select", "5 to 10", "learned", "autofill", 3, 2, 0, [
    "Under 5",
    "5 to 10",
    "10 to 25",
    "Over 25",
  ]),
  a("Current city", "text", "Denver", "confirmed", "autofill", 17, 0),
  a("Country of residence", "select", "United States", "confirmed", "autofill", 17, 0, 0, [
    "United States",
    "Canada",
    "United Kingdom",
    "Germany",
    "Other",
  ]),
  a("ZIP or postal code", "text", "80202", "learned", "autofill", 10, 0),
  a("Preferred first name", "text", "Jordan", "confirmed", "manual", 20, 0),
  a("Years of backend experience", "number", "9", "learned", "autofill", 6, 1),
  a("Preferred salary currency", "select", "USD", "learned", "autofill", 5, 0, 0, ["USD", "EUR", "GBP", "CAD"]),
  a("Do you have experience with microservices?", "radio", "Yes", "learned", "autofill", 8, 0, 0, YES_NO),
  a("Do you have experience with CI/CD pipelines?", "radio", "Yes", "learned", "autofill", 8, 0, 0, YES_NO),
  a(
    "What attracts you to a startup environment?",
    "textarea",
    "Short feedback loops and owning the whole path from idea to production.",
    "learned",
    "ai",
    2,
    1,
  ),
  a(
    "Notice period for current employer",
    "text",
    "Two weeks of vacation then four weeks notice",
    "learned",
    "autofill",
    4,
    4,
  ),
  a("Expected start date", "text", "In about a month", "learned", "autofill", 5, 2),
  a("Do you require accommodations for the interview process?", "radio", "No", "learned", "autofill", 2, 0, 0, YES_NO),
  a("What time zones can you overlap with?", "text", "US Mountain, plus Europe mornings", "learned", "manual", 3, 0),
]

export const SECOND_ANSWERS: AnswerSpec[] = [
  a("What is your notice period?", "text", "3 months", "confirmed", "manual", 6, 0),
  a("Desired salary", "text", "EUR 85,000 per year", "confirmed", "manual", 5, 0),
  a("Are you willing to relocate?", "radio", "Yes", "learned", "autofill", 4, 0, 0, YES_NO),
  a("Current job title", "text", "Data Engineer", "confirmed", "manual", 5, 0),
  a("GitHub profile", "url", "https://code.example.invalid/riley-morgan", "learned", "import", 3, 0),
  a("Years of experience with Python", "number", "6", "learned", "autofill", 3, 0),
  a("Preferred work arrangement", "select", "Hybrid", "learned", "autofill", 3, 1, 0, ["Remote", "Hybrid", "On-site"]),
  a("Current compensation", "text", "Prefer not to say", "rejected", "autofill", 2, 2, 3),
]

export interface FormField {
  label: string
  type: string
  options?: string[]
  /** Where the value comes from: a profile path, an answer of the bank, or text typed on the form. */
  from: { profile: string } | { answer: string } | { literal: string }
  /** What the user changed it to on some visits, so the events include corrections. */
  corrected?: string
  /** A second value the user flips to, so the answer keeps changing. */
  correctedAlt?: string
  /** What the bank held before the user's corrections made it the current value: older events were filled with this and corrected. */
  was?: string
}

const HEARD = ["LinkedIn", "Indeed", "Company website", "Referral", "Other"]

/**
 * The form every seeded site profile and every field event shares: the labels the profile and the answer bank answer.
 * A playground page that asks these fields autofills end to end.
 */
export const STANDARD_FORM: FormField[] = [
  { label: "First name", type: "text", from: { profile: "identity.firstName" } },
  { label: "Last name", type: "text", from: { profile: "identity.lastName" } },
  { label: "Email", type: "email", from: { profile: "identity.email" } },
  { label: "Phone", type: "tel", from: { profile: "identity.phone" } },
  { label: "LinkedIn profile URL", type: "url", from: { answer: "LinkedIn profile URL" } },
  { label: "GitHub profile", type: "url", from: { answer: "GitHub profile" } },
  { label: "Current city", type: "text", from: { answer: "Current city" } },
  {
    label: "Are you legally authorized to work in the United States?",
    type: "select",
    options: YES_NO,
    from: { answer: "Are you legally authorized to work in the United States?" },
  },
  {
    label: "Will you now or in the future require visa sponsorship?",
    type: "radio",
    options: YES_NO,
    from: { answer: "Will you now or in the future require visa sponsorship?" },
  },
  { label: "What is your notice period?", type: "text", from: { answer: "What is your notice period?" } },
  { label: "Desired salary", type: "text", from: { answer: "Desired salary" }, corrected: "USD 170,000 per year" },
  {
    label: "How did you hear about this position?",
    type: "select",
    options: HEARD,
    from: { answer: "How did you hear about this position?" },
    corrected: "Company website",
    was: "LinkedIn",
  },
  {
    label: "Why do you want to work here?",
    type: "textarea",
    from: { answer: "Why do you want to work here?" },
    corrected: "The mission and the small team.",
    correctedAlt: "I like shipping small things quickly.",
  },
]

export const SHORT_FORM_LABELS = [
  "First name",
  "Last name",
  "Email",
  "Phone",
  "LinkedIn profile URL",
  "Are you legally authorized to work in the United States?",
] as const

export const NOTES: { title: string; body: string }[] = [
  {
    title: "Interview prep: system design",
    body: "Practice: rate limiter, job queue, feed ranking. Draw the data model first, then the failure modes.",
  },
  {
    title: "Questions to ask the hiring manager",
    body: "How is on-call split? What did the last person in this role ship in the first 90 days? How are priorities set?",
  },
  {
    title: "Salary range research",
    body: "Senior backend, remote US: 150k to 185k at series B and C. Ask for the band before giving a number.",
  },
  {
    title: "Brightmere: follow up",
    body: "Recruiter said the loop is two coding rounds and one design. Send availability by Friday.",
  },
  {
    title: "Weekly review",
    body: "12 applications sent, 2 replies, 1 screen booked. Spend less time on cold applications, more on referrals.",
  },
  {
    title: "Reference list",
    body: "Former manager at Brightpath, tech lead at Harborline, one peer. Ask before sharing their email.",
  },
]

export const SECOND_NOTES = [
  { title: "Move to Berlin timeline", body: "Notice period three months, so start applying in January." },
  { title: "Python vs Go for data tooling", body: "Stay with Python for the pipelines, learn Go for the services." },
]
