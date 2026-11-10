import { normalizeLabel } from "@skiffr/common/utils"

const KEYS = new Set([
  "identity.firstName",
  "identity.lastName",
  "location.city",
  "location.country",
  "workAuth.authorizedCountries",
  "workAuth.requiresSponsorship",
  "workAuth.visaStatus",
])

/** Free-form fields are named by the applicant, so only these labels are ever shown to the model with their value. */
const FIELD_LABELS = new Set([
  "preferred name",
  "headline",
  "summary",
  "experience",
  "years of experience",
  "skills",
  "languages",
  "notice period",
  "availability",
  "linkedin",
  "github",
  "portfolio",
  "website",
])

/** An allowlist: contact details, pay, ids, dates of birth and every unknown field stay out by default. */
export function isShared(key: string): boolean {
  if (key.startsWith("links.")) return true
  if (key.startsWith("fields.")) return FIELD_LABELS.has(normalizeLabel(key.slice("fields.".length)))
  return KEYS.has(key)
}
