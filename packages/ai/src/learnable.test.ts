import { expect, test } from "bun:test"
import { isLearnableField as floorLearnable, isSensitiveQuestion as floorSensitive } from "./learnable"
import {
  isDemographicOptions,
  isLearnableField,
  isLearnableQuestion,
  isSensitiveQuestion,
  isSensitiveSection,
} from "./learnable-extended"

const blocked = (label: string) => isSensitiveQuestion({ label }) && !isLearnableField({ label, type: "text" })
const readable = (label: string) => !isSensitiveQuestion({ label }) && isLearnableField({ label, type: "text" })

test("permission to work or relocate and contacting the applicant stay fillable", () => {
  for (const label of [
    "Do you have permission to work in the UK?",
    "Do you have legal permission to work in Canada?",
    "Permission to work remotely",
    "Do you need permission to relocate?",
    "إذن عمل",
    "هل لديك إذن العمل في الإمارات؟",
    "تصريح عمل",
    "Can we contact you by phone?",
    "May we contact you about this application?",
    "Allow us to call you?",
    "Preferred contact method",
    "Allow remote work",
  ]) {
    expect(readable(label), label).toBe(true)
  }
})

test("permission to contact an employer or references, to keep data or to message the person stays theirs", () => {
  for (const label of [
    "Do we have your permission to contact your employer?",
    "Can we contact you and your employer?",
    "Contact current employer?",
    "May we contact your previous employers?",
    "Can we contact your references?",
    "Allow us to keep your data",
    "Do you give permission to process your data?",
    "Permission to keep my CV on file",
    "Notify me about new openings",
    "Sign below",
    "هل يمكننا التواصل مع جهة عملك الحالية؟",
    "هل نستطيع التواصل مع مرجعيك؟",
    "احتفظوا بملفي للفرص المستقبلية",
    "Conserver mon profil pour de futures opportunités",
    "Meine Daten dürfen gespeichert werden",
    "Dürfen wir Ihren Arbeitgeber kontaktieren?",
    "Pouvons-nous contacter votre employeur actuel ?",
  ]) {
    expect(blocked(label), label).toBe(true)
  }
  for (const label of ["Employer contact email", "Contact name of your current employer", "Name of your employer"]) {
    expect(readable(label), label).toBe(true)
  }
})

test("yes or no race and age questions, identity and protected class wording are private", () => {
  for (const label of [
    "Are you Asian?",
    "Are you Hispanic or Latino?",
    "Are you a Black or African American person?",
    "Are you over 21?",
    "Are you at least 18?",
    "Are you 18 or older?",
    "Are you under 18",
    "Avez-vous plus de 18 ans ?",
    "Do you identify as a woman?",
    "Do you identify with a gender different from the one assigned at birth?",
    "Are you a member of a protected class?",
    "Are you of Asian descent?",
    "¿Ha servido en el ejército?",
    "ذوو الاحتياجات الخاصة",
    "هل أنت من ذوي الاحتياجات الخاصة؟",
  ]) {
    expect(blocked(label), label).toBe(true)
  }
  for (const label of [
    "Are you willing to travel 25% of the time?",
    "Do you have over 10 years of experience?",
    "Are you comfortable working in a team of 10?",
    "Are you available 40 hours a week?",
    "Do you have 5 or more years of experience?",
    "Are you based in London?",
    "Are you willing to relocate?",
  ]) {
    expect(readable(label), label).toBe(true)
  }
})

const FIRST_PASS: Record<string, { blocked: string[]; readable: string[] }> = {
  italian: {
    blocked: [
      "Acconsento al trattamento dei dati personali",
      "Informativa sulla privacy",
      "Sesso",
      "Pronomi",
      "Origine etnica",
      "Razza",
      "Età",
      "Data di nascita",
      "Luogo di nascita",
      "Cittadinanza",
      "Nazionalità",
      "Disabilità",
      "Appartieni alle categorie protette?",
      "Servizio militare",
      "Religione",
      "Orientamento sessuale",
      "Stato civile",
      "Firma",
      "Firma digitale",
      "Possiamo contattare il tuo attuale datore di lavoro?",
      "Possiamo contattare le tue referenze?",
      "Il tuo genere",
      "Genere (opzionale)",
      "Età (anni)",
      "La tua età",
      "Sono d'accordo",
      "Posso conservare il tuo CV?",
      "Sei maggiorenne?",
    ],
    readable: [
      "Anni di esperienza",
      "Retribuzione attesa",
      "Preavviso",
      "Hai il permesso di lavoro in Italia?",
      "Nome dell'azienda",
      "Datore di lavoro attuale",
      "Disponibilità a trasferirti",
      "Quanti anni di esperienza hai?",
    ],
  },
  portuguese: {
    blocked: [
      "Dou o meu consentimento para o tratamento de dados",
      "Li e aceito os termos e condições",
      "Política de privacidade",
      "Sexo",
      "Pronomes",
      "Raça",
      "Origem étnica",
      "Idade",
      "Data de nascimento",
      "Nacionalidade",
      "Pessoa com deficiência",
      "Serviço militar",
      "Religião",
      "Orientação sexual",
      "Estado civil",
      "Assinatura",
      "Assine aqui",
      "Podemos contactar o seu empregador atual?",
      "Podemos contatar as suas referências?",
      "Você serviu no exército?",
      "Você é maior de 18 anos?",
    ],
    readable: [
      "Anos de experiência",
      "Pretensão salarial",
      "Aviso prévio",
      "Tem autorização para trabalhar em Portugal?",
      "Nome da empresa",
      "Cargo desejado",
      "Quantos anos de experiência?",
    ],
  },
  dutch: {
    blocked: [
      "Ik geef toestemming voor de verwerking van mijn gegevens",
      "Ik ga akkoord met de algemene voorwaarden",
      "Privacybeleid",
      "Geslacht",
      "Voornaamwoorden",
      "Etnische afkomst",
      "Leeftijd",
      "Geboortedatum",
      "Nationaliteit",
      "Arbeidsbeperking",
      "Militaire dienst",
      "Religie",
      "Seksuele geaardheid",
      "Burgerlijke staat",
      "Handtekening",
      "Mogen wij contact opnemen met uw huidige werkgever?",
      "Mogen wij uw referenties contacteren?",
      "Ik wil nieuwsbrieven ontvangen",
      "Mogen wij uw gegevens bewaren?",
      "Bent u ouder dan 18 jaar?",
      "AVG",
    ],
    readable: [
      "Jaren ervaring",
      "Opzegtermijn",
      "Gewenst salaris",
      "Beschikbaar vanaf",
      "Heeft u een werkvergunning?",
      "Naam van de werkgever",
      "Functietitel",
      "Avg hours per week",
      "Hoe oud is uw bedrijf",
    ],
  },
  turkish: {
    blocked: [
      "Kişisel verilerimin işlenmesine onay veriyorum",
      "Aydınlatma metnini okudum",
      "Gizlilik politikası",
      "Cinsiyet",
      "Irk",
      "Etnik köken",
      "Yaş",
      "Doğum tarihi",
      "Uyruk",
      "Engellilik durumu",
      "Askerlik durumu",
      "Din",
      "Dini inanç",
      "Cinsel yönelim",
      "Medeni durum",
      "İmza",
      "Mevcut işvereninizle iletişime geçebilir miyiz?",
      "Referanslarınızla iletişime geçebilir miyiz?",
      "Cinsiyetiniz",
      "Doğum tarihiniz",
      "Doğum yeriniz",
      "Medeni durumunuz",
      "Engel durumunuz",
      "Dininiz nedir?",
      "Irkınız",
      "Yaşınız kaç?",
      "Mezhebiniz",
      "Eski işvereninizi arayabilir miyiz?",
      "Referanslarınıza ulaşabilir miyiz?",
      "Referanslarınızı arayabilir miyiz?",
      "Gazi",
    ],
    readable: [
      "Deneyim yılı",
      "İhbar süresi",
      "Beklenen maaş",
      "Çalışma izniniz var mı?",
      "Mevcut işveren",
      "Başlangıç tarihi",
      "Gazi Üniversitesi",
    ],
  },
  polish: {
    blocked: [
      "Wyrażam zgodę na przetwarzanie moich danych osobowych",
      "Polityka prywatności",
      "Płeć",
      "Zaimki",
      "Pochodzenie etniczne",
      "Rasa",
      "Wiek",
      "Data urodzenia",
      "Miejsce urodzenia",
      "Obywatelstwo",
      "Narodowość",
      "Niepełnosprawność",
      "Służba wojskowa",
      "Religia",
      "Wyznanie",
      "Orientacja seksualna",
      "Stan cywilny",
      "Podpis",
      "Czy możemy skontaktować się z Twoim obecnym pracodawcą?",
      "Czy możemy skontaktować się z osobami z referencji?",
      "Twój wiek",
      "Wiek (lata)",
      "Czy jesteś pełnoletni?",
      "Czy jesteś weteranem?",
      "Czy odbyłeś służbę wojskową?",
      "Zapisz mnie do newslettera",
      "Czy możemy zachować twoje CV?",
      "PŁEĆ",
      "NIEPEŁNOSPRAWNOŚĆ",
      "CZY MASZ NIEPEŁNOSPRAWNOŚĆ?",
      "SŁUŻBA WOJSKOWA",
      "Czy możemy zadzwonić do twoich referencji?",
    ],
    readable: [
      "Lata doświadczenia",
      "Okres wypowiedzenia",
      "Oczekiwane wynagrodzenie",
      "Czy masz pozwolenie na pracę?",
      "Nazwa pracodawcy",
      "Dostępność",
    ],
  },
}

for (const [language, { blocked: private_, readable: ordinary }] of Object.entries(FIRST_PASS)) {
  test(`${language}: the main categories are kept out, accents or none`, () => {
    for (const label of private_) {
      expect(blocked(label), label).toBe(true)
      const stripped = label.normalize("NFKD").replace(/\p{M}/gu, "")
      expect(blocked(stripped), stripped).toBe(true)
    }
  })
  test(`${language}: ordinary questions stay readable`, () => {
    for (const label of ordinary) expect(readable(label), label).toBe(true)
  })
}

test("answers of the first pass languages give a demographic question away", () => {
  const neutral = (options: string[]) => isDemographicOptions(options)
  for (const options of [
    ["Uomo", "Donna"],
    ["Maschio", "Femmina"],
    ["Homem", "Mulher"],
    ["Man", "Vrouw"],
    ["Erkek", "Kadın"],
    ["Mężczyzna", "Kobieta"],
    ["Sì", "No", "Preferisco non rispondere"],
    ["Ja", "Nee", "Zeg ik liever niet"],
    ["Evet", "Hayır", "Belirtmek istemiyorum"],
    ["Tak", "Nie", "Wolę nie podawać"],
  ]) {
    expect(neutral(options), options.join()).toBe(true)
  }
  expect(neutral(["Sì", "No"])).toBe(false)
  expect(neutral(["Ja", "Nee"])).toBe(false)
})

test("a work permission or contacting the person does not switch the rest of the check off", () => {
  for (const label of [
    "Do you have permission to work in the UK and do we have permission to keep your data?",
    "Do you give permission to share your profile with partners and permission to work in the EU?",
    "May we contact you and share your data with partners?",
    "Can we contact you about marketing?",
    "Allow us to contact you with offers",
    "Permission to contact me by email about marketing",
    "Do you have permission to work in the UK? I allow my data to be processed",
  ]) {
    expect(blocked(label), label).toBe(true)
  }
  for (const label of [
    "Can we contact you by phone or email?",
    "Do you have permission to work in the UK? Can we call you?",
  ]) {
    expect(readable(label), label).toBe(true)
  }
})

test("employer and reference contact in the passive, with other verbs and in either word order", () => {
  for (const label of [
    "May your current employer be contacted?",
    "Is your employer to be contacted?",
    "Employer may be contacted",
    "May we get in touch with your employer?",
    "Can we get in touch with your references?",
    "Can we verify with your previous employer?",
    "Can we speak to your current boss?",
    "Allow reference checks",
    "Employer reference check allowed?",
    "Reach out to your references",
    "Contact your current company",
    "Contact references",
    "Dürfen wir Ihre Referenzen anrufen?",
    "Referanslarınızı arayabilir miyiz?",
    "Czy możemy zadzwonić do twoich referencji?",
    "¿Podemos ponernos en contacto con su anterior empresa?",
  ]) {
    expect(blocked(label), label).toBe(true)
  }
  for (const label of [
    "Contact details of your employer",
    "Employer contact email",
    "Reference number",
    "Contact us",
    "Employer's contact number",
    "Contact name of your employer",
  ]) {
    expect(readable(label), label).toBe(true)
  }
  expect(isSensitiveSection("Contact references")).toBe(true)
  expect(isSensitiveQuestion({ label: "Current employer", sections: ["Contact references"] })).toBe(true)
})

test("age without the word in french, native as ancestry only", () => {
  for (const label of ["Avez-vous au moins 18 ans ?", "Êtes-vous majeur ?", "Are you a native American?"]) {
    expect(blocked(label), label).toBe(true)
  }
  for (const label of ["Are you a native English speaker?", "Avez-vous au moins 10 ans d'expérience ?"]) {
    expect(readable(label), label).toBe(true)
  }
})

test("a bare word of it, tr or pl is private at either end of a short label, not in a long one", () => {
  for (const label of ["Genere", "Il tuo genere", "Din", "Yaş"]) expect(blocked(label), label).toBe(true)
  expect(readable("Qual è il genere di progetti che hai seguito in azienda")).toBe(true)
})

test("zero width characters do not hide a bare entry", () => {
  for (const label of ["G\u200Benere", "E\u200Btà", "D\u200Bin", "Y\u200Baş", "W\u200Biek", "F\u200Birma"]) {
    expect(blocked(label), label).toBe(true)
  }
})

test("a page's huge label with many sections is cut, not scanned quadratically", () => {
  const label = "a: ".repeat(30_000)
  const start = performance.now()
  isLearnableField({ label, type: "text" })
  expect(performance.now() - start).toBeLessThan(1000)
})

test("labels the lists blocked before the new rules stay blocked", () => {
  for (const label of [
    "Password",
    "Card number",
    "IBAN",
    "Date of birth",
    "Gender",
    "Sexe",
    "Geschlecht",
    "Fecha de nacimiento",
    "Numéro de sécurité sociale",
    "Sozialversicherungsnummer",
    "Are you a veteran?",
    "Disability status",
    "Religion",
    "I agree to the terms",
    "Ich stimme zu",
    "Estado civil",
    "الجنس",
    "Do you have permission to start work immediately?",
    "Permission to travel for work",
    "Do you authorize us to contact your employer?",
  ]) {
    expect(blocked(label), label).toBe(true)
  }
})

test("a long prefix cannot push a bare label out of the scanned window", () => {
  const pad = "x".repeat(2100)
  for (const bare of ["Code", "Firma", "Genere", "Ccv", "Expiry date"]) {
    expect(isLearnableField({ label: `${pad}: ${bare}`, type: "text" })).toBe(false)
  }
})

test("padding after a bare label cannot hide it either", () => {
  const pad = ".".repeat(2100)
  for (const bare of ["Code", "Firma", "Ccv", "Expiry date", "Ablaufdatum"]) {
    expect(isLearnableField({ label: `${bare}${pad}`, type: "text" })).toBe(false)
    expect(isLearnableField({ label: `${pad}${bare}${pad}`, type: "text" })).toBe(false)
  }
  expect(isLearnableField({ label: `Code${"\u2060".repeat(5000)}`, type: "text" })).toBe(false)
})

test("empty sections after a bare label cannot push it out of the tails", () => {
  for (const label of [
    `Section: Code${": ".repeat(25)}`,
    `x: x: Ccv${": ".repeat(25)}`,
    `Payment details: Firma${":  ".repeat(20)}`,
    `Payment details: Code${": -".repeat(30)}`,
    `Payment details: Code${": .".repeat(30)}`,
  ]) {
    expect(isLearnableField({ label, type: "text" }), label).toBe(false)
  }
})

/** Blocked as a question, never learned, and not readable on the extension side either (`learnable.ts` is what it ships). */
const salaryBlocked = (label: string) =>
  isSensitiveQuestion({ label }) &&
  !isLearnableField({ label, type: "number" }) &&
  !isLearnableQuestion({ label, type: "number" }) &&
  floorSensitive({ label }) &&
  !floorLearnable({ label, type: "number" })

test("current salary in english is blocked", () => {
  for (const label of [
    "Current salary",
    "Your current salary?",
    "Current base salary",
    "What is your current annual salary?",
  ])
    expect(salaryBlocked(label), label).toBe(true)
})

test("previous and last salary, and present or prior pay, are blocked", () => {
  for (const label of [
    "Previous salary",
    "Previous base salary",
    "Last salary",
    "What was your last salary?",
    "Present or prior compensation",
    "Present or previous compensation",
  ])
    expect(salaryBlocked(label), label).toBe(true)
})

test("salary history and pay history in english are blocked", () => {
  for (const label of ["Salary history", "Pay history", "Compensation history", "Current pay", "Currently earning"])
    expect(salaryBlocked(label), label).toBe(true)
})

test("current and previous pay with a modifier or a synonym are blocked, in the floor and on the server", () => {
  for (const label of [
    "Current annual compensation",
    "Current total compensation",
    "Current base compensation",
    "Current annual compensation (gross)",
    "Current gross annual salary",
    "Previous annual salary",
    "Present annual salary",
    "Most recent salary",
    "Most recent base pay",
    "Salary at your current job",
    "Current CTC",
    "Current package",
    "Current total package",
    "Current hourly rate",
    "Current hourly wage",
    "Current wage",
    "Previous wage",
    "Previous hourly rate",
    "Previous employer salary",
    "Salary (current)",
    "Bisherige Vergütung",
    "Aktuelle Vergütung",
    "Huidig bruto salaris",
  ])
    expect(salaryBlocked(label), label).toBe(true)
})

test("previous, prior, last, most recent and former pay words are blocked, whatever is between", () => {
  for (const time of ["Previous", "Prior", "Last", "Most recent", "Former"])
    for (const noun of ["salary", "pay", "compensation", "wage", "earnings"])
      for (const label of [`${time} ${noun}`, `${time} annual ${noun}`, `${time} base ${noun}`])
        expect(salaryBlocked(label), label).toBe(true)
})

test("current pay grade and pay grade are not pay and stay fillable", () => {
  for (const label of ["Current pay grade", "Pay grade"]) {
    expect(readable(label), label).toBe(true)
    expect(floorLearnable({ label, type: "text" }), label).toBe(true)
  }
})

test("the question 'What is your current pay?' is blocked on the floor and the server", () => {
  expect(salaryBlocked("What is your current pay?")).toBe(true)
})

test("the question 'What is your current salary?' is blocked on the floor and the server", () => {
  expect(salaryBlocked("What is your current salary?")).toBe(true)
})

test("the question 'What's your current compensation?' is blocked on the floor and the server", () => {
  expect(salaryBlocked("What's your current compensation?")).toBe(true)
})

test("the question 'What is your current base salary?' is blocked on the floor and the server", () => {
  expect(salaryBlocked("What is your current base salary?")).toBe(true)
})

test("the question 'What was your last salary?' is blocked on the floor and the server", () => {
  expect(salaryBlocked("What was your last salary?")).toBe(true)
})

test("the question 'How much do you currently earn?' is blocked on the floor and the server", () => {
  expect(salaryBlocked("How much do you currently earn?")).toBe(true)
})

test("the question 'What are you currently paid?' is blocked on the floor and the server", () => {
  expect(salaryBlocked("What are you currently paid?")).toBe(true)
})

test("the noun-first form 'Current pay annual' is blocked on the floor and the server", () => {
  expect(salaryBlocked("Current pay annual")).toBe(true)
})

test("the two-modifier form 'Current base annual salary' is blocked on the floor and the server", () => {
  expect(salaryBlocked("Current base annual salary")).toBe(true)
})

test("the bracketed form 'Current pay (gross)' is blocked on the floor and the server", () => {
  expect(salaryBlocked("Current pay (gross)")).toBe(true)
})

test("the comma form 'Current pay, annual' is blocked on the floor and the server", () => {
  expect(salaryBlocked("Current pay, annual")).toBe(true)
})

test("the noun-first form 'Current pay package' is blocked on the floor and the server", () => {
  expect(salaryBlocked("Current pay package")).toBe(true)
})

test("current and previous pay in french are blocked", () => {
  for (const label of [
    "Quel est votre salaire actuel ?",
    "Salaire précédent",
    "Dernier salaire",
    "Historique salarial",
  ])
    expect(salaryBlocked(label), label).toBe(true)
})

test("current and previous pay in german, compounds included, are blocked", () => {
  for (const label of [
    "Aktuelles Gehalt",
    "Was war Ihr letztes Gehalt?",
    "Ihr bisheriges Jahresgehalt",
    "Ihr aktuelles Bruttogehalt",
    "Gehaltsverlauf",
  ])
    expect(salaryBlocked(label), label).toBe(true)
})

test("current and previous pay in spanish are blocked", () => {
  for (const label of ["Salario actual", "¿Cuál es su último salario?", "Historial salarial", "Sueldo anterior"])
    expect(salaryBlocked(label), label).toBe(true)
})

test("current and previous pay in arabic are blocked", () => {
  for (const label of ["ما هو راتبك الحالي؟", "الراتب السابق", "آخر راتب", "سجل الرواتب", "الراتب الحالي او السابق"])
    expect(salaryBlocked(label), label).toBe(true)
})

test("current and previous pay in italian, portuguese and dutch are blocked", () => {
  for (const label of [
    "Stipendio attuale",
    "Qual è la sua RAL attuale?",
    "Storico salariale",
    "Salário atual",
    "Salário anterior",
    "Histórico salarial",
    "Huidig salaris",
    "Wat was je laatste salaris?",
    "Salarisgeschiedenis",
  ])
    expect(salaryBlocked(label), label).toBe(true)
})

test("expected, desired and minimum pay, ranges, notice and currency stay fillable", () => {
  for (const label of [
    "Expected salary",
    "Desired salary",
    "Salary expectations",
    "Minimum salary",
    "Salary range",
    "Expected salary range",
    "Compensation expectations",
    "Notice period",
    "Salary currency",
    "What are your salary expectations?",
    "What is your expected salary?",
    "What is your current pay grade?",
    "Pay frequency",
    "Current employer",
    "Current job title",
    "Gehaltsvorstellung",
    "Salaire souhaité",
    "Salario deseado",
  ]) {
    expect(readable(label), label).toBe(true)
    expect(floorLearnable({ label, type: "number" }), label).toBe(true)
  }
})
