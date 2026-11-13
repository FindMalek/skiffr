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

/** Look-alike letters from other scripts that a page could use to spell a word the lists know. */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "i",
  ѕ: "s",
  ј: "j",
  ԁ: "d",
  һ: "h",
  ո: "n",
  ɡ: "g",
}

/**
 * The form a label is matched in: lowercase, no accents, punctuation or format characters (a zero width space inside a
 * word is gone), look-alike letters folded to latin, and the arabic letters that only differ by dots or hamza folded
 * (ة to ه, ى to ي; hamza and diacritics are already dropped with the accents). The lists are folded the same way.
 */
function foldConfusables(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\u0400-\u04ff\u0500-\u052f\u0531-\u0587\u0250-\u02af]/gu, (char) => CONFUSABLES[char] ?? char)
}

function clean(text: string): string {
  return normalizeLabel(
    foldConfusables(text)
      .replace(/\u0649/g, "\u064a")
      .replace(/\u0629/g, "\u0647")
      .replace(/\u0640/g, ""),
  )
}

/** The broad control a type belongs to, `null` for types that are never learned. Case, spaces and zero-width characters can't dodge it. */
export function controlKind(type: string | undefined): ControlKind | null {
  return KINDS[kindKey(type)] ?? null
}
/**
 * Word lists the guard matches a label against. Everything is raw text: the engine folds case, accents, look-alike
 * letters and punctuation the same way for the lists and for the label.
 */
export type WordLists = {
  /** Whole words or phrases, padded so a short word never matches inside another. */
  phrases: string[]
  /** Beginnings of words: `certif` is certify, certified and certification. */
  stems: string[]
  /** Long stems matched inside a word (german compounds, arabic prefixes). */
  inside: string[]
  /** Short arabic words, matched as whole words with the article or a one letter prefix. */
  arabicWords: string[]
  /** Labels that are private only when they stand alone: `Visa expiry date` and `Country code` are something else. */
  bareLabels: string[]
  barePrivate: string[]
  /** Compounds matched after the label is run together and look-alike digits are mapped back to letters. */
  squashed: string[]
  squashStems: string[]
  /** Headings under which every question is private. */
  sectionStems: string[]
  /** Answers only a demographic or protected category question has. */
  optionPhrases: string[]
}

/**
 * The floor: the part of the guard that ships in the content script. It stays small on purpose and works offline: secrets,
 * payments and ids, birth, the protected categories and consent in the main wording of en fr de es ar. Longer tails of
 * wording are the server's job (`learnable-extended.ts`, then the model verdict of `ai.mapFields`).
 */
export const FLOOR: WordLists = {
  phrases: [
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
    "codigo de verificacion",
    "sicherheitscode",
    "verifizierungscode",
    "كلمة المرور",
    "كلمة السر",
    "الرقم السري",
    "رمز التحقق",
    "code secret",
    "code pin",
    "geheimzahl",
    "كلمة مرور",
    "رمز المرور",
    "رمز سري",
    // payment and bank
    "credit card",
    "debit card",
    "card number",
    "card holder",
    "cardholder",
    "name on card",
    "card expiry",
    "card expiration",
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
    "حساب بنكي",
    "الحساب البنكي",
    "kartenprufnummer",
    "cryptogramme",
    "security number",
    "card no",
    "kontoinhaber",
    "karteninhaber",
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
    "curp",
    "pesel",
    "aadhaar",
    "aadhar",
    "codice fiscale",
    "national id",
    "government id",
    "tax id",
    "tax number",
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
    "personalausweis",
    "sozialversicherungsnummer",
    "carte d identite",
    "numero de securite sociale",
    "documento de identidad",
    "numero de seguridad social",
    "جواز السفر",
    "رقم الهوية",
    "الهوية الوطنية",
    "الضمان الاجتماعي",
    "الرقم الضريبي",
    "securite sociale",
    "seguridad social",
    // birth, age
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
    "place of birth",
    "birthplace",
    "lieu de naissance",
    "geburtsort",
    "lugar de nacimiento",
    "مكان الميلاد",
    "how old",
    "years old",
    // protected categories
    "gender",
    "genre",
    "genero",
    "geschlecht",
    "sex",
    "sexe",
    "sexo",
    "الجنس",
    "pronouns",
    "pronoun",
    "pronoms",
    "pronomen",
    "pronombres",
    "الضمائر",
    "sexual orientation",
    "orientation sexuelle",
    "sexuelle orientierung",
    "orientacion sexual",
    "ميول جنسيه",
    "lgbt",
    "lgbtq",
    "transgender",
    "ethnicity",
    "ethnic",
    "origine ethnique",
    "ethnische herkunft",
    "origen etnico",
    "etnia",
    "ethnie",
    "race",
    "racial",
    "raza",
    "العرق",
    "الأصل العرقي",
    "hispanic",
    "disability",
    "disabled",
    "handicap",
    "behinderung",
    "discapacidad",
    "الإعاقة",
    "veteran",
    "military",
    "armed forces",
    "army",
    "service militaire",
    "wehrdienst",
    "servicio militar",
    "خدمه عسكريه",
    "الجيش",
    "religion",
    "religious",
    "religieux",
    "religios",
    "konfession",
    "الدين",
    "الديانة",
    "creencias religiosas",
    "marital status",
    "marital",
    "etat civil",
    "familienstand",
    "estado civil",
    "situation familiale",
    "الحالة الاجتماعية",
    "pregnant",
    "pregnancy",
    "enceinte",
    "schwanger",
    "embarazada",
    "criminal",
    "casier judiciaire",
    "vorstrafe",
    "vorstrafen",
    "antecedentes penales",
    "السجل الجنائي",
    "السوابق القضائية",
    "convicted",
    "conviction",
    "felony",
    "union membership",
    "trade union",
    "gewerkschaft",
    "afiliacion sindical",
    "نقابه",
    "health",
    "sante",
    "gesundheit",
    "salud",
    "medical",
    "etat de sante",
    "gesundheitszustand",
    "estado de salud",
    "الحالة الصحية",
    "nationality",
    "nationalite",
    "nacionalidad",
    "staatsangehorigkeit",
    "الجنسية",
    "national origin",
    "salary history",
    "political",
    "spouse",
    "number of children",
    "nombre d enfants",
    "anzahl der kinder",
    "numero de hijos",
    "عدد الاطفال",
    "eeo",
    "eeoc",
    "identify as",
    "how do you identify",
    "best describes you",
    "person of color",
    "people of color",
    "person of colour",
    "people of colour",
    "sexual preference",
    "caste",
    "ancien combattant",
    "anciens combattants",
    "anrede",
    "civilite",
    "wie alt",
    "cuantos anos",
    "النوع الاجتماعي",
    "i identify",
    // consent, agreement, opt in
    "terms",
    "privacy",
    "gdpr",
    "cookie",
    "cookies",
    "hereby",
    "opt in",
    "opt out",
    "unsubscribe",
    "newsletter",
    "marketing emails",
    "marketing communications",
    "promotional",
    "i understand",
    "i accept",
    "i confirm",
    "i have read",
    "read and understood",
    "i authorize",
    "i authorise",
    "i agree",
    "agree to",
    "agree with",
    "you agree",
    "agreement",
    "talent community",
    "talent pool",
    "future opportunities",
    "data retention",
    "data processing",
    "data protection",
    "terms and conditions",
    "conditions generales",
    "consentement",
    "j accepte",
    "je certifie",
    "j ai lu",
    "confidentialite",
    "einwilligung",
    "zustimmung",
    "ich stimme",
    "einverstanden",
    "datenschutz",
    "nutzungsbedingungen",
    "agb",
    "ich akzeptiere",
    "consentimiento",
    "acepto",
    "terminos",
    "condiciones",
    "privacidad",
    "proteccion de datos",
    "declaro",
    "autorizo",
    "أوافق",
    "موافقة",
    "الشروط",
    "الأحكام",
    "الخصوصية",
    "أقر",
    "je consens",
    "j autorise",
    "rgpd",
    "dsgvo",
    "consiento",
    "estoy de acuerdo",
    "ich willige ein",
    "ich habe gelesen",
    // permission, signatures
    "may we contact",
    "can we contact",
    "could we contact",
    "contact your current employer",
    "contact your previous employer",
    "contact your employer",
    "contact your references",
    "contact references",
    "i allow",
    "allow us to",
    "you may contact",
    "keep me in the loop",
    "future openings",
    "similar jobs",
    "accord",
    "mon accord",
    "j accorde",
    "erlaubnis",
    "job alerts",
    "job alert",
    "signature",
    "e signature",
    "electronic signature",
    "digital signature",
    "sign here",
    "date signed",
    "signed by",
    "typed name",
    "unterschrift",
    "unterschreiben",
    "firma electronica",
    "firma del solicitante",
    "firma del candidato",
    "firma digital",
    "signez ici",
    "date de signature",
    "contacter votre employeur",
    "contacter vos references",
    "arbeitgeber kontaktieren",
    "referenzen kontaktieren",
    "contactar a su empleador",
    "contactar a sus referencias",
    "توقيع",
    "اذن",
  ],
  stems: [
    "consent",
    "consens",
    "consient",
    "acknowledg",
    "certify",
    "certified",
    "declare",
    "declaration",
    "arbitrat",
    "self identif",
    "equal employment",
    "equal opportunit",
    "subscri",
    "pronom",
    "pronoun",
    "veteran",
    "pregnan",
    "underrepresent",
    "lgbt",
    "sexual orient",
    "disabilit",
    "ethnic",
    "religio",
    "nationalit",
    "willig",
    "zustimm",
    "einverstanden",
  ],
  inside: [
    "datenschutz",
    "behinderung",
    "einwillig",
    "nutzungsbedingung",
    "staatsangehor",
    "staatsburger",
    "unterzeichn",
    "gewerkschaft",
    "geschlecht",
    "geburts",
    "konfession",
    "schwanger",
    "herkunft",
    "diskriminier",
    "عرقي",
    "اثني",
    "ميلاد",
    "موافقت",
    "اسمح",
    "اشتراك",
    "تفويض",
    "توقيع",
    "جنسيه",
    "اعاقه",
    "خصوصيه",
    "موافقه",
    "اقرار",
    "احكام",
    "شروط",
    "ديانه",
    "معتقد",
    "عسكري",
  ],
  arabicWords: [
    "جنس",
    "اذن",
    "عمري",
    "عمرك",
    "عرق",
    "سن",
    "عمر",
    "دين",
    "ذكر",
    "انثي",
    "حامل",
    "جيش",
    "محارب",
    "ضمير",
    "اصل",
    "اقر",
    "اصرح",
    "اتعهد",
    "اوافق",
    "وافقت",
    "اؤكد",
  ],
  bareLabels: [
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
  ],
  barePrivate: ["النوع", "نوع", "genre", "alter", "sex", "firma"],
  squashed: [
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
    "verificationcode",
    "accountnumber",
    "socialsecurity",
    "maidenname",
    "dateofbirth",
    "birthdate",
    "datedenaissance",
    "fechadenacimiento",
    "kartenprufnummer",
    "geheimzahl",
  ],
  squashStems: [
    "gender",
    "pronoun",
    "ethnic",
    "religio",
    "veteran",
    "disabilit",
    "pregnan",
    "transgender",
    "nationalit",
    "consent",
    "sexualorient",
    "maritalstatus",
  ],
  sectionStems: [
    "eeo",
    "equal employment",
    "equal opportunit",
    "self identif",
    "voluntary",
    "demograph",
    "diversit",
    "veteran",
    "disabilit",
    "consent",
    "agreement",
    "privacy",
    "terms",
    "arbitrat",
    "gdpr",
    "data protection",
    "diversite",
    "vielfalt",
    "diversidad",
    "datenschutz",
    "التنوع",
    "المساواه",
  ],
  optionPhrases: [
    "decline to self identify",
    "decline to identify",
    "prefer not to say",
    "prefer not to answer",
    "prefer not to disclose",
    "do not wish to",
    "non binary",
    "nonbinary",
    "genderqueer",
    "transgender",
    "cisgender",
    "hispanic",
    "latino",
    "protected veteran",
    "heterosexual",
    "bisexual",
    "homosexual",
    "two or more races",
    "native hawaiian",
    "pacific islander",
    "american indian",
    "alaska native",
    "african american",
    "i have a disability",
    "i do not have a disability",
    "i am a veteran",
    "keine angabe",
    "prefiero no",
    "je prefere ne pas",
    "ancien combattant",
    "لا اريد",
    "ذكر",
    "انثي",
    "افضل عدم",
  ],
}

const EMPTY_LISTS: WordLists = {
  phrases: [],
  stems: [],
  inside: [],
  arabicWords: [],
  bareLabels: [],
  barePrivate: [],
  squashed: [],
  squashStems: [],
  sectionStems: [],
  optionPhrases: [],
}

/** Browsers' own hint of what a control holds. It doesn't depend on the label's language. */
const SENSITIVE_AUTOCOMPLETE =
  /(^|\s)(cc-[a-z-]+|one-time-code|new-password|current-password|bday(-[a-z]+)?|sex|gender)(\s|$)/i

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

/** The label and each tail of it after a section prefix (`Payment details: Code` also reads `Code`), normalized. */
function ownLabels(label: string): string[] {
  const parts = label.split(/:\s+/)
  return parts.map((_, index) => normalizeLabel(parts.slice(index).join(" ")))
}

/** A bare `pin` is a secret, `pin code` is a postal code. */
const isPinSecret = (padded: string) => padded.includes(" pin ") && !padded.includes(" pin code ")

/** "Age" and "your age" are about the person; "age of your oldest project" is not. */
function isAgeQuestion(label: string): boolean {
  return /\bage\b/.test(label) && !/\bage of (your|the|a|an|this|that|my|each|any)\b/.test(label)
}

const WORK_FRAMING =
  /\b(work|working|employment|employed|travail|travailler|trabajar|trabajo|trabalhar|trabalho|arbeit\w*|empleo|visa|permit|permis|sponsor|legally|legal|eligible|elegible|berechtigt)\b|عمل/

/** Authorization is permission to act in the person's name, unless it is the work authorization question. */
function isPermissionToAct(label: string): boolean {
  return (
    /\b(authori[sz]\w*|autoris\w*|autoriz\w*|ermachtig\w*|genehmig\w*|permiso|permission)/.test(label) &&
    !WORK_FRAMING.test(label)
  )
}

const LICENCE =
  /(driv\w* licen|driver s licen|permis de conduire|licencia de conducir|carnet de conducir|fuhrerschein|رخصه القياده|رخصه السياقه)/
const LICENCE_QUESTION = /\b(do you|have|hold|valid|possess|own|avez|tiene|tienes|haben|besitzen|verfugen)\b|هل/
const LICENCE_KIND = /\b(class|type|category|categories|status)\b/
const NUMBERISH = /\b(number|no|num|numero|nummer|id)\b|رقم/

/** A driving licence number is an id; "do you have a valid driver's licence?" and "licence class" are ordinary. */
function isLicenceNumber(label: string): boolean {
  return LICENCE.test(label) && (NUMBERISH.test(label) || !(LICENCE_QUESTION.test(label) || LICENCE_KIND.test(label)))
}

/** Citizenship is a protected status, except where it is plainly the work authorization question. */
function isCitizenshipStatus(label: string): boolean {
  return (
    /\bcitizen/.test(label) &&
    !/\b(authori[sz]|eligible|right to work|work permit|permit to work|visa|sponsor)/.test(label)
  )
}

const set = (...words: string[]): ReadonlySet<string> => new Set(words.map(clean))
const HONORIFICS = set(
  "Mr",
  "Mrs",
  "Ms",
  "Miss",
  "Mx",
  "Herr",
  "Frau",
  "Monsieur",
  "Madame",
  "Mademoiselle",
  "Señor",
  "Señora",
  "Sr",
  "Sra",
  "السيد",
  "السيدة",
)
const MARITAL = set(
  "Single",
  "Married",
  "Divorced",
  "Widowed",
  "Separated",
  "Célibataire",
  "Marié",
  "Mariée",
  "Divorcé",
  "Veuf",
  "Ledig",
  "Verheiratet",
  "Geschieden",
  "Verwitwet",
  "Soltero",
  "Casado",
  "Divorciado",
  "Viudo",
  "أعزب",
  "متزوج",
  "مطلق",
  "أرمل",
)
const BELIEFS = set(
  "Christian",
  "Muslim",
  "Jewish",
  "Hindu",
  "Buddhist",
  "Sikh",
  "Atheist",
  "Agnostic",
  "Catholic",
  "Protestant",
  "Chrétien",
  "Musulman",
  "Juif",
  "Bouddhiste",
  "Christlich",
  "Muslimisch",
  "Jüdisch",
  "Cristiano",
  "Musulmán",
  "Judío",
  "مسلم",
  "مسيحي",
  "يهودي",
)
const RACES = set(
  "Asian",
  "White",
  "Black",
  "Caucasian",
  "African",
  "Arab",
  "Blanc",
  "Noir",
  "Asiatique",
  "Weiß",
  "Schwarz",
  "Asiatisch",
  "Blanco",
  "Negro",
  "Asiático",
  "أبيض",
  "أسود",
  "آسيوي",
)
/** "18-24", "25 to 34", "65+", "Under 25", "65 or older". */
const AGE_BAND = /^\s*(under\s*\d{2}|\d{2}\s*(-|–|to)\s*\d{2}|\d{2}\s*\+|\d{2}\s*(or|and)\s*(older|over|above))\s*$/

export type QuestionText = {
  label?: string
  /** The control's name or id, read as words (`job_application[gender]`). */
  name?: string
  autocomplete?: string
  options?: readonly string[]
  /** Headings and legends above the control. */
  sections?: readonly string[]
}

export type Guard = {
  /** Whether a field's value may be stored and filled back later. Case, spaces and zero-width characters in `type` can't dodge it. */
  isLearnableField: (field: { label: string; type?: string; autocomplete?: string }) => boolean
  /** A section heading (equal opportunity, self identification, diversity, consent) under which every question is private. */
  isSensitiveSection: (heading: string) => boolean
  /** Answers that only a demographic or protected category question has: Male and Female, "Decline to self identify", "Hispanic". */
  isDemographicOptions: (options: readonly string[]) => boolean
  /**
   * Whether a question is one the person answers themselves, whatever control draws it (text, select, combobox, radio or
   * button row): private by its own label or name, by the browser's hint, by the shape of its answers or by the section
   * it sits under. It errs towards blocking: a question about age, terms or "agree to relocate" is left to the person too.
   */
  isSensitiveQuestion: (question: QuestionText) => boolean
}

/** Compiles lists into a guard. Lists given later add to the earlier ones. */
export function createGuard(...parts: Partial<WordLists>[]): Guard {
  const lists = Object.fromEntries(
    (Object.keys(EMPTY_LISTS) as (keyof WordLists)[]).map((key) => [key, parts.flatMap((part) => part[key] ?? [])]),
  ) as WordLists
  const cleaned = (words: string[]) => words.map(clean)
  const alternation = (words: string[]) => cleaned(words).join("|")

  const phrases = cleaned(lists.phrases).map((phrase) => ` ${phrase} `)
  const stemPattern = new RegExp(`(^| )(${alternation(lists.stems)})`)
  const inside = cleaned(lists.inside)
  const arabicWords = new RegExp(`(^| )(ال|لل|بال|وال|فال|ل|ب|و)?(${alternation(lists.arabicWords)})( |$)`)
  const bareLabels = new Set(cleaned(lists.bareLabels))
  const barePrivate = new Set(cleaned(lists.barePrivate))
  const squashed = lists.squashed
  const squashStems = lists.squashStems
  const sectionPattern = new RegExp(`(^| )(${alternation(lists.sectionStems)})`)
  const optionPattern = new RegExp(`(^| )(${alternation(lists.optionPhrases)})`)

  function isLearnableField(field: { label: string; type?: string; autocomplete?: string }): boolean {
    if (!controlKind(field.type)) return false
    if (field.autocomplete && SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) return false
    const label = clean(field.label)
    if (label.length === 0 || ownLabels(field.label).some((own) => bareLabels.has(own))) return false
    if (ownLabels(field.label).some((own) => barePrivate.has(clean(own)))) return false
    const padded = ` ${label} `
    if (phrases.some((phrase) => padded.includes(phrase)) || stemPattern.test(label) || isPinSecret(padded))
      return false
    if (inside.some((stem) => label.includes(stem)) || arabicWords.test(label)) return false
    if (isCitizenshipStatus(label) || isAgeQuestion(label) || isPermissionToAct(label) || isLicenceNumber(label))
      return false
    const run = squash(foldConfusables(field.label))
    return !squashed.some((word) => run.includes(word)) && !squashStems.some((stem) => run.includes(stem))
  }

  function isDemographicOptions(options: readonly string[]): boolean {
    const texts = options.map(clean)
    if (texts.some((text) => optionPattern.test(text))) return true
    const both = (a: string, b: string) => texts.includes(a) && texts.includes(b)
    const several = (words: ReadonlySet<string>) => texts.filter((text) => words.has(text)).length >= 2
    const bands = options.filter((text) => AGE_BAND.test(text.toLowerCase())).length >= 2
    return (
      both("male", "female") ||
      both("man", "woman") ||
      both("homme", "femme") ||
      both("mann", "frau") ||
      both("mannlich", "weiblich") ||
      both("hombre", "mujer") ||
      both("masculin", "feminin") ||
      both("masculino", "femenino") ||
      several(HONORIFICS) ||
      several(MARITAL) ||
      several(BELIEFS) ||
      several(RACES) ||
      bands
    )
  }

  const isSensitiveSection = (heading: string) => sectionPattern.test(clean(heading))

  function isSensitiveQuestion({ label, name, autocomplete, options, sections }: QuestionText): boolean {
    const privateText = (text: string | undefined, hint?: string) =>
      text !== undefined && text.trim() !== "" && !isLearnableField({ label: text, type: "text", autocomplete: hint })
    const named = (name ?? "").replace(/[_[\].-]+/g, " ")
    return (
      privateText(label) ||
      privateText(named) ||
      (autocomplete !== undefined && privateText("field", autocomplete)) ||
      (options !== undefined && isDemographicOptions(options)) ||
      (sections ?? []).some(isSensitiveSection)
    )
  }

  return { isLearnableField, isSensitiveSection, isDemographicOptions, isSensitiveQuestion }
}

const floor = createGuard(FLOOR)
export const { isLearnableField, isSensitiveSection, isDemographicOptions, isSensitiveQuestion } = floor

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

/**
 * Nine digits grouped 3-2-4 like a US social security number: no area of 000, 666 or 900 and up, no group of 00, no
 * serial of 0000. Nine digits with no grouping are left alone, they are as likely a phone number.
 */
function ssnShaped(value: string): boolean {
  const match = /^(\d{3})[\s.-](\d{2})[\s.-](\d{4})$/.exec(value.trim())
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
  if (ssnShaped(value) || nirValid(compact)) return true
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact) && ibanValid(compact)
}
