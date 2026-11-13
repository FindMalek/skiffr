const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

export const esc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)

/** Control characters and the bidi overrides that reorder text on screen. */
function isStripped(code: number): boolean {
  return (
    code <= 8 ||
    code === 11 ||
    code === 12 ||
    (code >= 14 && code <= 31) ||
    code === 127 ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

/** Text from a visitor, safe to keep and to print: no control or bidi characters, bounded. */
export function clean(value: unknown, max = 500): string {
  const text = Array.from(String(value ?? ""))
    .filter((char) => !isStripped(char.codePointAt(0) ?? 0))
    .join("")
  return text.length > max ? `${text.slice(0, max)}...` : text
}

export function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...headers },
  })
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })
}

export function notFound(message = "not found"): Response {
  return new Response(message, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } })
}
