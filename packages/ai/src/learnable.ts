import { normalizeLabel } from "@skiffr/common/utils"

export type ControlKind = "text" | "number" | "date" | "email" | "tel" | "url" | "choice" | "checkbox"

/** An allowlist of control kinds: anything not named here (password, hidden, file, buttons, a missing type) is never learned. */
const KINDS: Record<string, ControlKind> = {
  text: "text",
  textarea: "text",
  number: "number",
  date: "date",
  email: "email",
  tel: "tel",
  url: "url",
  select: "choice",
  selectone: "choice",
  selectmultiple: "choice",
  combobox: "choice",
  radio: "choice",
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

/**
 * Whole words or phrases of the normalized label (lowercase, no accents or punctuation), padded so a short word never
 * matches inside another. Skill questions stay learnable on purpose: `swift`, `bank`, `credit` and `routing` alone are
 * not here, only the payment phrases they appear in.
 */
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
  "authenticator",
  "backup code",
  "recovery code",
  "sms code",
  "verification code",
  "security code",
  "security question",
  "security answer",
  "one time code",
  "one time password",
  "mot de passe",
  "code de securite",
  "code de verification",
  "contrasena",
  "codigo de seguridad",
  "codigo de verificacion",
  "sicherheitscode",
  "verifizierungscode",
  "كلمة المرور",
  "كلمة السر",
  "الرقم السري",
  "رمز التحقق",
  // payment and bank
  "credit card",
  "debit card",
  "direct debit",
  "card number",
  "card holder",
  "cardholder",
  "name on card",
  "card expiry",
  "card expiration",
  "card verification",
  "cc number",
  "cc exp",
  "cvv",
  "cvv2",
  "cvc",
  "cvc2",
  "cvn",
  "iban",
  "rib",
  "swift code",
  "bic code",
  "routing number",
  "sort code",
  "account number",
  "account no",
  "acct number",
  "bank account",
  "kontonummer",
  "bankleitzahl",
  "kartennummer",
  "kreditkarte",
  "carte bancaire",
  "carte de credit",
  "numero de carte",
  "numero de compte",
  "numero de cuenta",
  "numero de tarjeta",
  "tarjeta de credito",
  "tarjeta de debito",
  "رقم الحساب",
  "رقم البطاقة",
  "بطاقة",
  // government, tax and social security ids
  "ssn",
  "sin",
  "nin",
  "tin",
  "nss",
  "bsn",
  "dni",
  "nif",
  "nie",
  "cin",
  "cpf",
  "cnpj",
  "cnic",
  "curp",
  "pesel",
  "cedula",
  "aadhaar",
  "aadhar",
  "codice fiscale",
  "national id",
  "national identification",
  "government id",
  "tax id",
  "tax number",
  "taxpayer",
  "social security",
  "social insurance",
  "national insurance",
  "id number",
  "passport",
  "passeport",
  "pasaporte",
  "reisepass",
  "steuer id",
  "steuernummer",
  "ausweisnummer",
  "personalausweis",
  "sozialversicherungsnummer",
  "carte d identite",
  "piece d identite",
  "numero de securite sociale",
  "documento de identidad",
  "numero de identificacion",
  "جواز السفر",
  "رقم الجواز",
  "رقم الهوية",
  "الرقم الوطني",
  "الهوية الوطنية",
  "رقم بطاقة التعريف الوطنية",
  "بطاقة التعريف",
  // birth
  "dob",
  "birthday",
  "date of birth",
  "birth date",
  "year of birth",
  "maiden name",
  "geburtsdatum",
  "date de naissance",
  "fecha de nacimiento",
  "تاريخ الميلاد",
  // equal opportunity and other protected categories: kept out of the bank and the log
  "gender",
  "genre",
  "genero",
  "geschlecht",
  "sex",
  "sexe",
  "sexo",
  "الجنس",
  "sexual orientation",
  "orientation sexuelle",
  "sexuelle orientierung",
  "orientacion sexual",
  "transgender",
  "lgbtq",
  "ethnicity",
  "ethnic",
  "origine ethnique",
  "ethnische herkunft",
  "race",
  "racial",
  "hispanic",
  "disability",
  "disabled",
  "handicap",
  "behinderung",
  "discapacidad",
  "الإعاقة",
  "religion",
  "religious",
  "الديانة",
  "الدين",
  "veteran",
  "marital status",
  "familienstand",
  "estado civil",
  "statut marital",
  "situation familiale",
  "الحالة الاجتماعية",
  "criminal",
  "convict",
  "convicted",
  "conviction",
  "felony",
  "health",
  "medical",
  "political",
  "union membership",
  "trade union",
  "salary history",
].map((phrase) => ` ${normalizeLabel(phrase)} `)

/** Bare labels that only mean a card's expiry on a payment form: `Visa expiry date` is something else. */
const EXPIRY_LABELS = new Set([
  "expiry",
  "expiry date",
  "expiration",
  "expiration date",
  "exp date",
  "mm yy",
  "mm yyyy",
])

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

/** Only compounds no ordinary question contains. */
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
  "kreditkarte",
  "securitycode",
  "securityquestion",
  "securityanswer",
  "verificationcode",
  "onetimecode",
  "onetimepassword",
  "accountnumber",
  "socialsecurity",
  "socialinsurance",
  "nationalinsurance",
  "identitynumber",
  "documentodeidentidad",
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
const SENSITIVE_AUTOCOMPLETE =
  /(^|\s)(cc-[a-z-]+|one-time-code|new-password|current-password|bday(-[a-z]+)?|sex|gender)(\s|$)/i

/** A bare `pin` is a secret, `pin code` is a postal code. */
function isPinSecret(padded: string): boolean {
  return padded.includes(" pin ") && !padded.includes(" pin code ")
}

/** Whether a field's value may be stored and filled back later. Case, spaces and zero-width characters in `type` can't dodge it. */
export function isLearnableField(field: { label: string; type?: string; autocomplete?: string }): boolean {
  if (!controlKind(field.type)) return false
  if (field.autocomplete && SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) return false
  const label = normalizeLabel(field.label)
  if (label.length === 0 || EXPIRY_LABELS.has(label)) return false
  const padded = ` ${label} `
  if (PHRASES.some((phrase) => padded.includes(phrase)) || isPinSecret(padded)) return false
  const squashed = squash(field.label)
  return !SQUASHED.some((word) => squashed.includes(word))
}

function luhn(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

function ibanValid(compact: string): boolean {
  const rearranged = compact.slice(4) + compact.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const chunk = char >= "A" ? String(char.charCodeAt(0) - 55) : char
    for (const digit of chunk) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

/**
 * A language-independent backstop for labels no list thinks of: a value that is a card number (13 to 19 digits that pass
 * Luhn), a valid IBAN or a US social security number is never stored or filled, whatever its field is called.
 */
export function isSensitiveValue(value: string): boolean {
  const text = value.trim()
  if (/^\d{3}-\d{2}-\d{4}$/.test(text)) return true
  const digits = text.replace(/[\s-]/g, "")
  if (/^\d{13,19}$/.test(digits) && luhn(digits)) return true
  const compact = text.replace(/\s/g, "").toUpperCase()
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact) && ibanValid(compact)
}
