import type { GmailMessage, MessagePart } from "./google"
import { HTML_CHARS_MAX } from "./html"

export interface ReadMessage {
  from: string | null
  /** Gmail's own `Authentication-Results`: it says whether the sender passed spf, dkim and dmarc. */
  authentication: string | null
  html?: string
  text?: string
}

const PARTS_MAX = 200
const DEPTH_MAX = 8

const header = (part: MessagePart | undefined, name: string) =>
  part?.headers?.find((candidate) => candidate.name.toLowerCase() === name)?.value ?? null

function decode(part: MessagePart): string | null {
  const data = part.body?.data
  if (!data) return null
  const charset = header(part, "content-type")?.match(/charset="?([\w-]+)"?/i)?.[1] ?? "utf-8"
  const bytes = Buffer.from(data, "base64url")
  try {
    return new TextDecoder(charset).decode(bytes).slice(0, HTML_CHARS_MAX)
  } catch {
    return bytes.toString("utf8").slice(0, HTML_CHARS_MAX)
  }
}

/**
 * Only the readable parts: the first `text/html` and `text/plain` body. Attachments (a part with a filename or an
 * attachment id) and every other type are never opened, and the walk is bounded in depth and size.
 */
export function readMessage(message: GmailMessage): ReadMessage {
  const root = message.payload
  const found: ReadMessage = {
    from: header(root, "from"),
    authentication: header(root, "authentication-results"),
  }
  const stack: Array<{ part: MessagePart; depth: number }> = root ? [{ part: root, depth: 0 }] : []
  let visited = 0
  while (stack.length > 0 && visited++ < PARTS_MAX) {
    const { part, depth } = stack.pop()!
    const type = part.mimeType?.toLowerCase()
    const attachment = Boolean(part.filename) || Boolean(part.body?.attachmentId)
    if (!attachment && type === "text/html" && found.html === undefined) found.html = decode(part) ?? undefined
    else if (!attachment && type === "text/plain" && found.text === undefined) found.text = decode(part) ?? undefined
    if (depth < DEPTH_MAX && part.parts) {
      for (let i = part.parts.length - 1; i >= 0; i--) stack.push({ part: part.parts[i]!, depth: depth + 1 })
    }
  }
  return found
}

/**
 * Fails closed: only a `dmarc=pass` for the sender's own domain counts. A missing header, `dmarc=none`, a softfail or a
 * pass for some other domain is somebody else pretending to be the sender. DMARC alone decides, so a failed secondary
 * dkim signature next to a passing dmarc does not lose a real alert.
 */
export function senderAuthenticated(authentication: string | null, address: string): boolean {
  if (authentication === null) return false
  const host = address.slice(address.indexOf("@") + 1).toLowerCase()
  for (const segment of authentication.split(";")) {
    if (!/^\s*dmarc=pass\b/i.test(segment)) continue
    const domain = segment.match(/\bheader\.from=([a-z0-9.-]+)/i)?.[1]?.toLowerCase()
    if (domain === host) return true
  }
  return false
}
