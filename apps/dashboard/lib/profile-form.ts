import { ANSWER_VALUE_MAX, LABEL_MAX, PROFILE_FIELDS_MAX, SHORT_TEXT_MAX } from "@skiffr/common/constants"
import { httpUrlSchema, type ProfileData, type ProfileFields } from "@skiffr/common/schemas"
import { normalizeLabel } from "@skiffr/common/utils"

export const OTHER_LINKS_MAX = 10
export const COUNTRIES_MAX = 50

export type Choice = "" | "yes" | "no"
export type Period = "" | "hour" | "month" | "year"
export type Remote = "" | "remote" | "hybrid" | "onsite"

/** A row of a list the user adds to and removes from. `key` is only for React and is never saved. */
export type LinkRow = { key: number; value: string }
export type ExtraRow = { key: number; label: string; value: string }

/** Everything the page edits, as the strings the inputs hold. `""` means unset. */
export type ProfileForm = {
  firstName: string
  lastName: string
  email: string
  phone: string
  linkedin: string
  github: string
  portfolio: string
  website: string
  otherLinks: LinkRow[]
  /** One input, comma separated: no multi select primitive in `packages/ui` yet. */
  countries: string
  sponsorship: Choice
  visaStatus: string
  currency: string
  salaryMin: string
  salaryMax: string
  period: Period
  city: string
  region: string
  country: string
  postalCode: string
  relocate: Choice
  remote: Remote
  extras: ExtraRow[]
}

export type SavedProfile = { data: ProfileData; fields: ProfileFields }

/** Loaded rows are keyed by position (the server and the browser must agree on them), new rows from here up. */
let rowKey = 1_000
export const nextRowKey = (): number => ++rowKey

export const emptyForm = (): ProfileForm => ({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  linkedin: "",
  github: "",
  portfolio: "",
  website: "",
  otherLinks: [],
  countries: "",
  sponsorship: "",
  visaStatus: "",
  currency: "",
  salaryMin: "",
  salaryMax: "",
  period: "",
  city: "",
  region: "",
  country: "",
  postalCode: "",
  relocate: "",
  remote: "",
  extras: [],
})

const choice = (value: boolean | undefined): Choice => (value === undefined ? "" : value ? "yes" : "no")
const flag = (value: Choice): boolean | undefined => (value === "" ? undefined : value === "yes")
const num = (value: number | undefined): string => (value === undefined ? "" : String(value))

export function profileToForm(saved: SavedProfile | null): ProfileForm {
  if (!saved) return emptyForm()
  const { identity, links, workAuth, salary, location } = saved.data
  return {
    firstName: identity.firstName ?? "",
    lastName: identity.lastName ?? "",
    email: identity.email ?? "",
    phone: identity.phone ?? "",
    linkedin: links.linkedin ?? "",
    github: links.github ?? "",
    portfolio: links.portfolio ?? "",
    website: links.website ?? "",
    otherLinks: links.other.map((value, index) => ({ key: index + 1, value })),
    countries: joinCountries(workAuth.authorizedCountries),
    sponsorship: choice(workAuth.requiresSponsorship),
    visaStatus: workAuth.visaStatus ?? "",
    currency: salary.currency ?? "",
    salaryMin: num(salary.min),
    salaryMax: num(salary.max),
    period: salary.period ?? "",
    city: location.city ?? "",
    region: location.region ?? "",
    country: location.country ?? "",
    postalCode: location.postalCode ?? "",
    relocate: choice(location.willingToRelocate),
    remote: location.remotePreference ?? "",
    extras: Object.entries(saved.fields).map(([label, value], index) => ({ key: index + 1, label, value })),
  }
}

/** An empty string is unset, never `""`: the api and the mapper treat a stored empty string as a value. */
const text = (value: string): string | undefined => (value.trim() === "" ? undefined : value.trim())

/** Commas separate countries, unless the text has a semicolon: then only semicolons do, so "Korea, Republic of" survives. */
export function splitCountries(value: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of value.split(value.includes(";") ? ";" : ",")) {
    const country = part.trim()
    const key = country.toLowerCase()
    if (country === "" || seen.has(key)) continue
    seen.add(key)
    out.push(country)
  }
  return out
}

export const joinCountries = (countries: string[]): string =>
  countries.some((country) => country.includes(",")) ? countries.join("; ") : countries.join(", ")

/** Whole numbers: plain digits, or digits grouped by thousands with commas or spaces ("90,000"). "1,5" is not 15. */
function parseAmount(value: string): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text) && !/^\d{1,3}([, ]\d{3})+$/.test(text)) return null
  const amount = Number(text.replace(/[, ]/g, ""))
  return Number.isSafeInteger(amount) ? amount : null
}

/**
 * The form as the api stores it. `base` is what was loaded: keys the page does not edit (pronouns, which the extension
 * never fills) are carried over, because `profile.upsert` replaces the whole profile.
 */
export function formToProfile(form: ProfileForm, base?: ProfileData): SavedProfile {
  const min = parseAmount(form.salaryMin)
  const max = parseAmount(form.salaryMax)
  const fields: ProfileFields = {}
  for (const row of form.extras) {
    const key = normalizeLabel(row.label)
    if (key !== "" && row.value.trim() !== "") fields[key] = row.value.trim()
  }
  return {
    data: {
      identity: {
        firstName: text(form.firstName),
        lastName: text(form.lastName),
        email: text(form.email),
        phone: text(form.phone),
        pronouns: base?.identity.pronouns,
      },
      links: {
        linkedin: text(form.linkedin),
        github: text(form.github),
        portfolio: text(form.portfolio),
        website: text(form.website),
        other: form.otherLinks.map((row) => row.value.trim()).filter(Boolean),
      },
      workAuth: {
        authorizedCountries: splitCountries(form.countries),
        requiresSponsorship: flag(form.sponsorship),
        visaStatus: text(form.visaStatus),
      },
      salary: {
        currency: text(form.currency)?.toUpperCase(),
        min: min ?? undefined,
        max: max ?? undefined,
        period: form.period === "" ? undefined : form.period,
      },
      location: {
        city: text(form.city),
        region: text(form.region),
        country: text(form.country),
        postalCode: text(form.postalCode),
        willingToRelocate: flag(form.relocate),
        remotePreference: form.remote === "" ? undefined : form.remote,
      },
    },
    fields,
  }
}

/** Key order and `undefined` keys do not matter to the api, so compare the JSON form with the keys sorted. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  )
}

/**
 * What `formToProfile` drops without a word: an amount that is not a whole number, and an extra field with only a label
 * or only a value. Dirty must see them too, or such an edit would leave Save disabled and the leave guard off.
 */
function dropped(form: ProfileForm): string[] {
  const out: string[] = []
  for (const amount of [form.salaryMin, form.salaryMax])
    if (amount.trim() !== "" && parseAmount(amount) === null) out.push(amount)
  for (const row of form.extras) {
    const [label, value] = [row.label.trim(), row.value.trim()]
    if ((label !== "" || value !== "") && (normalizeLabel(label) === "" || value === "")) out.push(`${label}\n${value}`)
  }
  return out
}

export function isDirty(form: ProfileForm, saved: SavedProfile | null): boolean {
  const initial = profileToForm(saved)
  return (
    canonical(formToProfile(form, saved?.data)) !== canonical(formToProfile(initial, saved?.data)) ||
    canonical(dropped(form)) !== canonical(dropped(initial))
  )
}

export type FieldError = { id: string; message: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[\d\s().\-/]+(?:\s*(?:ext\.?|x)\s*\d{1,6})?$/i
const CURRENCY = /^[A-Za-z]{3}$/

/** Ids are the DOM ids of the inputs (prefixed by the page), in page order, so the first error is the first in the list. */
export function validateProfileForm(form: ProfileForm): FieldError[] {
  const errors: FieldError[] = []
  const add = (id: string, message: string) => errors.push({ id, message })
  const short = (id: string, value: string) => {
    if (value.trim().length > SHORT_TEXT_MAX) add(id, `Keep this under ${SHORT_TEXT_MAX} characters.`)
  }
  const url = (id: string, value: string) => {
    const trimmed = value.trim()
    if (trimmed === "") return
    if (!httpUrlSchema.safeParse(trimmed).success) add(id, "Enter a full link that starts with https:// or http://.")
  }

  short("firstName", form.firstName)
  short("lastName", form.lastName)
  if (form.email.trim() !== "" && !EMAIL.test(form.email.trim())) add("email", "Enter an email like name@example.com.")
  else short("email", form.email)
  const phone = form.phone.trim()
  const digits = phone.replace(/\D/g, "").length
  if (phone !== "" && (!PHONE.test(phone) || digits < 5 || digits > 15))
    add("phone", "Enter a phone number with 5 to 15 digits, like +44 20 7946 0958.")
  else short("phone", form.phone)

  url("linkedin", form.linkedin)
  url("github", form.github)
  url("portfolio", form.portfolio)
  url("website", form.website)
  for (const row of form.otherLinks) url(`other-${row.key}`, row.value)

  const countries = splitCountries(form.countries)
  if (countries.length > COUNTRIES_MAX) add("countries", `List at most ${COUNTRIES_MAX} countries.`)
  else if (countries.some((country) => country.length > SHORT_TEXT_MAX)) add("countries", "A country name is too long.")
  short("visaStatus", form.visaStatus)

  if (form.currency.trim() !== "" && !CURRENCY.test(form.currency.trim()))
    add("currency", "Use a three letter code, like USD or EUR.")
  const min = form.salaryMin.trim() === "" ? null : parseAmount(form.salaryMin)
  const max = form.salaryMax.trim() === "" ? null : parseAmount(form.salaryMax)
  if (form.salaryMin.trim() !== "" && min === null) add("salaryMin", "Enter a whole number, 0 or more.")
  if (form.salaryMax.trim() !== "" && max === null) add("salaryMax", "Enter a whole number, 0 or more.")
  if (min !== null && max !== null && min > max) add("salaryMax", "The maximum is below the minimum.")

  short("city", form.city)
  short("region", form.region)
  short("country", form.country)
  short("postalCode", form.postalCode)

  const seen = new Set<string>()
  for (const row of form.extras) {
    const label = row.label.trim()
    const value = row.value.trim()
    if (label === "" && value === "") continue
    if (label === "") add(`extra-label-${row.key}`, "Add a label, like Notice period.")
    else if (label.length > LABEL_MAX) add(`extra-label-${row.key}`, `Keep the label under ${LABEL_MAX} characters.`)
    else if (normalizeLabel(label) === "")
      add(`extra-label-${row.key}`, "Use at least one letter or digit in the label.")
    else if (seen.has(normalizeLabel(label)))
      add(`extra-label-${row.key}`, "Another field has the same label. Labels ignore case and punctuation.")
    else seen.add(normalizeLabel(label))
    if (value === "") add(`extra-value-${row.key}`, "Add a value, or remove the field.")
    else if (value.length > ANSWER_VALUE_MAX)
      add(`extra-value-${row.key}`, `Keep the value under ${ANSWER_VALUE_MAX} characters.`)
  }
  if (form.extras.length > PROFILE_FIELDS_MAX) add("extras", `Save at most ${PROFILE_FIELDS_MAX} extra fields.`)
  return errors
}

type Counted = { id: string; label: string; filled: (form: ProfileForm) => boolean }

const has =
  (key: keyof ProfileForm): Counted["filled"] =>
  (form) =>
    String(form[key]).trim() !== ""

/** Each profile value the extension can put into a form. Pronouns are left out on purpose: they are never filled. Extra fields are counted apart. */
export const COUNTED_FIELDS: readonly Counted[] = [
  { id: "firstName", label: "First name", filled: has("firstName") },
  { id: "lastName", label: "Last name", filled: has("lastName") },
  { id: "email", label: "Email", filled: has("email") },
  { id: "phone", label: "Phone", filled: has("phone") },
  { id: "linkedin", label: "LinkedIn", filled: has("linkedin") },
  { id: "github", label: "GitHub", filled: has("github") },
  { id: "portfolio", label: "Portfolio", filled: has("portfolio") },
  { id: "website", label: "Website", filled: has("website") },
  { id: "countries", label: "Authorized countries", filled: (form) => splitCountries(form.countries).length > 0 },
  { id: "sponsorship", label: "Sponsorship", filled: (form) => form.sponsorship !== "" },
  { id: "visaStatus", label: "Visa status", filled: has("visaStatus") },
  { id: "currency", label: "Salary currency", filled: has("currency") },
  { id: "salaryMin", label: "Minimum salary", filled: has("salaryMin") },
  { id: "salaryMax", label: "Maximum salary", filled: has("salaryMax") },
  { id: "period", label: "Salary period", filled: (form) => form.period !== "" },
  { id: "city", label: "City", filled: has("city") },
  { id: "region", label: "Region", filled: has("region") },
  { id: "country", label: "Country", filled: has("country") },
  { id: "postalCode", label: "Postal code", filled: has("postalCode") },
  { id: "relocate", label: "Relocation", filled: (form) => form.relocate !== "" },
  { id: "remote", label: "Work setup", filled: (form) => form.remote !== "" },
]

export type Completeness = { filled: number; total: number; missing: string[] }

export function completeness(form: ProfileForm): Completeness {
  const missing = COUNTED_FIELDS.filter((field) => !field.filled(form)).map((field) => field.label)
  return { filled: COUNTED_FIELDS.length - missing.length, total: COUNTED_FIELDS.length, missing }
}
