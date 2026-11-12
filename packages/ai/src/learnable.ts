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
  "geheimzahl",
  "geheimnummer",
  "code secret",
  "code pin",
  "codigo secreto",
  "clave secreta",
  "kartenprufnummer",
  "kartenprufziffer",
  "card security",
  "security no",
  "security number",
  "cryptogramme",
  "رمز المرور",
  "كلمة مرور",
  "رمز سري",
  "الرمز السري",
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
  "card no",
  "card holder name",
  "account holder",
  "acct no",
  "bic swift",
  "swift bic",
  "compte bancaire",
  "cuenta bancaria",
  "bankverbindung",
  "bankkonto",
  "kontonr",
  "konto nr",
  "kontoinhaber",
  "karteninhaber",
  "n de compte",
  "no de compte",
  "num de compte",
  "numero compte",
  "n de cuenta",
  "no de cuenta",
  "num de cuenta",
  "num cuenta",
  "numero cuenta",
  "titulaire de la carte",
  "titulaire de carte",
  "nom du titulaire",
  "nombre del titular",
  "titular de la tarjeta",
  "titular de tarjeta",
  "حساب بنكي",
  "الحساب البنكي",
  "الحساب المصرفي",
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
  "visa number",
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
  "numero de seguridad social",
  "seguridad social",
  "securite sociale",
  "num de secu",
  "n de secu",
  "no de secu",
  "numero de secu",
  "numero fiscal",
  "numero d identification fiscale",
  "identifiant fiscal",
  "numero de identificacion fiscal",
  "rentenversicherung",
  "permis de conduire",
  "licencia de conducir",
  "carnet de conducir",
  "driving licence",
  "driving license",
  "رخصة القيادة",
  "رخصة السياقة",
  "الرقم الضريبي",
  "رقم ضريبي",
  "رقم التعريف الضريبي",
  "رقم الضمان الاجتماعي",
  "الضمان الاجتماعي",
  // birth
  "dob",
  "d o b",
  "birthday",
  "date of birth",
  "birth date",
  "year of birth",
  "maiden name",
  "geburtsdatum",
  "date de naissance",
  "fecha de nacimiento",
  "تاريخ الميلاد",
  "geburtstag",
  "geburtsname",
  "anniversaire",
  "cumpleanos",
  "nom de jeune fille",
  "nom de naissance",
  "apellido de soltera",
  "apellido de nacimiento",
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
  "confession",
  "konfession",
  "creencias religiosas",
  "origen etnico",
  "origen racial",
  "etnia",
  "ethnie",
  "ethnicite",
  "raza",
  "veteran",
  "marital status",
  "familienstand",
  "estado civil",
  "statut marital",
  "situation familiale",
  "الحالة الاجتماعية",
  "criminal",
  "casier judiciaire",
  "vorstrafe",
  "vorstrafen",
  "fuhrungszeugnis",
  "antecedentes penales",
  "السجل الجنائي",
  "السوابق القضائية",
  "convict",
  "convicted",
  "conviction",
  "felony",
  "health",
  "sante",
  "etat de sante",
  "gesundheit",
  "gesundheitszustand",
  "salud",
  "estado de salud",
  "الحالة الصحية",
  "الصحة",
  "medical",
  "political",
  "union membership",
  "trade union",
  "salary history",
].map((phrase) => ` ${normalizeLabel(phrase)} `)

/** Whole labels that are private only when they stand alone: `Visa expiry date` and `Country code` are something else. */
const BARE_LABELS = new Set([
  "code",
  "bic",
  "nir",
  "clabe",
  "card",
  "cc",
  "ccv",
  "date d expiration",
  "fecha de caducidad",
  "fecha de vencimiento",
  "ablaufdatum",
  "gultig bis",
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
  "driverlicen",
  "driverslicen",
  "visanumber",
  "maidenname",
  "dateofbirth",
  "birthdate",
  "yearofbirth",
  "datedenaissance",
  "fechadenacimiento",
  "numerodesecuritesociale",
  "numerodeseguridadsocial",
  "sozialversicherung",
  "rentenversicherung",
  "steueridentifikation",
  "steuerid",
  "fuhrerschein",
  "permisdeconduire",
  "licenciadeconducir",
  "carnetdeconducir",
  "kartenprufnummer",
  "kontoinhaber",
  "karteninhaber",
  "bankverbindung",
  "geheimzahl",
  "ايبان",
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
  if (label.length === 0 || BARE_LABELS.has(label)) return false
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

const EASTERN_DIGITS = /[\u0660-\u0669\u06f0-\u06f9]/g

/** Ascii digits for arabic-indic ones, the text after a `card:` or `IBAN:` style prefix, and one run of digits or letters with no separators. */
function compactOf(value: string): string {
  const ascii = value.trim().replace(EASTERN_DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf))
  return ascii
    .replace(/^[^:]{0,20}:\s*/, "")
    .replace(/^iban\b\s*/i, "")
    .replace(/[\s.-]/g, "")
    .toUpperCase()
}

/** French NIR: 15 digits whose last two are the control key of the first 13. Corsica's 2A and 2B count as 19 and 18. */
function nirValid(compact: string): boolean {
  if (!/^[12]\d{4}(?:\d{2}|2[AB])\d{6}\d{2}$/.test(compact)) return false
  const body = compact.slice(0, 13).replace("2A", "19").replace("2B", "18")
  return 97 - (Number(body) % 97) === Number(compact.slice(13))
}

/** Nine digits shaped like a US social security number: no area of 000, 666 or 900 and up, no group of 00, no serial of 0000. */
function ssnShaped(compact: string): boolean {
  const match = /^(\d{3})(\d{2})(\d{4})$/.exec(compact)
  if (!match) return false
  const [, area, group, serial] = match
  return area !== "000" && area !== "666" && Number(area) < 900 && group !== "00" && serial !== "0000"
}

/**
 * A language-independent backstop for labels no list thinks of: a value that is a card number (13 to 19 digits that pass
 * Luhn), a valid IBAN, a French NIR or a US social security number is never stored or filled, whatever its field is
 * called. Spaces, dots and dashes between the groups, a `card:` or `IBAN` prefix and arabic-indic digits do not hide it.
 */
export function isSensitiveValue(value: string): boolean {
  if (/^\d{3}-\d{2}-\d{4}$/.test(value.trim())) return true
  const compact = compactOf(value)
  if (/^\d{13,19}$/.test(compact) && luhn(compact)) return true
  if (ssnShaped(compact) || nirValid(compact)) return true
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact) && ibanValid(compact)
}
