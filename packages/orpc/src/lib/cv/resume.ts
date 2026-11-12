import { Parser } from "htmlparser2"
import { CvError } from "./errors"
import { squash } from "./text"

type Json = Record<string, unknown>

export interface RrResume {
  id: string
  name: string
  updatedAt: string
  data: Json
}

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === "string" ? value : "")
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : [])

export const ID = /^[A-Za-z0-9_-]{1,100}$/

/** The resume as the api returns it, checked just enough to be read: anything else is "a format skiffr can't read" instead of a crash. */
export function parseResume(json: unknown): RrResume {
  if (!isObject(json) || !isObject(json.data) || !isObject(json.data.sections)) throw new CvError("invalid_resume")
  const { id, name, updatedAt } = json
  if (typeof id !== "string" || !ID.test(id) || typeof name !== "string" || typeof updatedAt !== "string")
    throw new CvError("invalid_resume")
  return { id, name, updatedAt, data: json.data }
}

export interface ParsedList {
  bullets: string[]
  /** The markup of each bullet as the editor wrote it, so an unchanged bullet keeps its formatting. */
  items: string[]
  open: string
  close: string
}

/** Text of an html fragment, a line break at every block boundary. */
export function htmlText(html: string): string {
  let out = ""
  const parser = new Parser({
    ontext(data) {
      out += data
    },
    onopentag(name) {
      if (/^(?:p|li|div|br|h[1-6])$/.test(name)) out += "\n"
    },
  })
  parser.write(html)
  parser.end()
  return out.split("\n").map(squash).filter(Boolean).join("\n")
}

/** The bullets of a description that is nothing but a list; anything else (loose paragraphs, headings) is left alone, as it can't be rewritten without losing it. */
export function parseBullets(html: string): ParsedList | null {
  const bullets: string[] = []
  const items: string[] = []
  let open = ""
  let close = ""
  let listDepth = 0
  let liDepth = 0
  let liStart = 0
  let text = ""
  let pure = true
  const parser = new Parser({
    onopentag(name) {
      if (liDepth > 0) {
        if (name === "li") liDepth++
        return
      }
      if (name === "ul" || name === "ol") {
        if (listDepth === 0 && !open) {
          open = html.slice(parser.startIndex, parser.endIndex + 1)
          close = `</${name}>`
        }
        listDepth++
      } else if (name === "li" && listDepth > 0) {
        liDepth = 1
        liStart = parser.startIndex
        text = ""
      } else pure = false
    },
    ontext(data) {
      if (liDepth > 0) text += data
      else if (data.trim()) pure = false
    },
    onclosetag(name) {
      if (name === "li" && liDepth > 0) {
        liDepth--
        if (liDepth === 0) {
          const bullet = squash(text)
          if (bullet) {
            bullets.push(bullet)
            items.push(html.slice(liStart, parser.endIndex + 1))
          }
        }
      } else if ((name === "ul" || name === "ol") && liDepth === 0) listDepth--
    },
  })
  parser.write(html)
  parser.end()
  return pure && bullets.length > 0 && open ? { bullets, items, open, close } : null
}

const escapeHtml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export function bulletsHtml(parsed: ParsedList, bullets: readonly string[]): string {
  const body = bullets.map((bullet) => {
    const at = parsed.bullets.indexOf(bullet)
    return at >= 0 ? (parsed.items[at] as string) : `<li><p>${escapeHtml(bullet)}</p></li>`
  })
  return `${parsed.open}${body.join("")}${parsed.close}`
}

export const paragraphsHtml = (text: string): string =>
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("")

export interface ViewItem {
  /** Position in the resume as it was fetched. Not part of what the model sees. */
  origin: number
  hidden: boolean
}
export interface SkillView extends ViewItem {
  name: string
  keywords: string[]
}
export interface ExperienceView extends ViewItem {
  company: string
  position: string
  period: string
  /** Null when the description is not a plain list: it is shown but can't be rewritten. */
  bullets: string[] | null
}
export interface ResumeView {
  headline: string
  summary: string
  /** A hidden summary is not read by anyone, so it is neither a source nor edited. */
  summaryHidden: boolean
  skills: SkillView[]
  experience: ExperienceView[]
  sections: Record<string, { hidden: boolean }>
}

const SECTION_NAME = /^[a-z]{3,24}$/

export function sectionItems(data: Json, name: string): Json[] {
  const section = data.sections
  return isObject(section) && isObject(section[name]) ? list(section[name].items) : []
}

/** Own section names only: `constructor` or `__proto__` are not sections. */
export const hasSection = (view: ResumeView, name: string): boolean => Object.hasOwn(view.sections, name)

/**
 * `hidden` on an item is what a reader sees: an item of a hidden section is hidden too. The text of hidden items stays
 * here (it is shown as "Hidden" in a diff) but is never a source of words and never goes to the model.
 */
export function buildView(data: Json): ResumeView {
  const sections: ResumeView["sections"] = {}
  if (isObject(data.sections)) {
    for (const [name, section] of Object.entries(data.sections)) {
      if (SECTION_NAME.test(name) && isObject(section)) sections[name] = { hidden: section.hidden === true }
    }
  }
  const hiddenSection = (name: string) => sections[name]?.hidden === true
  const summary = isObject(data.summary) ? data.summary : {}
  return {
    headline: squash(str(isObject(data.basics) ? data.basics.headline : "")),
    summary: htmlText(str(summary.content)),
    summaryHidden: summary.hidden === true,
    skills: sectionItems(data, "skills").map((item, origin) => ({
      origin,
      name: str(item.name),
      keywords: Array.isArray(item.keywords) ? item.keywords.filter((k): k is string => typeof k === "string") : [],
      hidden: item.hidden === true || hiddenSection("skills"),
    })),
    experience: sectionItems(data, "experience").map((item, origin) => ({
      origin,
      company: str(item.company) || str(item.organization),
      position: str(item.position),
      period: str(item.period),
      bullets: parseBullets(str(item.description))?.bullets ?? null,
      hidden: item.hidden === true || hiddenSection("experience"),
    })),
    sections,
  }
}

/** What the model is shown: no internal positions, and hidden items and a hidden summary as nothing but the fact that they are hidden. */
export function modelView(view: ResumeView) {
  const shown = <T extends ViewItem>({ origin: _origin, ...rest }: T) => (rest.hidden ? { hidden: true } : rest)
  return {
    headline: view.headline,
    summary: view.summaryHidden ? "" : view.summary,
    skills: view.skills.map(shown),
    experience: view.experience.map(shown),
    sections: view.sections,
  }
}

const SKIP_KEYS = new Set(["id", "icon", "iconColor", "url", "inlineLink", "columns", "keepTogether", "startOnNewPage"])

function collect(value: unknown, out: string[], depth = 0) {
  if (depth > 8) return
  if (typeof value === "string") out.push(/<[a-z][^>]*>/i.test(value) ? htmlText(value) : value)
  else if (Array.isArray(value)) for (const child of value.slice(0, 500)) collect(child, out, depth + 1)
  else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) if (!SKIP_KEYS.has(key)) collect(child, out, depth + 1)
  }
}

/** The text a recruiter's system would read: hidden sections and items are not there. */
export function visibleTexts(data: Json): string[] {
  const out: string[] = []
  const basics = isObject(data.basics) ? data.basics : {}
  out.push(str(basics.headline))
  const summary = isObject(data.summary) ? data.summary : {}
  if (summary.hidden !== true) out.push(htmlText(str(summary.content)))
  if (isObject(data.sections)) {
    for (const section of Object.values(data.sections)) {
      if (!isObject(section) || section.hidden === true) continue
      for (const item of list(section.items)) if (item.hidden !== true) collect(item, out)
    }
  }
  return out
}
