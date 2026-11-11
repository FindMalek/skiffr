const hosts = (domains: string[]) =>
  new RegExp(`(?:^|\\.)(?:${domains.map((d) => d.replaceAll(".", "\\.")).join("|")})$`)

const COUNTRIES = [
  "ae",
  "at",
  "be",
  "ca",
  "ch",
  "cl",
  "co.in",
  "co.nz",
  "co.uk",
  "co.za",
  "com.ar",
  "com.au",
  "com.br",
  "com.mx",
  "com.sg",
  "de",
  "dk",
  "es",
  "fi",
  "fr",
  "ie",
  "it",
  "nl",
  "no",
  "pl",
  "pt",
  "se",
]

const withCountries = (name: string, extra: string[] = []) =>
  ["com", ...COUNTRIES, ...extra].map((tld) => `${name}.${tld}`)

/** Real vendor domains only (a domain or any subdomain of it): a lookalike such as `indeed.xyz` never matches. */
export const LINKEDIN_HOST = hosts(["linkedin.com"])
export const INDEED_HOST = hosts(withCountries("indeed", ["co.jp", "co.kr", "co.id", "com.hk", "com.my"]))
export const GLASSDOOR_HOST = hosts(withCountries("glassdoor"))
export const WELLFOUND_HOST = hosts(["wellfound.com", "angel.co"])
export const ZIPRECRUITER_HOST = hosts(["ziprecruiter.com"])
