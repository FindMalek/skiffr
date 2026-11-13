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
 * (ة to ه, ى to ي; hamza and diacritics are already dropped with the accents), and the turkish ı and polish Ł and ł that no accent folding reaches. The lists are folded the same way.
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
      .replace(/\u0640/g, "")
      .replace(/\u0131/g, "i")
      .replace(/[\u0141\u0142]/g, "l"),
  )
}

/** The broad control a type belongs to, `null` for types that are never learned. Case, spaces and zero-width characters can't dodge it. */
export function controlKind(type: string | undefined): ControlKind | null {
  return KINDS[kindKey(type)] ?? null
}

/** Built on first use, so a bundle that never calls what needs a pattern or a list does not ship it. */
const lazy = <T>(make: () => T): (() => T) => {
  let value: T | undefined
  return () => (value ??= make())
}

/** Lists are written as `a|b|c` chunks, one string per line instead of one quoted item per word. Folded and deduped here. */
const words = (lists: readonly string[]): string[] =>
  [...new Set(lists.join("|").split("|").map(clean))].filter(Boolean)
const alternation = (lists: readonly string[]): string => words(lists).join("|")

/**
 * Word lists the guard matches a label against. Each entry is a chunk of words or phrases joined with `|`; the engine folds
 * case, accents, look-alike letters and punctuation the same way for the lists and for the label.
 */
export type WordLists = {
  /** Whole words or phrases of the folded label. */
  phrases: string[]
  /** Beginnings of words: `certif` is certify, certified and certification. */
  stems: string[]
  /** Long stems matched inside a word (german compounds, arabic, where the article and prefixes do not matter). */
  inside: string[]
  /** Short arabic words, matched as whole words with the article or a one letter prefix. */
  arabic: string[]
  /** Labels that are private only as a whole: the arabic "type" is also a word in "job type". */
  barePrivate: string[]
  /** Bare words of it, tr and pl that are private as the first or last word of a short label. */
  bareEdge: string[]
  /** Labels that are private only when they stand alone: `Visa expiry date` and `Country code` are something else. */
  bareLabels: string[]
  /** Compounds matched after the label is run together and look-alike digits are mapped back to letters. */
  squashed: string[]
  squashStems: string[]
  /** Headings under which every question is private. */
  sectionStems: string[]
  /** Answers only a demographic or protected category question has. */
  options: string[]
}

/**
 * The floor: the part of the guard that ships in the content script. It stays small on purpose and works offline: secrets,
 * payments and ids, birth, the protected categories and consent in the main wording of en fr de es ar and the first
 * pass of it pt nl tr pl. Longer tails of wording are the server's job (`learnable-extended.ts`, then the model verdict
 * of `ai.mapFields`). The rules below (contact, permission, age, licence) are code, not lists, and ship whole.
 */
export const FLOOR: WordLists = {
  phrases: [
    "password|passcode|passphrase|passwort|kennwort|pwd|otp|secret|token|api key|2fa|mfa|authenticator",
    "backup code|recovery code|sms code|verification code|security code|security question|security answer",
    "one time code|mot de passe|code de securite|code de verification|contrasena|codigo de verificacion",
    "sicherheitscode|verifizierungscode|كلمه المرور|كلمه السر|الرقم السري|رمز التحقق|geheimzahl|code pin",
    "kartenprufnummer|security number|cryptogramme|رمز المرور|كلمه مرور|رمز سري|credit card|debit card",
    "card number|card holder|cardholder|name on card|card expiry|card expiration|cc number|cc exp|cvv|cvv2",
    "cvc|cvc2|cvn|iban|rib|swift code|bic code|routing number|sort code|account number|bank account",
    "kontonummer|bankleitzahl|kartennummer|kreditkarte|carte bancaire|carte de credit|numero de carte",
    "numero de compte|numero de cuenta|numero de tarjeta|tarjeta de credito|tarjeta de debito|رقم الحساب",
    "رقم البطاقه|card no|kontoinhaber|karteninhaber|حساب بنكي|الحساب البنكي|ssn|sin|nin|tin|nss|bsn|dni|nif",
    "nie|cin|cpf|cnpj|curp|pesel|aadhaar|aadhar|codice fiscale|national id|government id|tax id|tax number",
    "social security|social insurance|national insurance|id number|visa number|passport|passeport|pasaporte",
    "reisepass|steuer id|steuernummer|personalausweis|sozialversicherungsnummer|carte d identite",
    "documento de identidad|جواز السفر|رقم الهويه|الهويه الوطنيه|seguridad social|securite sociale",
    "الرقم الضريبي|الضمان الاجتماعي|etat civil|dob|d o b|birthday|date of birth|birth date|year of birth",
    "maiden name|gender|genre|genero|sex|sexe|sexo|الجنس|orientation sexuelle|orientacion sexual|transgender",
    "race|racial|hispanic|disabled|handicap|discapacidad|الدين|etnia|ethnie|raza|familienstand|estado civil",
    "situation familiale|الحاله الاجتماعيه|criminal|casier judiciaire|vorstrafe|vorstrafen",
    "antecedentes penales|السجل الجنايي|السوابق القضاييه|convicted|conviction|felony|health|sante|gesundheit",
    "gesundheitszustand|salud|الحاله الصحيه|medical|political|union membership|trade union|salary history",
    "terms|privacy|gdpr|cookie|cookies|hereby|opt in|opt out|unsubscribe|newsletter|marketing emails",
    "marketing communications|promotional|i understand|i accept|i confirm|i have read|read and understood",
    "i authorize|i authorise|keep me in the loop|talent community|talent pool|future opportunities",
    "data retention|data processing|data protection|conditions generales|j accepte|je certifie|j ai lu",
    "confidentialite|ich stimme|agb|acepto|terminos|condiciones|privacidad|proteccion de datos|declaro",
    "autorizo|j autorise|rgpd|ich habe gelesen|dsgvo|akzeptiere|estoy de acuerdo|future openings|similar jobs",
    "job alerts|job alert|signature|sign here|sign below|sign above|date signed|signed by|typed name|accord",
    "j accorde|signez ici|erlaubnis|unterschrift|unterschreiben|firma electronica|firma del solicitante",
    "firma del candidato|firma digital|children|spouse|nombre d enfants|kinder|hijos|afiliacion sindical",
    "wie alt|cuantos anos|عدد الاطفال|نقابه|anrede|civilite|النوع الاجتماعي|origine|origen|العرق|الاصل",
    "person of color|people of color|person of colour|people of colour|caste|how old|years old|birthplace",
    "place of birth|naissance|nacimiento|nacionalidad|military|armed forces|army|ancien combattant",
    "anciens combattants|militaire|wehrdienst|militar|الجيش|creencias|orientierung|marital|enceinte",
    "embarazada|national origin|eeo|eeoc|best describes you|identify as|i identify|do you identify|accetto",
    "autorizzo|informativa|trattamento dei dati|trattamento dei miei dati|termini e condizioni|sesso|razza",
    "data di nascita|luogo di nascita|nazionalita|cittadinanza|disabile|servizio militare",
    "orientamento sessuale|stato civile|firma elettronica|firma qui|consinto|concordo|aceito",
    "termos e condicoes|protecao de dados|raca|origem etnica|data de nascimento|nacionalidade|cidadania",
    "deficiencia|orientacao sexual|akkoord|ik verklaar|voorwaarden|privacyverklaring|geslacht|ras|etniciteit",
    "geboortedatum|beperking|geloofsovertuiging|godsdienst|seksuele geaardheid|burgerlijke staat|handtekening",
    "riza|kabul ediyorum|kvkk|kisisel veri|cinsiyet|irk|etnik|dogum tarihi|engel durumu|mezhep|cinsel yonelim",
    "medeni durum|zgoda|zgode|zgadzam sie|regulamin|rodo|plec|rasa|narodowosc|obywatelstwo|data urodzenia",
    "wyznanie|orientacja seksualna|stan cywilny|i agree|agree to|agree with|you agree|agreement",
  ],
  stems: [
    "consent|consens|consient|acknowledg|certify|certified|declare|declaration|arbitrat|self identif",
    "equal employment|equal opportunit|subscri|pronom|pronoun|veteran|pregnan|underrepresent|lgbt",
    "sexual orient|sexual prefer|disabilit|ethnic|religi|nationalit|willig|zustimm|dichiar|acconsent|assin",
    "onay|imza|uyru|vatandas|engelli|askerlik|oswiadcz|przetwarz|podpis|niepelnospraw|cinsiyet|dogum tarih",
    "dogum yer|dogum yil|medeni|engel durum|dinin|yasin|irkin|mezheb|weteran|wojsk|pelnolet|newslett",
    "nieuwsbrie|d accordo",
  ],
  inside: [
    "datenschutz|behinderung|einwillig|nutzungsbedingung|staatsangehor|staatsburger|unterzeichn|gewerkschaft",
    "geschlecht|geburts|konfession|schwanger|herkunft|diskriminier|عرقي|اثني|ميلاد|موافقت|اسمح|اتصال بصاحب",
    "اتصال بمراجع|اتصال بالمراجع|اتصال بمرجع|اتصال بالمرجع|اتصال بجهه|اتصال بمدير|تواصل مع صاحب",
    "تواصل مع مراجع|تواصل مع المراجع|تواصل مع مرجع|تواصل مع المرجع|تواصل مع جهه|تواصل مع مدير|اشتراك|تفويض",
    "توقيع|جنسيه|اعاقه|خصوصيه|موافقه|اقرار|احكام|شروط|عسكري|معتقد|ديانه",
  ],
  arabic: ["جنس|عمري|عمرك|عرق|سن|عمر|دين|ذكر|انثي|حامل|جيش|محارب|ضمير|اصل|اقر|اصرح|اتعهد|اوافق|وافقت|اوكد"],
  barePrivate: ["النوع|نوع|genre|alter|sex|firma"],
  bareEdge: ["genere|eta|din|yas|wiek"],
  bareLabels: [
    "code|avg|gazi|bic|nir|clabe|card|cc|ccv|date d expiration|fecha de caducidad|fecha de vencimiento",
    "ablaufdatum|gultig bis|expiry|expiry date|expiration|expiration date|exp date|mm yy|mm yyyy",
  ],
  squashed: [
    "password|passcode|passphrase|motdepasse|contrasena|creditcard|debitcard|cardnumber|cartebancaire",
    "numerodecarte|numerodetarjeta|kreditkarte|securitycode|verificationcode|accountnumber|socialsecurity",
    "maidenname|dateofbirth|birthdate|datedenaissance|fechadenacimiento|kartenprufnummer|geheimzahl",
  ],
  squashStems: [
    "gender|pronoun|ethnic|religio|veteran|disabilit|pregnan|transgender|nationalit|consent|sexualorient",
    "maritalstatus",
  ],
  sectionStems: [
    "eeo|equal employment|equal opportunit|self identif|voluntary|demograph|diversit|veteran|disabilit",
    "consent|agreement|privacy|terms|arbitrat|gdpr|data protection|diversite|vielfalt|diversidad",
    "chancengleichheit|egalite des chances|igualdad de oportunidades|datenschutz|التنوع|تكافو الفرص|المساواه",
  ],
  options: [
    "decline to self identify|decline to identify|prefer not to say|prefer not to answer",
    "prefer not to disclose|do not wish to|non binary|nonbinary|genderqueer|transgender|cisgender|hispanic",
    "latino|protected veteran|heterosexual|bisexual|homosexual|two or more races|native hawaiian",
    "pacific islander|american indian|alaska native|african american|i have a disability",
    "i do not have a disability|i am a veteran|keine angabe|prefiero no|je prefere ne pas|ancien combattant",
    "افضل عدم|لا اريد|ذكر|انثي|preferisco non rispondere|preferisco non dire|prefiro nao dizer",
    "prefiro nao responder|zeg ik liever niet|liever niet zeggen|wil ik niet zeggen|belirtmek istemiyorum",
    "cevap vermek istemiyorum|wole nie podawac|wole nie odpowiadac|nie chce podawac",
  ],
}

const EMPTY_LISTS: WordLists = {
  phrases: [],
  stems: [],
  inside: [],
  arabic: [],
  barePrivate: [],
  bareEdge: [],
  bareLabels: [],
  squashed: [],
  squashStems: [],
  sectionStems: [],
  options: [],
}

const ARABIC_PREFIXES = "ال|لل|بال|وال|فال|ل|ب|و"

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

/** Browsers' own hint of what a control holds. It doesn't depend on the label's language. */
const SENSITIVE_AUTOCOMPLETE =
  /(^|\s)(cc-[a-z-]+|one-time-code|new-password|current-password|bday(-[a-z]+)?|sex|gender)(\s|$)/i

/** A bare `pin` is a secret, `pin code` is a postal code. */
function isPinSecret(padded: string): boolean {
  return padded.includes(" pin ") && !padded.includes(" pin code ")
}

/** Whether a field's value may be stored and filled back later. Case, spaces and zero-width characters in `type` can't dodge it. */
/** A page controls its labels: only this many `: ` tails are built, or `a: a: a: ...` is quadratic. */
const OWN_LABEL_TAILS = 20

/** The label and each of its last tails after a section prefix (`Payment details: Code` also reads `Code`), normalized. */
function ownLabels(label: string): string[] {
  const parts = label.split(/:\s+/).filter((part) => /[\p{L}\p{N}]/u.test(part))
  const tails = parts.slice(-OWN_LABEL_TAILS)
  const owns = tails.map((_, index) => clean(tails.slice(index).join(" ")))
  if (tails.length < parts.length) owns.push(clean(label))
  return owns
}

/** "Age" and "your age" are about the person; "age of your oldest project" is not. */
function isAgeQuestion(label: string): boolean {
  return (
    (/\bage\b/.test(label) && !/\bage of (your|the|a|an|this|that|my|each|any)\b/.test(label)) || AGE_YES_NO.test(label)
  )
}

/** "Are you over 21?", "18 or older", "plus de 18 ans": an age asked without the word. "Over 10 years of experience" is not. */
const AGE_YES_NO =
  /\b(?:are|is) you (?:currently )?(?:(?:at least|over|under|above|below|older than|younger than|more than|less than) )?\d{2}\b(?! (?:years?|yrs?) (?:of|experience))|\b\d{2} (?:years )?(?:or|and) (?:older|over|above|younger|under)\b|\b(?:plus|moins) de \d{2} ans\b|\bau moins (?:de )?\d{2} ans\b(?! d experience)|\b(?:etes vous|es tu|etre) (?:majeur|mineur)\b|\b(?:mayor|menor|maior) de \d{2}\b|\buber \d{2}\b|\b(?:ouder|jonger) dan \d{2}\b/

/** "Are you Asian?", "Are you Muslim?": a protected category asked as a yes or no. */
/** The word "agree" in any form is a consent ("Agree", "Tick to agree", "Agree/Disagree"), unless it is followed by what was agreed: "Agreed salary". */
const CONSENT_WORD =
  /\bagree(?:s|d|ing)?\b(?! (?:upon )?(?:salary|salaries|rate|rates|pay|wage|wages|compensation|start|starting|date|notice|price|fee|fees|amount|budget|hours))/

const PROTECTED_YES_NO =
  /\b(?:are|is) you (?:an? )?(?:asian|black|white|caucasian|african|arab|hispanic|latinx?|latino|latina|indigenous|native (?:american|hawaiian|born)|alaska native|jewish|muslim|christian|hindu|buddhist|sikh|catholic|atheist)\b/

const WORK_FRAMING =
  /\b(work|working|employment|employed|travail|travailler|trabajar|trabajo|trabalh\w*|lavor\w*|arbeit\w*|empleo|visa|permit|permis|sponsor|legally|legal|eligible|elegible|berechtigt)\b|عمل/

/** Contacting an employer or references, in any of the languages and either word order, active or passive. A word between the two that is only a detail ("contact details of your employer") is not the ask. */
const THIRD_PARTY_CONTACT = /* @__PURE__ */ lazy(() => {
  const targets = alternation([
    "employer|employeur|arbeitgeber|empleador|empregador|datore|werkgever|isveren|pracodawc|referen|referee|referans|supervisor|boss",
    "current company|previous company|former company|last company|anterior empresa|empresa anterior|empresa actual|entreprise actuelle|ancienne entreprise",
  ])
  const details = alternation(["name|email|phone|number|detail|info|address|person|of"])
  const verbs = alternation([
    "contact|kontakt|skontakt|contatt|contat|iletisim|appeler|joindre|llam|ligar|chiam|benader|bellen|zadzwon|dzwon|zapyta",
  ])
  const plainVerbs = alternation(["call|speak|talk|verify|reach|approach|get in touch|touch base"])
  const reversed = alternation([
    "kontaktier|contacteren|skontaktowac|kontaktowac|iletisime|contacted|called|phoned|emailed|verified|approached",
    "anruf|befrag|nachfrag|ansprech|aray|ulas|bellen|benaderen",
  ])
  return new RegExp(
    `\\b(?:(?:${verbs})\\w*|(?:${plainVerbs})\\b) (?:(?!(?:${details}))\\w+ ){0,4}(?:${targets})|\\b(?:${targets})\\w* (?:\\w+ ){0,3}(?:${reversed})|\\b(?:referen\\w*|referee) (?:checks?|verification)\\b`,
  )
})

/** The ask itself: permission, "can we contact", "allow us to". It is only the person's own when it is about working or relocating, or about reaching them. */
const ASKS_PERMISSION = /* @__PURE__ */ lazy(
  () =>
    new RegExp(
      `\\b(?:permissions?|toestemming|(?:may|can|could|shall|should) we (?:contact|call|reach|phone|email|text|message)|allow us to|i allow|you may contact)\\b|(?:^| )(?:${ARABIC_PREFIXES})?اذن(?= |$)`,
    ),
)
const WORK_PERMISSION =
  /\b(?:permission|permit) to (?:work|relocate|relocating|move)\b|\btoestemming om (?:\w+ ){0,4}(?:te )?werken\b|اذن (?:ال|لل|ل)?عمل|تصريح (?:ال|لل|ل)?عمل/g
/** Reaching the person ends the label or ends at the channel ("by phone or email") or the application it is about: more after it ("about marketing", "and share your data") is another ask. */
const CONTACTS_APPLICANT =
  /(?:(?:may|can|could|shall|should) we |allow us to |permission to |i allow )?(?:\b(?:contact|call|reach|phone|email|text|message|e mail) (?:you|me|us)|\bget in touch with (?:you|me))(?: (?:by|via|on|through|using|over) \w+(?: (?:or|and) \w+)*| (?:about|regarding|concerning|for) (?:this|the|your|my) (?:application|role|job|position|candidacy|interview|vacancy))?$/

/** Authorization is permission to act in the person's name, unless it is the work authorization question. Contacting the person is not asking for anything of theirs. */
function isPermissionToAct(label: string): boolean {
  if (THIRD_PARTY_CONTACT().test(label)) return true
  if (ASKS_PERMISSION().test(label.replace(WORK_PERMISSION, " ").replace(CONTACTS_APPLICANT, " "))) return true
  return (
    /\b(authori[sz]\w*|autoris\w*|autoriz\w*|ermachtig\w*|genehmig\w*|permiso)/.test(label) && !WORK_FRAMING.test(label)
  )
}

const LICENCE =
  /(driv\w* licen|driver s licen|permis de conduire|licencia de conducir|carnet de conducir|fuhrerschein|رخصه القياده|رخصه السياقه)/
const LICENCE_QUESTION = /\b(do you|have|hold|valid|possess|own|avez|tiene|tienes|haben|besitzen|verfugen)\b|هل/
const LICENCE_KIND = /\b(class|type|category|categories|status)\b/
const NUMBERISH = /\b(number|no|num|numero|nummer|id)\b|رقم/

/** A driving licence number is an id; "do you have a valid driver's licence?" is an ordinary requirement. */
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

/** Answers that only one protected category has: an honorific, a marital state, a belief or a race. Two of them in one row is the question. */
const ANSWER_SETS = /* @__PURE__ */ lazy(() =>
  [
    "Mr|Mrs|Ms|Miss|Mx|Herr|Frau|Monsieur|Madame|Mademoiselle|Señor|Señora|Sr|Sra|السيد|السيدة",
    "Single|Married|Divorced|Widowed|Separated|Célibataire|Marié|Mariée|Divorcé|Veuf|Ledig|Verheiratet|Geschieden|Verwitwet|Soltero|Casado|Divorciado|Viudo|أعزب|متزوج|مطلق|أرمل",
    "Christian|Muslim|Jewish|Hindu|Buddhist|Sikh|Atheist|Agnostic|Catholic|Protestant|Chrétien|Musulman|Juif|Bouddhiste|Christlich|Muslimisch|Jüdisch|Cristiano|Musulmán|Judío|مسلم|مسيحي|يهودي",
    "Asian|White|Black|Caucasian|African|Arab|Blanc|Noir|Asiatique|Weiß|Schwarz|Asiatisch|Blanco|Negro|Asiático|أبيض|أسود|آسيوي",
  ].map((list) => new Set(words([list]))),
)
/** "18-24", "25 to 34", "65+", "Under 25", "65 or older". */
const AGE_BAND =
  /^\s*(under\s*\d{2}|\d{2}\s*(-|\u2013|to)\s*\d{2}|\d{2}\s*\+|\d{2}\s*(or|and)\s*(older|over|above))\s*$/

/** The two genders as a form words them in it, pt, nl, tr and pl. */
const GENDER_PAIRS: readonly (readonly [string, string])[] = [
  ["uomo", "donna"],
  ["maschio", "femmina"],
  ["homem", "mulher"],
  ["man", "vrouw"],
  ["mannelijk", "vrouwelijk"],
  ["erkek", "kadin"],
  ["mezczyzna", "kobieta"],
]

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

const BARE_EDGE_WORDS = 4

/** Compiles lists into a guard. Lists given later add to the earlier ones. Patterns are built on first use. */
export function createGuard(...parts: Partial<WordLists>[]): Guard {
  const lists = Object.fromEntries(
    (Object.keys(EMPTY_LISTS) as (keyof WordLists)[]).map((key) => [key, parts.flatMap((part) => part[key] ?? [])]),
  ) as WordLists

  /** Every list in one pattern, tried on the label with a space at both ends: phrases, word starts, stems anywhere, arabic words. */
  const labelPattern = lazy(
    () =>
      new RegExp(
        ` (?:(?:${alternation(lists.phrases)})(?= )|(?:${alternation(lists.stems)})|(?:${ARABIC_PREFIXES})?(?:${alternation(lists.arabic)})(?= ))|${alternation(lists.inside)}`,
      ),
  )
  const barePrivate = lazy(() => new Set(words(lists.barePrivate)))
  const bareLabels = lazy(() => new Set(words(lists.bareLabels)))
  const bareEdge = lazy(() => new Set(words(lists.bareEdge)))
  const sectionPattern = lazy(() => new RegExp(`(^| )(${alternation(lists.sectionStems)})`))
  const optionPattern = lazy(() => new RegExp(`(^| )(${alternation(lists.options)})`))
  const squashPattern = lazy(
    () => new RegExp(`${words(lists.squashed).join("|")}|${words(lists.squashStems).join("|")}`),
  )

  const isBareEdge = (own: string): boolean => {
    const parts = own.split(" ")
    return (
      parts.length <= BARE_EDGE_WORDS &&
      (bareEdge().has(parts[0] ?? "") || bareEdge().has(parts[parts.length - 1] ?? ""))
    )
  }

  function isLearnableField(field: { label: string; type?: string; autocomplete?: string }): boolean {
    if (!controlKind(field.type)) return false
    if (field.autocomplete && SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) return false
    const label = clean(field.label)
    if (label.length === 0) return false
    const owns = ownLabels(field.label)
    if (owns.some((own) => bareLabels().has(own) || barePrivate().has(own) || isBareEdge(own))) return false
    const padded = ` ${label} `
    if (labelPattern().test(padded) || isPinSecret(padded)) return false
    if (
      isCitizenshipStatus(label) ||
      isAgeQuestion(label) ||
      PROTECTED_YES_NO.test(label) ||
      CONSENT_WORD.test(label) ||
      isPermissionToAct(label) ||
      isLicenceNumber(label)
    )
      return false
    return !squashPattern().test(squash(foldConfusables(field.label)))
  }

  function isSensitiveSection(heading: string): boolean {
    const text = clean(heading)
    return sectionPattern().test(text) || THIRD_PARTY_CONTACT().test(text)
  }

  function isDemographicOptions(options: readonly string[]): boolean {
    const texts = options.map(clean)
    if (texts.some((text) => optionPattern().test(text))) return true
    const both = (a: string, b: string) => texts.includes(a) && texts.includes(b)
    const several = (answers: ReadonlySet<string>) => texts.filter((text) => answers.has(text)).length >= 2
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
      GENDER_PAIRS.some(([a, b]) => both(a, b)) ||
      ANSWER_SETS().some(several) ||
      bands
    )
  }

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
