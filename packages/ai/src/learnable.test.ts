import { expect, test } from "bun:test"
import { isDemographicOptions, isLearnableField, isSensitiveQuestion } from "./learnable"

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
    ],
    readable: [
      "Anni di esperienza",
      "Retribuzione attesa",
      "Preavviso",
      "Hai il permesso di lavoro in Italia?",
      "Nome dell'azienda",
      "Datore di lavoro attuale",
      "Disponibilità a trasferirti",
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
    ],
    readable: [
      "Anos de experiência",
      "Pretensão salarial",
      "Aviso prévio",
      "Tem autorização para trabalhar em Portugal?",
      "Nome da empresa",
      "Cargo desejado",
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
    ],
    readable: [
      "Jaren ervaring",
      "Opzegtermijn",
      "Gewenst salaris",
      "Beschikbaar vanaf",
      "Heeft u een werkvergunning?",
      "Naam van de werkgever",
      "Functietitel",
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
    ],
    readable: [
      "Deneyim yılı",
      "İhbar süresi",
      "Beklenen maaş",
      "Çalışma izniniz var mı?",
      "Mevcut işveren",
      "Başlangıç tarihi",
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
