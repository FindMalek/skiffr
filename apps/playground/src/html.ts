const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }

export const esc = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)

/** Text from a visitor, safe to keep and to print: no control characters, bounded. */
export function clean(value: unknown, max = 500): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
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
