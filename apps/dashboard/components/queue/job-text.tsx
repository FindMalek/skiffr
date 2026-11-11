import { displayText, linkHost, neutralizeText, safeHref } from "@skiffr/common/utils"
import { ExternalLinkIcon } from "lucide-react"

/** Text from an email or web page. Always a React text child (never markup), with hidden and bidi characters shown as code points and a long value clipped on a character boundary. */
export function SafeText({ value, max, className }: { value: string; max: number; className?: string }) {
  return (
    <span dir="auto" className={className}>
      {displayText(value, max)}
    </span>
  )
}

/** The host the link really goes to, with the whole address on hover: the thing to check before clicking. */
export function JobHost({ url, className }: { url: string; className?: string }) {
  const host = linkHost(url)
  return (
    <span className={className} title={neutralizeText(url)} dir="ltr">
      {host ?? "Blocked link"}
    </span>
  )
}

/**
 * The only place a job url becomes a link: http(s) only, no credentials, a new tab that gets neither the opener nor
 * the referrer. Anything else is a disabled button, so a stored `javascript:` url can't run.
 */
export function JobLink({
  url,
  label,
  className,
  children,
}: {
  url: string
  label: string
  className: string
  children?: React.ReactNode
}) {
  const href = safeHref(url)
  const host = linkHost(url)
  if (!href || !host) {
    return (
      <button type="button" disabled className={className} title="This link is not a web address and was blocked.">
        <ExternalLinkIcon aria-hidden="true" />
        {children ?? "Blocked"}
      </button>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className={className}
      title={neutralizeText(url)}
      aria-label={`${label} at ${host} (opens in a new tab)`}
    >
      <ExternalLinkIcon aria-hidden="true" />
      {children ?? "Open"}
    </a>
  )
}
