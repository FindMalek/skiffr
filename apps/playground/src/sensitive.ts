/**
 * Questions about who a person is or what they agree to: autofill must leave them empty. Kept apart from the
 * extension's own list on purpose, so a regression there is seen here.
 */
const SENSITIVE =
  /gender|ethnic|\brace\b|racial|veteran|disabilit|transgender|sexual|orientation|pronoun|religio|age range|date of birth|birth ?date|diversity|self-?identif|demographic|consent|i agree|agree to|acknowledg|signature|signed|\bsign\b|privacy|arbitrat|equal employment|\beeo|future roles|keep my data|gdpr|data protection/i

export const isSensitive = (label: string, name = ""): boolean => SENSITIVE.test(label) || SENSITIVE.test(name)

export const isSecret = (name: string, type: string): boolean =>
  type === "password" || /pass(word|wd)|secret|token/i.test(name)
