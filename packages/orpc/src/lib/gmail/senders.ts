import { GMAIL_SENDER_MAX } from "@skiffr/common/constants"

export const PROVIDERS = ["linkedin", "indeed", "glassdoor", "wellfound", "ziprecruiter", "other"] as const
export type Provider = (typeof PROVIDERS)[number]

/** Sender domains of the known job boards. Anything else is `other` and gets the generic parser. */
const PROVIDER_DOMAINS: Record<Exclude<Provider, "other">, string[]> = {
  linkedin: ["linkedin.com"],
  indeed: ["indeed.com"],
  glassdoor: ["glassdoor.com"],
  wellfound: ["wellfound.com", "angel.co"],
  ziprecruiter: ["ziprecruiter.com"],
}

/** Best known job alert senders: a starting point the user edits, not a promise that every sender is exact. */
export const DEFAULT_SENDERS: readonly string[] = [
  "jobalerts-noreply@linkedin.com",
  "jobs-listings@linkedin.com",
  "jobs-noreply@linkedin.com",
  "alert@indeed.com",
  "donotreply@jobalert.indeed.com",
  "noreply@glassdoor.com",
  "alerts@glassdoor.com",
  "jobs@wellfound.com",
  "no-reply@wellfound.com",
  "alerts@ziprecruiter.com",
  "noreply@ziprecruiter.com",
]

const DOMAIN = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+"
const ADDRESS = new RegExp(`^[a-z0-9][a-z0-9._%+-]{0,63}@${DOMAIN}$`)
const DOMAIN_ONLY = new RegExp(`^@${DOMAIN}$`)

/** `Jobs@Site.com` and `site.com` become `jobs@site.com` and `@site.com`; null when it is neither. Only those characters get in, so a sender can't carry search operators. */
export function normalizeSender(input: string): string | null {
  const value = input.trim().toLowerCase()
  if (value.length === 0 || value.length > GMAIL_SENDER_MAX) return null
  if (ADDRESS.test(value) || DOMAIN_ONLY.test(value)) return value
  const asDomain = `@${value}`
  return DOMAIN_ONLY.test(asDomain) ? asDomain : null
}

/** The Gmail search for what to read: unread inbox mail from the watched senders, recent only. */
export function buildQuery(senders: readonly string[], newerThanDays = 14): string {
  const from = senders.map((sender) => (sender.startsWith("@") ? sender.slice(1) : sender)).join(" OR ")
  return `is:unread in:inbox from:(${from}) newer_than:${newerThanDays}d`
}

/** The address out of a `From` header (`Name <a@b.com>` or `a@b.com`), lowercased; null when it holds more than one mailbox. */
export function fromAddress(header: string): string | null {
  const unquoted = header.replace(/"(?:[^"\\]|\\.)*"/g, "")
  if (unquoted.split("@").length !== 2) return null
  const bracketed = unquoted.match(/<([^<>\s]+)>\s*$/)
  const candidate = (bracketed?.[1] ?? unquoted).trim().toLowerCase()
  return ADDRESS.test(candidate) ? candidate : null
}

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

/** Gmail's `from:` also matches display names, so the real address is checked against the list again. */
export function isWatched(address: string, senders: readonly string[]): boolean {
  const host = address.slice(address.indexOf("@") + 1)
  return senders.some((sender) => (sender.startsWith("@") ? hostMatches(host, sender.slice(1)) : sender === address))
}

export function providerOf(address: string): Provider {
  const host = address.slice(address.indexOf("@") + 1)
  for (const [provider, domains] of Object.entries(PROVIDER_DOMAINS)) {
    if (domains.some((domain) => hostMatches(host, domain))) return provider as Provider
  }
  return "other"
}
