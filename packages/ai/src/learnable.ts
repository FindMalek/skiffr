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
 * Whole words or phrases of the normalized label (lowercase, no accents or punctuation). Skill questions stay
 * learnable on purpose: `swift`, `bank`, `credit` and `routing` alone are not here, only the payment phrases they appear in.
 */
const PHRASES = [
  // secrets
  "password|passcode|passphrase|passwort|kennwort|pwd|otp|secret|token|api key|2fa|mfa",
  "authenticator|backup code|recovery code|sms code|verification code|security code",
  "security question|security answer|one time code|mot de passe|code de securite",
  "code de verification|contrasena|codigo de seguridad|codigo de verificacion|sicherheitscode",
  "verifizierungscode|كلمة المرور|كلمة السر|الرقم السري|رمز التحقق|geheimzahl|geheimnummer|code pin",
  "codigo secreto|clave secreta|kartenprufnummer|kartenprufziffer|card security|security no",
  "security number|cryptogramme|رمز المرور|كلمة مرور|رمز سري|الرمز السري",
  // payment and bank
  "credit card|debit card|direct debit|card number|card holder|cardholder|name on card|card expiry",
  "card expiration|card verification|cc number|cc exp|cvv|cvv2|cvc|cvc2|cvn|iban|rib|swift code",
  "bic code|routing number|sort code|account number|account no|acct number|bank account|kontonummer",
  "bankleitzahl|kartennummer|kreditkarte|carte bancaire|carte de credit|numero de carte",
  "numero de compte|numero de cuenta|numero de tarjeta|tarjeta de credito|tarjeta de debito",
  "رقم الحساب|رقم البطاقة|بطاقة|card no|account holder|acct no|bic swift|swift bic|compte bancaire",
  "cuenta bancaria|bankverbindung|bankkonto|kontonr|konto nr|kontoinhaber|karteninhaber|n de compte",
  "no de compte|num de compte|numero compte|n de cuenta|no de cuenta|num de cuenta|num cuenta",
  "numero cuenta|titulaire de la carte|titulaire de carte|nom du titulaire|nombre del titular",
  "titular de la tarjeta|titular de tarjeta|حساب بنكي|الحساب البنكي|الحساب المصرفي",
  // government, tax and social security ids
  "ssn|sin|nin|tin|nss|bsn|dni|nif|nie|cin|cpf|cnpj|cnic|curp|pesel|cedula|aadhaar|aadhar",
  "codice fiscale|national id|national identification|government id|tax id|tax number|taxpayer",
  "social security|social insurance|national insurance|id number|visa number|passport|passeport",
  "pasaporte|reisepass|steuer id|steuernummer|ausweisnummer|personalausweis",
  "sozialversicherungsnummer|carte d identite|piece d identite|documento de identidad",
  "numero de identificacion|جواز السفر|رقم الجواز|رقم الهوية|الرقم الوطني|الهوية الوطنية",
  "seguridad social|securite sociale|num de secu|n de secu|no de secu|numero de secu|numero fiscal",
  "numero d identification fiscale|identifiant fiscal|rentenversicherung|الرقم الضريبي|رقم ضريبي",
  "رقم التعريف الضريبي|الضمان الاجتماعي|etat civil|n ss|num ss|numero ss|mutuelle|seguro medico",
  "obra social|التأمين الصحي|registro de antecedentes|antecedents judiciaires|سجل جنائي",
  // birth
  "dob|d o b|birthday|date of birth|birth date|year of birth|maiden name|anniversaire|cumpleanos",
  "nom de jeune fille|apellido de soltera",
  // equal opportunity and other protected categories: kept out of the bank and the log
  "gender|genre|genero|sex|sexe|sexo|الجنس|orientation sexuelle|orientacion sexual|transgender|race",
  "racial|hispanic|disabled|handicap|discapacidad|الدين|confession|etnia|ethnie|raza|familienstand",
  "estado civil|situation familiale|الحالة الاجتماعية|criminal|casier judiciaire|vorstrafe",
  "vorstrafen|fuhrungszeugnis|antecedentes penales|السجل الجنائي|السوابق القضائية|convict|convicted",
  "conviction|felony|health|sante|gesundheit|gesundheitszustand|salud|الحالة الصحية|الصحة|medical",
  "political|union membership|trade union|salary history",
]

/**
 * What a person consents to, agrees to, certifies or signs up for. Kept out of the bank and never filled for them. A
 * page can ask these as a checkbox, a select, a radio row or a button row, so they are matched on the label whatever the control is.
 */
const CONSENT_PHRASES = [
  "terms|privacy|gdpr|cookie|cookies|hereby|opt in|opt out|unsubscribe|newsletter|marketing emails",
  "marketing communications|marketing purposes|promotional|i understand|i accept|i confirm",
  "i have read|have read and|read and understood|i authorize|i authorise|you authorize|authorize us",
  "authorise us|keep me in the loop|stay in touch|talent community|talent network|talent pool",
  "future opportunities|future roles|future positions|data retention|data processing",
  "data protection|keeping your data|retain your|store your|processing of your|conditions generales",
  "j accepte|je certifie|j ai lu|je reconnais|confidentialite|politique de|politica de|ich stimme",
  "agb|ich erklare|acepto|terminos|condiciones|privacidad|proteccion de datos|declaro|certifico",
  "he leido|autorizo",
]

/** Consent and agreement in fr, de, es and ar, with the forms a form is likely to use. */
const CONSENT_MORE_PHRASES = [
  // fr
  "j autorise|j atteste|j ai pris connaissance|lu et approuve|mentions legales|rgpd|cgu|cgv",
  "conditions d utilisation|protection des donnees",
  // de
  "stimme zu|ich habe gelesen|gelesen und|dsgvo|bestatige|akzeptiere|haftungsausschluss",
  // es
  "estoy de acuerdo|aviso legal",
  // ar
  "قرات|احيط علما",
]

/**
 * Permission, authorization and opt-in questions: contacting an employer or references, keeping or using the person's
 * data, job alerts and newsletters, signatures. A yes is an act done in their name, so it is theirs to give. `authoriz`
 * words are handled apart, because "authorized to work" is the work authorization question and stays fillable.
 */
const PERMISSION_PHRASES = [
  // en: "permission", "can we contact", "allow us to" and contacting an employer or references are read in `isPermissionToAct`
  "allow acme|you may store|you may keep|you may retain|may store my|happy for us to|keep my profile|keep my cv",
  "keep my data|keep my details|keep your details|on file|future openings|new openings|other positions",
  "considered for other|similar jobs|similar roles|job alerts|job alert|send me|email me|text me",
  "notify me|alert me|keep me posted|keep me updated|keep me informed|receive job|receive updates",
  "receive emails|stay informed|i give|give my",
  // signatures
  "signature|signatures|esignature|sign here|sign below|sign above|date signed|signed date|signed on",
  "signed by|typed name",
  // fr
  "accord|j accorde|conservation de mes donnees|conserver mes donnees|conserver mon cv",
  "conserver mon profil|conserver ma candidature|garder mon profil|garder mon cv|futures opportunites",
  "futures offres|prochaines offres|alertes emploi|offres similaires|signez ici",
  // de
  "erlaubnis|unterschrift|unterschreiben|daten speichern|lebenslauf speichern|bewerbung speichern",
  "aufbewahren|aufbewahrung|jobalarm|ahnliche stellen|gespeichert werden|gespeichert wird",
  "speicherung meiner daten|speicherung ihrer daten|verarbeitet werden|kunftige stellen",
  "zukunftige stellen|kunftige angebote|zukunftige angebote",
  // es
  "mi autorizacion|firma electronica|firma del solicitante|firma del candidato|firma digital",
  "firme aqui|fecha de firma|conservar mis datos|guardar mi cv|futuras ofertas|boletin",
  "alertas de empleo|ofertas similares|recibir ofertas",
]

/** Family, union and other personal extras. */
const FAMILY_PHRASES = [
  "children|dependents|dependants|spouse|faith|indigenous|aboriginal|first nations|native american",
  "branch of service|national of|country of birth|year born|year you were born|born in|honorific",
  "herr frau|mr mrs|mr ms|tratamiento|sr sra|nombre d enfants|enfants a charge|conjoint",
  "appartenance syndicale|kinder|ehepartner|hijos|conyuge|afiliacion sindical|wie alt|cuantos anos",
  "عدد الاطفال|الزوجه|نقابه",
]

/** Protected and personal categories beyond the equal opportunity lists above. */
const IDENTITY_PHRASES = [
  // gender, sex, salutation
  "anrede|salutation|civilite|النوع الاجتماعي",
  // race, ethnicity, origin
  "country of origin|place of origin|origine|origen|العرق|الاصل|skin tone|skin colour|skin color",
  "person of color|people of color|person of colour|people of colour|poc|under represented|minority",
  "minorities|caste|ancestry|descent|protected class|protected classes|protected group|protected groups",
  "protected category|protected categories|protected characteristic|protected characteristics",
  // age, birth
  "how old|years old|old are you|alter|alters|lebensalter|jahrgang|edad|السن|birthplace|birth place",
  "place of birth|naissance|nacimiento",
  // nationality, citizenship as a status
  "nacionalidad",
  // disability
  "impairment|special needs|handicape|invalidite|behindert|schwerbehindert|minusvalia|invalidez",
  // veteran, military
  "military|armed forces|army|active duty|reservist|ancien combattant|anciens combattants|militaire",
  "armee|bundeswehr|wehrdienst|zivildienst|militar|fuerzas armadas|ejercito|المحارب|الجيش",
  // religion, belief
  "glaube|creencias",
  // sexual orientation, identity
  "queer|gay|lesbian|orientierung",
  // marital, family
  "marital|civil status|family status|parental status|enceinte|embarazada|الحاله العائليه",
  "government benefits|social benefits",
  // other
  "العمر|national origin|eeo|eeoc|best describes you|describe yourself|identify as|identify with|identify your",
  "i identify|do you identify",
]

/**
 * A first pass for it, pt, nl, tr and pl, the main categories only: consent and data processing, gender, race and
 * ethnicity, age and birth date, nationality, disability, military service, religion, sexual orientation, marital
 * status, pronouns, signatures. Not covered: option answers beyond the few in `OPTIONS`, longer permission sentences,
 * and the long tail the five older languages got (family, union, honorifics, yes or no questions).
 */
const MORE_LANGUAGES = [
  // it
  "accetto|autorizzo|ho letto|informativa|trattamento dei dati",
  "trattamento dei miei dati|termini e condizioni|condizioni d uso|protezione dei dati",
  "conservazione dei dati|conservare i miei dati|conservare il mio cv|conservare il mio profilo",
  "opportunita future|posizioni future|avvisi di lavoro|sesso|identita di genere|razza",
  "quanti anni hai|quanti anni ha|maggiorenne|maggiorenni|data di nascita|luogo di nascita|anno di nascita|compleanno",
  "nazionalita|cittadinanza|disabile|invalidita|categorie protette|servizio militare|servizio di leva",
  "conservare il tuo cv|conservare il tuo profilo|conservare i tuoi dati|conservare la tua candidatura",
  "conservare il suo cv|conservare il suo profilo|conservare i suoi dati|tenere i tuoi dati|tenere il tuo cv",
  "forze armate|esercito|orientamento sessuale|stato civile|firma elettronica|firma digitale|firma qui",
  "data della firma|data di firma|firma del candidato",
  // pt
  "consinto|concordo|aceito|termos e condicoes|termos de uso",
  "protecao de dados|tratamento de dados|tratamento dos meus dados",
  "conservar os meus dados|guardar os meus dados|manter os meus dados|manter o meu cv",
  "futuras oportunidades|vagas futuras|alertas de emprego|alertas de vagas|boletim informativo|raca",
  "origem etnica|cor da pele|idade|quantos anos tem|quantos anos voce tem|quantos anos tens|data de nascimento|local de nascimento",
  "ano de nascimento|nacionalidade|cidadania|deficiencia|incapacidade|necessidades especiais",
  "forcas armadas|exercito|crenca|orientacao sexual",
  // nl
  "akkoord|ik verklaar|voorwaarden|privacybeleid|privacyverklaring",
  "gegevensbescherming|avg verklaring|avg beleid|avg toestemming|verwerking van mijn gegevens|verwerking van persoonsgegevens",
  "bewaar mijn gegevens|bewaren van mijn gegevens|toekomstige vacatures|vacaturealerts|nieuwsbrief",
  "gegevens bewaren|gegevens opslaan|cv bewaren|cv opslaan|profiel bewaren|profiel opslaan",
  "ik heb gelezen|geslacht|geslachtsidentiteit|voornaamwoorden|ras|etniciteit|etnische|afkomst",
  "leeftijd|hoe oud ben|hoe oud bent|geboortedatum|geboorteplaats|geboortejaar",
  "beperking|arbeidsbeperking|gehandicapt|veteraan|militair|krijgsmacht",
  "geloofsovertuiging|godsdienst|levensovertuiging|seksuele geaardheid|seksuele voorkeur",
  "seksuele orientatie|burgerlijke staat|huwelijkse staat|handtekening|teken hier|ondertekening",
  "ondertekenen",
  // tr
  "riza|kabul ediyorum|okudum|aydinlatma metni|kvkk|gizlilik",
  "kisisel veri|kisisel verilerimin|verilerimin saklanmasi|sartlar|kullanim kosullari",
  "gelecekteki pozisyonlar|acik pozisyonlar|is alarmi|bulten|cinsiyet|zamir|zamirler|irk|etnik",
  "kac yasindasiniz|dogum tarihi|dogum yeri|dogum yili",
  "engel durumu|sakatlik|gazi misiniz|gazi mi|gazi durumu|askeri|dini|mezhep|inanc|cinsel yonelim",
  "cinsel tercih|medeni durum|medeni hal",
  // pl
  "zgoda|zgode|zgody|zgadzam sie|akceptuje|potwierdzam|polityka prywatnosci",
  "regulamin|ochrona danych|rodo",
  "przechowywanie danych|przyszle rekrutacje|przyszlych rekrutacji|powiadomienia o ofertach|plec",
  "zaimki|rasa|pochodzenie|narodowosc|obywatelstwo|ile masz lat|data urodzenia",
  "miejsce urodzenia|rok urodzenia|weteran|sluzba wojskowa",
  "wojsko|wyznanie|wiara|orientacja seksualna|stan cywilny",
  "zachowac twoje cv|zachowac moje cv|zachowac cv|zachowac twoje dane|zachowac dane|przechowywac cv",
  "przechowywac dane|przechowywac twoje dane",
]

/** Beginnings of words: `certif` is certify, certified and certification. Matched where a word starts. */
const STEMS = [
  "consent|consens|consient|agree|acknowledg|certify|certified|declare|declaration|arbitrat",
  "self identif|equal employment|equal opportunit|subscri|pronom|pronoun|veteran|pregnan",
  "underrepresent|lgbt|sexual orient|sexual prefer|disabilit|ethnic|religi|nationalit|willig",
  "zustimm|dichiar|acconsent|assin|onay|imza|uyru|vatandas|engelli|askerlik|oswiadcz|przetwarz|podpis",
  "niepelnospraw",
  // it, nl, tr, pl: the forms a question takes (Cinsiyetiniz, Doğum tarihiniz, Weteranem, nieuwsbrieven)
  "cinsiyet|dogum tarih|dogum yer|dogum yil|medeni|engel durum|dinin|yasin|irkin|mezheb|weteran|wojsk",
  "pelnolet|newslett|nieuwsbrie|d accordo",
]

/** Long stems that are matched inside a word: german compounds (Datenschutzerklärung, Schwerbehinderung) and arabic, where the article and prefixes do not matter. */
const INSIDE = [
  "datenschutz|behinderung|einwillig|einverstanden|zustimmung|nutzungsbedingung|geschaftsbedingung",
  "staatsangehor|staatsburger|zugehorigkeit|unterzeichn|gewerkschaft|geschlecht|geburts|konfession",
  "weltanschauung|schwanger|herkunft|diskriminier|عرقي|اثني|ميلاد|موافقت|اسمح|احتفاظ|احتفظ|فرص مستقبل|فرص المستقبل|ذوي الاحتياجات|احتياجات الخاصه",
  "معالجه البيانات|اتصال بصاحب|اتصال بمراجع|اتصال بالمراجع|اتصال بمرجع|اتصال بالمرجع|اتصال بجهه|اتصال بمدير|تواصل مع صاحب|تواصل مع مراجع|تواصل مع المراجع|تواصل مع مرجع|تواصل مع المرجع|تواصل مع جهه|تواصل مع مدير|نشره بريديه",
  "ارغب في تلقي|اشتراك|تفويض|ترخيص|اللقب|توقيع|ذوو الاحتياجات|المحاربين|جنسيه|اعاقه|خصوصيه|موافقه",
  "اقرار|احكام|شروط|سياسه|حمايه البيانات|عسكري|معتقد|ديانه|احتياجات خاصه|توجه جنسي|نوع اجتماعي",
  "حاله اجتماعيه|حاله عائليه|ضمائر",
]

/** Short arabic words, matched as whole words with the article or a one letter prefix: `دين` (religion) is also inside `مدينة` (city). */
const ARABIC = ["جنس|عمري|عمرك|عرق|سن|عمر|دين|ذكر|انثي|حامل|جيش|محارب|ضمير|اصل|اقر|اصرح|اتعهد|اوافق|وافقت", "اؤكد"]
const ARABIC_PREFIXES = "ال|لل|بال|وال|فال|ل|ب|و"

/** Every list above in one pattern, tried on the label with a space at both ends: phrases, word starts, stems anywhere, arabic words. */
const labelPattern = /* @__PURE__ */ lazy(
  () =>
    new RegExp(
      ` (?:(?:${alternation([...PHRASES, ...CONSENT_PHRASES, ...CONSENT_MORE_PHRASES, ...PERMISSION_PHRASES, ...FAMILY_PHRASES, ...IDENTITY_PHRASES, ...MORE_LANGUAGES])})(?= )|(?:${alternation(STEMS)})|(?:${ARABIC_PREFIXES})?(?:${alternation(ARABIC)})(?= ))|${alternation(INSIDE)}`,
    ),
)

/** Labels that are private only as a whole: the arabic "type" is also a word in "job type". */
const BARE_PRIVATE = new Set(["النوع", "نوع", "genre", "alter", "sex", "firma"].map(clean))

/** Bare words of it, tr and pl that are private as the first or last word of a short label (`Il tuo genere`, `Wiek (lata)`), not in the middle of a long one. */
const BARE_EDGE = new Set(["genere", "eta", "din", "yas", "wiek"])
const BARE_EDGE_WORDS = 4
const isBareEdge = (own: string): boolean => {
  const words = own.split(" ")
  return (
    words.length <= BARE_EDGE_WORDS && (BARE_EDGE.has(words[0] ?? "") || BARE_EDGE.has(words[words.length - 1] ?? ""))
  )
}

/** Letters of long words that stay in view when a page spaces them out or swaps a digit in (G e n d e r, G3nder). */
const SQUASH_STEMS =
  "gender|pronoun|ethnic|religio|veteran|disabilit|pregnan|transgender|nationalit|consent|sexualorient|maritalstatus"

/** Section headings under which every question is private: the equal opportunity, self identification and diversity blocks. */
const SECTION_STEMS = [
  "eeo|equal employment|equal opportunit|self identif|voluntary|demograph|diversit|veteran|disabilit|consent",
  "agreement|privacy|terms|arbitrat|gdpr|data protection|diversite|vielfalt|diversidad|chancengleichheit",
  "egalite des chances|igualdad de oportunidades|datenschutz|التنوع|تكافو الفرص|المساواه",
]
const sectionPattern = /* @__PURE__ */ lazy(() => new RegExp(`(^| )(${alternation(SECTION_STEMS)})`))

/** What a row of choices gives away about the question: the answers of a demographic or protected category. */
const OPTIONS = [
  "decline to self identify|decline to identify|prefer not to say|prefer not to answer",
  "prefer not to disclose|prefer not to state|do not wish to|don t wish to|i do not want to answer",
  "non binary|nonbinary|genderqueer|transgender|cisgender|hispanic|latino|latina|protected veteran",
  "not a protected veteran|heterosexual|bisexual|homosexual|two or more races|native hawaiian",
  "pacific islander|american indian|alaska native|african american|i have a disability",
  "i do not have a disability|i am a veteran|i am not a veteran|heterosexuel|heterosexuell|bisexuel",
  "bisexuell|homosexuel|homosexuell|ich habe eine behinderung|tengo una discapacidad",
  "j ai un handicap|لدي اعاقه|pas de reponse|keine angabe|prefiero no|je prefere ne pas",
  "ich mochte keine angabe|lieber nicht|prefiero no decir|ancien combattant|veterano|افضل عدم",
  "لا اريد|ذكر|انثي",
  // it, pt, nl, tr, pl
  "preferisco non rispondere|preferisco non dire|prefiro nao dizer|prefiro nao responder",
  "zeg ik liever niet|liever niet zeggen|wil ik niet zeggen|belirtmek istemiyorum",
  "cevap vermek istemiyorum|wole nie podawac|wole nie odpowiadac|nie chce podawac",
]
const optionPattern = /* @__PURE__ */ lazy(() => new RegExp(`(^| )(${alternation(OPTIONS)})`))

/** Whole labels that are private only when they stand alone: `Visa expiry date` and `Country code` are something else. */
const BARE_LABELS = new Set([
  "code",
  "avg",
  "gazi",
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

/** Only compounds no ordinary question contains. */
const SQUASHED = [
  "password|passcode|passphrase|motdepasse|contrasena|creditcard|debitcard|cardnumber|cartebancaire",
  "numerodecarte|numerodetarjeta|kreditkarte|securitycode|securityquestion|securityanswer",
  "verificationcode|onetimecode|onetimepassword|accountnumber|socialsecurity|socialinsurance",
  "nationalinsurance|identitynumber|documentodeidentidad|taxidentification|visanumber|maidenname",
  "dateofbirth|birthdate|yearofbirth|datedenaissance|fechadenacimiento|numerodesecuritesociale",
  "numerodeseguridadsocial|sozialversicherung|rentenversicherung|krankenversicherung|strafregister",
  "reisepass|steueridentifikation|steuerid|kartenprufnummer|kontoinhaber|karteninhaber",
  "bankverbindung|geheimzahl|ايبان",
]
const squashPattern = /* @__PURE__ */ lazy(() => new RegExp(`${SQUASHED.join("|")}|${SQUASH_STEMS}`))

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
/** A page controls its labels: only this many characters are split into tails, or `a: a: a: ...` is quadratic. */
const OWN_LABEL_MAX = 2000

/** The label and each tail of it after a section prefix (`Payment details: Code` also reads `Code`), normalized. */
function ownLabels(label: string): string[] {
  const parts = label.slice(-OWN_LABEL_MAX).split(/:\s+/)
  return parts.map((_, index) => clean(parts.slice(index).join(" ")))
}

export function isLearnableField(field: { label: string; type?: string; autocomplete?: string }): boolean {
  if (!controlKind(field.type)) return false
  if (field.autocomplete && SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) return false
  const label = clean(field.label)
  if (label.length === 0) return false
  const owns = ownLabels(field.label)
  if (owns.some((own) => BARE_LABELS.has(own) || BARE_PRIVATE.has(own) || isBareEdge(own))) return false
  const padded = ` ${label} `
  if (labelPattern().test(padded) || isPinSecret(padded)) return false
  if (
    isCitizenshipStatus(label) ||
    isAgeQuestion(label) ||
    PROTECTED_YES_NO.test(label) ||
    isPermissionToAct(label) ||
    isLicenceNumber(label)
  )
    return false
  const squashed = squash(foldConfusables(field.label))
  return !squashPattern().test(squashed)
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
const NUMBERISH = /\b(number|no|num|numero|nummer|id)\b|رقم/

/** A driving licence number is an id; "do you have a valid driver's licence?" is an ordinary requirement. */
function isLicenceNumber(label: string): boolean {
  return LICENCE.test(label) && (NUMBERISH.test(label) || !LICENCE_QUESTION.test(label))
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

/** A section heading (equal opportunity, self identification, diversity, consent) under which every question is private. */
export function isSensitiveSection(heading: string): boolean {
  const text = clean(heading)
  return sectionPattern().test(text) || THIRD_PARTY_CONTACT().test(text)
}

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

/** Answers that only a demographic or protected category question has: Male and Female, "Decline to self identify", "Hispanic". */
export function isDemographicOptions(options: readonly string[]): boolean {
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

export type QuestionText = {
  label?: string
  /** The control's name or id, read as words (`job_application[gender]`). */
  name?: string
  autocomplete?: string
  options?: readonly string[]
  /** Headings and legends above the control. */
  sections?: readonly string[]
}

/**
 * Whether a question is one the person answers themselves, whatever control draws it (text, select, combobox, radio or
 * button row): private by its own label or name, by the browser's hint, by the shape of its answers or by the section
 * it sits under. It errs towards blocking: a question about age, terms or "agree to relocate" is left to the person too.
 */
export function isSensitiveQuestion({ label, name, autocomplete, options, sections }: QuestionText): boolean {
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
