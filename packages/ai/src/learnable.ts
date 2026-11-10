import { normalizeLabel } from "@skiffr/common/utils"

/** An allowlist of control kinds: anything not named here (password, hidden, file, buttons, unknown kinds) is never learned. */
const LEARNABLE_TYPES = new Set([
  "",
  "text",
  "textarea",
  "select",
  "selectone",
  "selectmultiple",
  "radio",
  "checkbox",
  "number",
  "url",
  "email",
  "tel",
  "date",
  "combobox",
])

/** Labels that name secrets, payment details or government ids, whatever the control kind is. Matched on the normalized label. */
const SENSITIVE_LABEL =
  /\b(password|passcode|passphrase|pin|otp|secret|token|api key|2fa|mfa|verification code|security code|card|credit|debit|cvv|cvc|cvn|iban|swift|bic|routing|account number|bank|ssn|social security|national id|national insurance|nin|sin|passport|driver s licen[sc]e|tax id|tin|taxpayer|date of birth|dob|birth date|birthday)\b/u

const kind = (type: string | undefined) =>
  (type ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}]/gu, "")
    .toLowerCase()

/** Whether a field's value may be stored and filled back later. Case, spaces and zero-width characters in `type` can't dodge it. */
export function isLearnableField(field: { label: string; type?: string }): boolean {
  if (!LEARNABLE_TYPES.has(kind(field.type))) return false
  const label = normalizeLabel(field.label)
  return label.length > 0 && !SENSITIVE_LABEL.test(label)
}
