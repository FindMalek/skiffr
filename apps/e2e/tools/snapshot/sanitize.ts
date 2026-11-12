import { Window } from "happy-dom"

export const MAX_INPUT_CHARS = 5_000_000
export const MAX_ELEMENTS = 20_000
export const MAX_DEPTH = 64
const MAX_ATTR_CHARS = 1_000
const MAX_TITLE_CHARS = 200

export const PLACEHOLDER_HOST = "example.invalid"
export const PLACEHOLDER_EMAIL = `user@${PLACEHOLDER_HOST}`
export const PLACEHOLDER_PHONE = "000-000-0000"
export const HIDDEN_VALUE = "x"

export class SanitizeError extends Error {}

const DROP_TAGS = new Set([
  "script",
  "noscript",
  "style",
  "link",
  "base",
  "meta",
  "template",
  "object",
  "embed",
  "applet",
  "param",
  "frame",
  "frameset",
  "portal",
  "audio",
  "track",
  "canvas",
  "math",
  "source",
  "title",
  "head",
  "xmp",
  "plaintext",
  "noembed",
  "noframes",
  "listing",
])
const PLACEHOLDER_TAGS = new Set(["img", "picture", "video", "svg", "iframe"])
const VOID_TAGS = new Set(["br", "hr", "input", "wbr", "col", "area"])
const TAG_NAME = /^[a-z][a-z0-9-]*$/
const ATTR_NAME = /^[a-z_][a-z0-9_:.-]*$/

const DROP_ATTRS = new Set([
  "src",
  "srcset",
  "srcdoc",
  "poster",
  "ping",
  "integrity",
  "nonce",
  "crossorigin",
  "referrerpolicy",
  "background",
  "manifest",
  "data",
  "cite",
  "longdesc",
  "usemap",
  "codebase",
  "imagesrcset",
  "imagesizes",
  "is",
  "xmlns",
  "download",
  "checked",
  "selected",
])
const URL_ATTRS = new Set(["href", "action", "formaction"])
const VERBATIM_ATTRS = new Set([
  "id",
  "name",
  "class",
  "for",
  "type",
  "role",
  "autocomplete",
  "lang",
  "dir",
  "method",
  "enctype",
  "accept",
  "pattern",
  "form",
  "list",
  "rel",
  "target",
  "tabindex",
])
const SCRUBBED_ARIA = /^aria-(?:label|description|valuetext|placeholder|roledescription)$/
const STRUCTURAL_DATA = new Set([
  "data-qa",
  "data-testid",
  "data-test-id",
  "data-test",
  "data-cy",
  "data-automation-id",
  "data-automation",
  "data-field",
  "data-field-name",
  "data-name",
  "data-component",
  "data-form",
  "data-type",
])
const ANALYTICS_DATA =
  /^data-(?:(?:ga|gtm|dd|fbq|hj|ph)(?:-|$)|(?:track|analytics|event|amplitude|segment|pixel|sentry|datadog|mixpanel|heap|optimizely|piwik|matomo|clarity|posthog))/
const SECRET_NAME =
  /(?:token|csrf|xsrf|nonce|session|secret|auth|password|passwd|credential|signature|api-?key|jwt|cookie)/i
const VALUE_INPUTS = new Set(["checkbox", "radio", "submit", "button", "reset", "image"])
const STYLE_PROPS = new Set([
  "display",
  "visibility",
  "opacity",
  "position",
  "left",
  "top",
  "right",
  "bottom",
  "width",
  "height",
  "max-height",
  "overflow",
  "overflow-x",
  "overflow-y",
  "clip",
  "clip-path",
  "content-visibility",
  "pointer-events",
  "filter",
])
const STYLE_VALUE = /^[a-z0-9 .,%()+-]+$/i
const STYLE_FORBIDDEN = /url|expression|image|src|import|script|behavior|binding|attr\(|var\(|env\(/i
const NAME_HINT =
  /(?:name|first|last|full|email|phone|address|city|company|title|school|degree|country|state|select|enter|type|choose|please|your|linkedin|website|salary|date)/i

// Every quantifier below is bounded, so a hostile text node cannot make a rule quadratic.
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s"'<>)]{1,2000}/gi
const EMAIL = /[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g
const PHONE = /(?<![\w.])\+?\(?\d[\d\s().-]{6,24}\d(?!\w)/g
const SECRET_IN_TEXT =
  /\beyJ[\w-]{5,300}\.[\w-]{5,300}(?:\.[\w-]{0,300})?|\bBearer\s+[\w.~+/=-]{12,300}|\b(?:sk|pk|rk|ghp|gho|ghs|xox[abprs]|AKIA)[-_]?[A-Za-z0-9_-]{16,300}|\b[0-9a-f]{32,300}\b/g
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const UUID = new RegExp(`^${UUID_PATTERN}$`, "i")
const UUID_IN_TEXT = new RegExp(`\\b${UUID_PATTERN}\\b`, "gi")
const IDENT_PIECE = new RegExp(
  `${UUID_PATTERN}|eyJ[\\w-]{5,300}\\.[\\w-]{5,300}(?:\\.[\\w-]{0,300})?|[0-9a-f]{16,128}|\\d{6,}`,
  "gi",
)
const LONG_WORD = /\S{24,300}/g
const PROFILE_SEGMENT = new Set([
  "in",
  "u",
  "user",
  "users",
  "profile",
  "profiles",
  "people",
  "pub",
  "candidate",
  "candidates",
  "applicant",
  "applicants",
  "member",
  "members",
  "company",
  "school",
])
const IDENT_ATTRS = new Set(["id", "name", "class", "for", "form", "list"])
const ARIA_REFS = /^aria-(?:labelledby|describedby|controls|owns|activedescendant|errormessage|details|flowto)$/
const PERSONAL_DATA =
  /(?:^|-)(?:user|username|candidate|applicant|person|member|account|customer|profile|email|phone|fullname|firstname|lastname)(?:-|$)/
const SAFE_SEGMENT = /^[A-Za-z][A-Za-z0-9._-]{0,40}$/

const tokenWord = (word: string): boolean =>
  looksLikeToken(word) || (/^[A-Za-z0-9+/=]{24,}$/.test(word) && /\d/.test(word) && /[A-Za-z]/.test(word))

export function looksLikeToken(value: string): boolean {
  const v = value.trim()
  if (UUID.test(v) || /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(v) || /^[0-9a-f]{16,}$/i.test(v) || /^\d{9,}$/.test(v)) {
    return true
  }
  return v.split(/[_.:-]/).some((part) => part.length >= 16 && /[A-Za-z]/.test(part) && /\d/.test(part))
}

function pathShape(path: string): string {
  const parts = path.split("/").map((segment, index, all) => {
    if (segment === "" || segment === "." || segment === "..") return segment
    const owner = (all[index - 1] ?? "").toLowerCase()
    if (PROFILE_SEGMENT.has(owner) || segment.startsWith("@")) return "x"
    if (SAFE_SEGMENT.test(segment) && !looksLikeToken(segment) && !/\d{5,}/.test(segment)) return segment
    return index === all.length - 1 && /^[\w-]+\.(?:pdf|html?|txt)$/i.test(segment) ? segment : "x"
  })
  return parts.join("/").slice(0, 200)
}

function absoluteShape(rest: string): string {
  const path = /^[^/?#]*(\/[^?#]*)?/.exec(rest)?.[1] ?? ""
  return `https://${PLACEHOLDER_HOST}${pathShape(path)}`
}

export function rewriteUrl(raw: string): string {
  const value = raw.replace(/\\/g, "/").replace(/[\p{Cc}\s]/gu, "")
  if (value === "") return "#"
  if (value.startsWith("#")) return /^#[\w-]{1,40}$/.test(value) && !looksLikeToken(value.slice(1)) ? value : "#"
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase()
  if (scheme === "http" || scheme === "https") return absoluteShape(value.replace(/^[a-z]+:\/*/i, ""))
  if (scheme) return "#"
  if (value.startsWith("//")) return absoluteShape(value.slice(2))
  const path = /^[^?#]*/.exec(value)?.[0] ?? ""
  return path === "" ? "#" : pathShape(path)
}

export function scrubText(text: string): string {
  return text
    .replace(URL_IN_TEXT, (url) => absoluteShape(url.replace(/^[a-z]+:\/*/i, "")))
    .replace(EMAIL, PLACEHOLDER_EMAIL)
    .replace(UUID_IN_TEXT, HIDDEN_VALUE)
    .replace(SECRET_IN_TEXT, HIDDEN_VALUE)
    .replace(LONG_WORD, (word) => (tokenWord(word) ? HIDDEN_VALUE : word))
    .replace(PHONE, (match) => {
      const digits = match.replace(/\D/g, "").length
      return digits >= 9 && digits <= 15 ? PLACEHOLDER_PHONE : match
    })
}

function cleanStyle(value: string): string | null {
  const kept: string[] = []
  for (const declaration of value.split(";")) {
    const at = declaration.indexOf(":")
    if (at === -1) continue
    const prop = declaration.slice(0, at).trim().toLowerCase()
    const val = declaration.slice(at + 1).trim()
    if (!STYLE_PROPS.has(prop) || !STYLE_VALUE.test(val) || STYLE_FORBIDDEN.test(val)) continue
    if (prop === "filter" && !/^opacity\(\s*0(?:\.0+)?\s*\)$/i.test(val)) continue
    kept.push(`${prop}:${val.toLowerCase()}`)
  }
  return kept.length > 0 ? [...new Set(kept)].sort().join(";") : null
}

type Idents = Map<string, string>

/** A token inside an identifier becomes `x<n>`, the same one wherever it repeats, so labels, ids and radio names still line up. */
function scrubIdent(value: string, idents: Idents): string {
  return value.replace(IDENT_PIECE, (piece) => {
    let mapped = idents.get(piece)
    if (!mapped) {
      mapped = `x${idents.size + 1}`
      idents.set(piece, mapped)
    }
    return mapped
  })
}

function cleanAttr(name: string, value: string, idents: Idents): string | null {
  if (
    !ATTR_NAME.test(name) ||
    name.includes(":") ||
    name.startsWith("on") ||
    DROP_ATTRS.has(name) ||
    name.startsWith("ng-reflect-") ||
    value.length > MAX_ATTR_CHARS
  )
    return null
  if (name === "style") return cleanStyle(value)
  if (URL_ATTRS.has(name)) return name === "href" ? rewriteUrl(value) : "#"
  if (name.startsWith("data-")) {
    if (STRUCTURAL_DATA.has(name)) return scrubText(value)
    if (ANALYTICS_DATA.test(name) || SECRET_NAME.test(name) || PERSONAL_DATA.test(name.slice(5))) return null
    return looksLikeToken(value) || value.search(EMAIL) !== -1 ? null : scrubText(value)
  }
  if (IDENT_ATTRS.has(name) || ARIA_REFS.test(name)) return scrubIdent(value, idents)
  if (VERBATIM_ATTRS.has(name) || (name.startsWith("aria-") && !SCRUBBED_ARIA.test(name))) return value
  if (name === "value") return scrubText(scrubIdent(value, idents))
  return scrubText(value)
}

function cleanPlaceholder(value: string): string {
  const text = scrubText(value)
  return /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/.test(text) && !NAME_HINT.test(text) ? "Jane Doe" : text
}

function numeric(value: string | null | undefined): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(value ?? "")
  return match ? Number(match[1]) : null
}

function styleSize(style: string | null, prop: "width" | "height"): number | null {
  return numeric(new RegExp(`(?:^|;)${prop}:([^;]*)`).exec(style ?? "")?.[1])
}

function isTiny(el: Element): boolean {
  const style = el.getAttribute("style")
  const width = styleSize(style, "width") ?? numeric(el.getAttribute("width"))
  const height = styleSize(style, "height") ?? numeric(el.getAttribute("height"))
  return (width !== null && width <= 2) || (height !== null && height <= 2)
}

function placeholderFor(el: Element): Element | null {
  if (isTiny(el)) return null
  const tag = el.tagName.toLowerCase()
  const doc = el.ownerDocument
  const holder = doc.createElement(tag === "iframe" ? "div" : "span")
  for (const attr of Array.from(el.attributes)) {
    if (ATTR_NAME.test(attr.name.toLowerCase())) holder.setAttribute(attr.name.toLowerCase(), attr.value)
  }
  const style = holder.getAttribute("style") ?? ""
  const size = ["width", "height"]
    .map((prop) => {
      const px = styleSize(style, prop as "width" | "height") ?? numeric(el.getAttribute(prop))
      return px === null ? "" : `${prop}:${px}px`
    })
    .filter(Boolean)
  holder.removeAttribute("width")
  holder.removeAttribute("height")
  const display = /(?:^|;)display:/.test(style) ? "" : `display:${tag === "iframe" ? "block" : "inline-block"}`
  const merged = [style, ...size.filter((s) => !style.includes(s.split(":")[0] as string)), display].filter(Boolean)
  holder.setAttribute("style", merged.join(";"))
  holder.setAttribute("data-skiffr-placeholder", tag)
  return holder
}

function cleanElement(el: Element, idents: Idents): void {
  const tag = el.tagName.toLowerCase()
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase()
    const next = cleanAttr(name, attr.value, idents)
    el.removeAttribute(attr.name)
    if (next !== null) el.setAttribute(name, next)
  }
  if (el.hasAttribute("placeholder"))
    el.setAttribute("placeholder", cleanPlaceholder(el.getAttribute("placeholder") ?? ""))
  if (tag === "form") el.setAttribute("action", "#")
  if (tag === "textarea") el.textContent = ""
  if (tag === "input") cleanInput(el)
}

function cleanInput(el: Element): void {
  const type = (el.getAttribute("type") ?? "text").toLowerCase()
  if (type === "hidden") {
    el.setAttribute("value", HIDDEN_VALUE)
    return
  }
  if (!VALUE_INPUTS.has(type)) {
    el.removeAttribute("value")
    return
  }
  const secret = SECRET_NAME.test(el.getAttribute("name") ?? "") || SECRET_NAME.test(el.id)
  if (secret && el.hasAttribute("value")) el.setAttribute("value", HIDDEN_VALUE)
}

function depthOf(el: Element): number {
  let depth = 0
  for (let node = el.parentElement; node; node = node.parentElement) depth++
  return depth
}

function sanitizeTree(doc: Document, idents: Idents): void {
  const all = Array.from(doc.querySelectorAll("*"))
  if (all.length > MAX_ELEMENTS) throw new SanitizeError(`too many elements (over ${MAX_ELEMENTS})`)
  for (const el of all) {
    if (!el.isConnected || el === doc.documentElement || el === doc.body) continue
    const tag = el.tagName.toLowerCase()
    if (!TAG_NAME.test(tag) || DROP_TAGS.has(tag) || depthOf(el) > MAX_DEPTH) {
      el.remove()
    } else if (PLACEHOLDER_TAGS.has(tag)) {
      const holder = placeholderFor(el)
      if (holder) {
        cleanElement(holder, idents)
        el.replaceWith(holder)
      } else {
        el.remove()
      }
    } else {
      cleanElement(el, idents)
    }
  }
}

const escapeText = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const escapeAttr = (text: string): string => escapeText(text).replace(/"/g, "&quot;")

function openTag(el: Element): string {
  const attrs = Array.from(el.attributes)
    .map((attr) => [attr.name, attr.value] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
    .join("")
  return `<${el.tagName.toLowerCase()}${attrs}>`
}

type Child = Element | string

function childrenOf(el: Element): Child[] {
  const out: Child[] = []
  let text = ""
  const flush = (): void => {
    if (text !== "") out.push(scrubText(text).replace(/\s+/g, " "))
    text = ""
  }
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? ""
    else if (node.nodeType === 1) {
      flush()
      out.push(node as Element)
    }
  }
  flush()
  return out
}

function inline(child: Child): string {
  if (typeof child === "string") return escapeText(child)
  const tag = child.tagName.toLowerCase()
  if (VOID_TAGS.has(tag)) return openTag(child)
  return `${openTag(child)}${childrenOf(child).map(inline).join("")}</${tag}>`
}

function lines(el: Element, level: number): string[] {
  const pad = "  ".repeat(level)
  const tag = el.tagName.toLowerCase()
  if (VOID_TAGS.has(tag)) return [pad + openTag(el)]
  const kids = childrenOf(el)
  const hasElement = kids.some((kid) => typeof kid !== "string")
  const hasText = kids.some((kid) => typeof kid === "string" && kid.trim() !== "")
  if (!hasElement) {
    return [`${pad}${openTag(el)}${escapeText(kids.join("").trim())}</${tag}>`]
  }
  if (hasText) return [`${pad}${openTag(el)}${kids.map(inline).join("")}</${tag}>`]
  const inner = kids.flatMap((kid) => (typeof kid === "string" ? [] : lines(kid, level + 1)))
  return [pad + openTag(el), ...inner, `${pad}</${tag}>`]
}

function bodyLines(body: Element): string[] {
  const kids = childrenOf(body)
  if (kids.some((kid) => typeof kid === "string" && kid.trim() !== "")) return [kids.map(inline).join("").trim()]
  return kids.flatMap((kid) => (typeof kid === "string" ? [] : lines(kid, 0)))
}

function parse(html: string): { window: Window; doc: Document } {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      disableComputedStyleRendering: true,
      handleDisabledFileLoadingAsSuccess: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
        disableChildPageNavigation: true,
      },
    },
  })
  const doc = window.document as unknown as Document
  doc.write(html)
  return { window, doc }
}

/**
 * Turns a captured page into a page that can be committed: no script, no remote reference, no personal value, one
 * deterministic layout. Sanitizing the output again returns the same text.
 */
export function sanitizeHtml(html: string): string {
  if (html.length > MAX_INPUT_CHARS) throw new SanitizeError(`input too large (over ${MAX_INPUT_CHARS} characters)`)
  const { window, doc } = parse(html)
  try {
    const lang = doc.documentElement.getAttribute("lang") ?? ""
    const dir = doc.documentElement.getAttribute("dir") ?? ""
    const title = scrubText(doc.title ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TITLE_CHARS)
    sanitizeTree(doc, new Map())
    const root = [
      `<html lang="${/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang) ? lang : "en"}"${dir === "rtl" || dir === "ltr" ? ` dir="${dir}"` : ""}>`,
      "<head>",
      '<meta charset="utf-8">',
      `<title>${escapeText(title)}</title>`,
      "</head>",
      "<body>",
      ...bodyLines(doc.body as Element),
      "</body>",
      "</html>",
    ]
    return `<!doctype html>\n${root.join("\n")}\n`
  } finally {
    window.close()
  }
}

const OWN_META = '<meta charset="utf-8">'

const TAG = /<[a-z][^\s/>]*(?:"[^"]*"|'[^']*'|[^>"'])*>/gi
const IDENT_WITH_TOKEN = /\s(?:id|name|for|class)\s*=\s*"[^"]{0,1000}(?:\d{6,}|[0-9a-f]{16,})/i

const VIOLATIONS: readonly [string, RegExp][] = [
  ["script", /<script\b/i],
  ["iframe", /<(?:iframe|frame|object|embed|portal)\b/i],
  ["style element", /<style\b/i],
  ["link, meta or base element", /<(?:link|meta|base)\b/i],
  ["media element", /<(?:img|image|video|audio|picture|source|svg|canvas)\b/i],
  ["noscript or template", /<(?:noscript|template)\b/i],
  ["event handler", /\son[a-z]+\s*=/i],
  ["remote url", /(?:\bhttps?:)?\/\/(?!example\.invalid(?:[/"'\s<]|$))[\w.-]+\.[a-z]{2,}/i],
  ["script url", /\b(?:javascript|vbscript):|\bdata:[a-z]+\/[\w.+-]+/i],
  ["css url or import", /url\s*\(|@import|expression\s*\(/i],
  ["srcdoc, src or srcset", /\s(?:srcdoc|src|srcset|nonce|integrity)\s*=/i],
  ["jwt", /eyJ[\w-]{5,300}\.[\w-]{5,300}/],
  ["uuid", new RegExp(`\\b${UUID_PATTERN}\\b`, "i")],
  ["long hex string", /\b[0-9a-f]{24,}\b/i],
  ["identifier with a token", IDENT_WITH_TOKEN],
  ["ng-reflect attribute", /\sng-reflect-/i],
  ["comment", /<!--/],
]

/** The attributes of one tag, read the way a browser does: a `>` inside a quoted value does not end the tag. */
function attributesOf(tag: string): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const match of tag.matchAll(/\s([^\s=/>"']{1,100})(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g)) {
    attrs.set((match[1] ?? "").toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "")
  }
  return attrs
}

function tagViolations(html: string): string[] {
  const found: string[] = []
  for (const [tag] of html.matchAll(TAG)) {
    const attrs = attributesOf(tag.slice(0, 4000))
    const name = /^<([a-z][^\s/>]*)/i.exec(tag)?.[1]?.toLowerCase()
    if (name === "input" && attrs.get("type")?.toLowerCase() === "hidden" && attrs.get("value") !== HIDDEN_VALUE) {
      found.push(`hidden value: ${tag.slice(0, 80)}`)
    }
    if (
      (name === "form" || name === "button" || name === "input") &&
      [...attrs].some(([k, v]) => /^(?:form)?action$/.test(k) && v !== "#")
    ) {
      found.push(`form action: ${tag.slice(0, 80)}`)
    }
  }
  return found
}

/** What a committed snapshot must never contain. Independent of `sanitizeHtml`, so a regression there cannot hide itself. */
export function findViolations(html: string): string[] {
  if (html.length > MAX_INPUT_CHARS) return ["file is too large"]
  const found: string[] = []
  const body = html.replace(OWN_META, "")
  for (const [name, pattern] of VIOLATIONS) {
    const hit = pattern.exec(body)
    if (hit) found.push(`${name}: ${hit[0].slice(0, 80)}`)
  }
  found.push(...tagViolations(body))
  for (const email of html.match(EMAIL) ?? []) {
    if (email !== PLACEHOLDER_EMAIL) found.push(`email: ${email.slice(0, 80)}`)
  }
  const text = body.replace(/<[^>]{0,4000}>/g, " ")
  const phones = [...(body.match(PHONE) ?? []).filter((match) => /[\s().+-]/.test(match)), ...(text.match(PHONE) ?? [])]
  for (const phone of phones) {
    const digits = phone.replace(/\D/g, "").length
    if (digits >= 9 && digits <= 15 && phone !== PLACEHOLDER_PHONE) found.push(`phone: ${phone}`)
  }
  return found
}

/** Controls by kind: inputs by their `type`, then `textarea` and `select`. Keys are sorted so the output is stable. */
export function countFields(html: string): Record<string, number> {
  const { window, doc } = parse(html)
  try {
    const counts: Record<string, number> = {}
    for (const el of Array.from(doc.querySelectorAll("input, textarea, select"))) {
      const tag = el.tagName.toLowerCase()
      const kind = tag === "input" ? (el.getAttribute("type") ?? "text").toLowerCase() : tag
      counts[kind] = (counts[kind] ?? 0) + 1
    }
    return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)))
  } finally {
    window.close()
  }
}
