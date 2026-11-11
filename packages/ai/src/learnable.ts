import { normalizeLabel } from "@skiffr/common/utils"

export type ControlKind = "text" | "select" | "radio" | "checkbox"

/** An allowlist of control kinds: anything not named here (password, hidden, file, buttons, a missing type) is never learned. */
const KINDS: Record<string, ControlKind> = {
  text: "text",
  textarea: "text",
  number: "text",
  url: "text",
  email: "text",
  tel: "text",
  date: "text",
  select: "select",
  selectone: "select",
  selectmultiple: "select",
  combobox: "select",
  radio: "radio",
  checkbox: "checkbox",
}

const kindKey = (type: string | undefined) =>
  (type ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}]/gu, "")
    .toLowerCase()

/** The broad control a type belongs to, `null` for types that are never learned. Case, spaces and zero-width characters can't dodge it. */
export function controlKind(type: string | undefined): ControlKind | null {
  return KINDS[kindKey(type)] ?? null
}

/** Whole words or phrases of the normalized label, in any language: padded so `pin` never matches inside another word. */
const PHRASES = [
  // secrets
  "password",
  "passcode",
  "passphrase",
  "passwort",
  "kennwort",
  "pwd",
  "otp",
  "secret",
  "token",
  "api key",
  "2fa",
  "mfa",
  "mot de passe",
  "contrasena",
  "كلمة المرور",
  "كلمة السر",
  // payment
  "card",
  "credit",
  "debit",
  "cvv",
  "cvv2",
  "cvc",
  "cvc2",
  "cvn",
  "expiry",
  "expiration",
  "iban",
  "swift",
  "bic",
  "routing",
  "bank",
  "carte",
  "kreditkarte",
  "tarjeta",
  "بطاقة",
  "رقم البطاقة",
  // government and tax ids
  "ssn",
  "sin",
  "nin",
  "tin",
  "dni",
  "nif",
  "nie",
  "cpf",
  "cnic",
  "curp",
  "aadhaar",
  "aadhar",
  "passport",
  "passeport",
  "reisepass",
  "pasaporte",
  "جواز السفر",
  "رقم الهوية",
  "الهوية الوطنية",
  "taxpayer",
  // birth
  "dob",
  "birthday",
  "geburtsdatum",
  "تاريخ الميلاد",
  // equal opportunity categories: kept out of the bank and the log
  "gender",
  "sex",
  "ethnicity",
  "ethnic",
  "race",
  "racial",
  "hispanic",
  "disability",
  "disabled",
  "religion",
  "religious",
  "veteran",
  "sexual orientation",
  "marital status",
  "transgender",
  "lgbtq",
].map((phrase) => ` ${phrase} `)

/** Run together, with look-alike digits and symbols mapped back to letters: `p4ssword`, `pass-word` and `Pass word` are one thing. */
const squash = (label: string) =>
  label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(
      /[@$0134578]/g,
      (c) => ({ "@": "a", $: "s", "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" })[c] ?? c,
    )
    .replace(/[^\p{L}]/gu, "")

const SQUASHED = [
  "password",
  "passcode",
  "passphrase",
  "motdepasse",
  "contrasena",
  "creditcard",
  "debitcard",
  "cardnumber",
  "cartebancaire",
  "numerodecarte",
  "numerodetarjeta",
  "securitycode",
  "securityquestion",
  "securityanswer",
  "verificationcode",
  "onetimecode",
  "onetimepassword",
  "expirydate",
  "expirationdate",
  "accountnumber",
  "accountno",
  "sortcode",
  "socialsecurity",
  "socialinsurance",
  "nationalid",
  "nationalinsurance",
  "identitynumber",
  "documentodeidentidad",
  "taxnumber",
  "taxid",
  "taxidentification",
  "drivinglicen",
  "driverslicen",
  "maidenname",
  "dateofbirth",
  "birthdate",
  "yearofbirth",
  "datedenaissance",
  "fechadenacimiento",
  "numerodesecuritesociale",
]

/** Browsers' own hint of what a control holds. It doesn't depend on the label's language. */
const SENSITIVE_AUTOCOMPLETE = /(^|\s)(cc-[a-z-]+|one-time-code|new-password|current-password|bday(-[a-z]+)?)(\s|$)/i

/** A bare `pin` is a secret, `pin code` is a postal code. */
function isPinSecret(padded: string): boolean {
  return padded.includes(" pin ") && !padded.includes(" pin code ")
}

/** Whether a field's value may be stored and filled back later. Case, spaces and zero-width characters in `type` can't dodge it. */
export function isLearnableField(field: { label: string; type?: string; autocomplete?: string }): boolean {
  if (!controlKind(field.type)) return false
  if (field.autocomplete && SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) return false
  const label = normalizeLabel(field.label)
  if (label.length === 0) return false
  const padded = ` ${label} `
  if (PHRASES.some((phrase) => padded.includes(phrase)) || isPinSecret(padded)) return false
  const squashed = squash(field.label)
  return !SQUASHED.some((word) => squashed.includes(word))
}
