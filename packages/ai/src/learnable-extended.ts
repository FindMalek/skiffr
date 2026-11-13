import { createGuard, FLOOR, type WordLists } from "./learnable"

/**
 * The wording the content script does not carry: rarer phrasings, synonyms and the long lists of en fr de es ar it pt nl tr
 * pl. It adds to `FLOOR`, so the server guard is the floor plus this. The api uses it on every label it sees (lookup,
 * record, `ai.mapFields`) before any text reaches a model, and it is the whole guard for an install that has no model key.
 */
export const EXTENDED: Partial<WordLists> = {
  phrases: [
    "codigo de seguridad|geheimnummer|codigo secreto|clave secreta|kartenprufziffer|card security|security no",
    "الرمز السري|direct debit|card verification|account no|acct number|بطاقه|account holder|acct no|bic swift",
    "swift bic|compte bancaire|cuenta bancaria|bankverbindung|bankkonto|kontonr|konto nr|n de compte",
    "no de compte|num de compte|numero compte|n de cuenta|no de cuenta|num de cuenta|num cuenta|numero cuenta",
    "titulaire de la carte|titulaire de carte|nom du titulaire|nombre del titular|titular de la tarjeta",
    "titular de tarjeta|الحساب المصرفي|cnic|cedula|national identification|taxpayer|ausweisnummer",
    "piece d identite|numero de identificacion|رقم الجواز|الرقم الوطني|num de secu|n de secu|no de secu",
    "numero de secu|numero fiscal|numero d identification fiscale|identifiant fiscal|rentenversicherung",
    "رقم ضريبي|رقم التعريف الضريبي|n ss|num ss|numero ss|mutuelle|seguro medico|obra social|التامين الصحي",
    "registro de antecedentes|antecedents judiciaires|سجل جنايي|anniversaire|cumpleanos|nom de jeune fille",
    "apellido de soltera|confession|fuhrungszeugnis|convict|الصحه|marketing purposes|have read and",
    "you authorize|authorize us|authorise us|stay in touch|talent network|future roles|future positions",
    "keeping your data|retain your|store your|processing of your|je reconnais|politique de|politica de",
    "ich erklare|certifico|he leido|j atteste|j ai pris connaissance|lu et approuve|mentions legales|cgu|cgv",
    "conditions d utilisation|protection des donnees|stimme zu|gelesen und|bestatige|haftungsausschluss",
    "aviso legal|قرات|احيط علما|allow acme|you may store|you may keep|you may retain|may store my",
    "happy for us to|keep my profile|keep my cv|keep my data|keep my details|keep your details|on file",
    "new openings|other positions|considered for other|similar roles|send me|email me|text me|notify me",
    "alert me|keep me posted|keep me updated|keep me informed|receive job|receive updates|receive emails",
    "stay informed|i give|give my|signatures|esignature|signed date|signed on|conservation de mes donnees",
    "conserver mes donnees|conserver mon cv|conserver mon profil|conserver ma candidature|garder mon profil",
    "garder mon cv|futures opportunites|futures offres|prochaines offres|alertes emploi|offres similaires",
    "daten speichern|lebenslauf speichern|bewerbung speichern|aufbewahren|aufbewahrung|jobalarm",
    "ahnliche stellen|gespeichert werden|gespeichert wird|speicherung meiner daten|speicherung ihrer daten",
    "verarbeitet werden|kunftige stellen|zukunftige stellen|kunftige angebote|zukunftige angebote",
    "mi autorizacion|firme aqui|fecha de firma|conservar mis datos|guardar mi cv|futuras ofertas|boletin",
    "alertas de empleo|ofertas similares|recibir ofertas|dependents|dependants|faith|indigenous|aboriginal",
    "first nations|native american|branch of service|national of|country of birth|year born",
    "year you were born|born in|honorific|herr frau|mr mrs|mr ms|tratamiento|sr sra|enfants a charge|conjoint",
    "appartenance syndicale|ehepartner|conyuge|الزوجه|salutation|country of origin|place of origin|skin tone",
    "skin colour|skin color|poc|under represented|minority|minorities|ancestry|descent|protected class",
    "protected classes|protected group|protected groups|protected category|protected categories",
    "protected characteristic|protected characteristics|old are you|alter|alters|lebensalter|jahrgang|edad",
    "السن|birth place|impairment|special needs|handicape|invalidite|behindert|schwerbehindert|minusvalia",
    "invalidez|active duty|reservist|armee|bundeswehr|zivildienst|fuerzas armadas|ejercito|المحارب|glaube",
    "queer|gay|lesbian|civil status|family status|parental status|الحاله العايليه|government benefits",
    "social benefits|العمر|describe yourself|identify with|identify your|ho letto|condizioni d uso",
    "protezione dei dati|conservazione dei dati|conservare i miei dati|conservare il mio cv",
    "conservare il mio profilo|opportunita future|posizioni future|avvisi di lavoro|identita di genere",
    "quanti anni hai|quanti anni ha|maggiorenne|maggiorenni|anno di nascita|compleanno|invalidita",
    "categorie protette|servizio di leva|conservare il tuo cv|conservare il tuo profilo",
    "conservare i tuoi dati|conservare la tua candidatura|conservare il suo cv|conservare il suo profilo",
    "conservare i suoi dati|tenere i tuoi dati|tenere il tuo cv|forze armate|esercito|firma digitale",
    "data della firma|data di firma|termos de uso|tratamento de dados|tratamento dos meus dados",
    "conservar os meus dados|guardar os meus dados|manter os meus dados|manter o meu cv|futuras oportunidades",
    "vagas futuras|alertas de emprego|alertas de vagas|boletim informativo|cor da pele|idade|quantos anos tem",
    "quantos anos voce tem|quantos anos tens|local de nascimento|ano de nascimento|incapacidade",
    "necessidades especiais|forcas armadas|exercito|crenca|privacybeleid|gegevensbescherming|avg verklaring",
    "avg beleid|avg toestemming|verwerking van mijn gegevens|verwerking van persoonsgegevens",
    "bewaar mijn gegevens|bewaren van mijn gegevens|toekomstige vacatures|vacaturealerts|nieuwsbrief",
    "gegevens bewaren|gegevens opslaan|cv bewaren|cv opslaan|profiel bewaren|profiel opslaan|ik heb gelezen",
    "geslachtsidentiteit|voornaamwoorden|etnische|afkomst|leeftijd|hoe oud ben|hoe oud bent|geboorteplaats",
    "geboortejaar|arbeidsbeperking|gehandicapt|veteraan|militair|krijgsmacht|levensovertuiging",
    "seksuele voorkeur|seksuele orientatie|huwelijkse staat|teken hier|ondertekening|ondertekenen|okudum",
    "aydinlatma metni|gizlilik|kisisel verilerimin|verilerimin saklanmasi|sartlar|kullanim kosullari",
    "gelecekteki pozisyonlar|acik pozisyonlar|is alarmi|bulten|zamir|zamirler|kac yasindasiniz|dogum yeri",
    "dogum yili|sakatlik|gazi misiniz|gazi mi|gazi durumu|askeri|dini|inanc|cinsel tercih|medeni hal|zgody",
    "akceptuje|potwierdzam|polityka prywatnosci|ochrona danych|przechowywanie danych|przyszle rekrutacje",
    "przyszlych rekrutacji|powiadomienia o ofertach|zaimki|pochodzenie|ile masz lat|miejsce urodzenia",
    "rok urodzenia|weteran|sluzba wojskowa|wojsko|wiara|zachowac twoje cv|zachowac moje cv|zachowac cv",
    "zachowac twoje dane|zachowac dane|przechowywac cv|przechowywac dane|przechowywac twoje dane",
  ],
  inside: [
    "einverstanden|zustimmung|geschaftsbedingung|zugehorigkeit|weltanschauung|احتفاظ|احتفظ|فرص مستقبل",
    "فرص المستقبل|ذوي الاحتياجات|احتياجات الخاصه|معالجه البيانات|نشره بريديه|ارغب في تلقي|ترخيص|اللقب",
    "ذوو الاحتياجات|المحاربين|سياسه|حمايه البيانات|احتياجات خاصه|توجه جنسي|نوع اجتماعي|حاله اجتماعيه",
    "حاله عايليه|ضماير",
  ],
  squashed: [
    "securityquestion|securityanswer|onetimecode|onetimepassword|socialinsurance|nationalinsurance",
    "identitynumber|documentodeidentidad|taxidentification|visanumber|yearofbirth|numerodesecuritesociale",
    "numerodeseguridadsocial|sozialversicherung|rentenversicherung|krankenversicherung|strafregister",
    "reisepass|steueridentifikation|steuerid|kontoinhaber|karteninhaber|bankverbindung|ايبان",
  ],
  options: [
    "prefer not to state|don t wish to|i do not want to answer|latina|not a protected veteran",
    "i am not a veteran|heterosexuel|heterosexuell|bisexuel|bisexuell|homosexuel|homosexuell",
    "ich habe eine behinderung|tengo una discapacidad|j ai un handicap|لدي اعاقه|pas de reponse",
    "ich mochte keine angabe|lieber nicht|prefiero no decir|veterano",
  ],
}

export const serverGuard = createGuard(FLOOR, EXTENDED)
export const { isLearnableField, isSensitiveSection, isDemographicOptions, isSensitiveQuestion } = serverGuard

/** Whether a field's value may be kept: the label, the type and the autocomplete hint, and the answers it offers, which can give a neutral label away. */
export const isLearnableQuestion = (field: {
  label: string
  type?: string
  autocomplete?: string
  options?: readonly string[]
}): boolean =>
  isLearnableField(field) &&
  !isSensitiveQuestion({ label: field.label, options: field.options, autocomplete: field.autocomplete })
