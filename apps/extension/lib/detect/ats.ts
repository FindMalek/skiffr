export type AtsId =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "workday"
  | "smartrecruiters"
  | "icims"
  | "bamboohr"
  | "recruitee"
  | "teamtailor"
  | "linkedin"

type AtsRule = { id: AtsId; host: RegExp; path?: RegExp }

const RULES: readonly AtsRule[] = [
  { id: "greenhouse", host: /^(job-)?boards\.(eu\.)?greenhouse\.io$/ },
  { id: "lever", host: /^jobs\.(eu\.)?lever\.co$/ },
  { id: "ashby", host: /^jobs\.ashbyhq\.com$/ },
  { id: "workable", host: /^apply\.workable\.com$/ },
  { id: "workday", host: /(^|\.)myworkdayjobs\.com$/ },
  { id: "smartrecruiters", host: /^(jobs|careers)\.smartrecruiters\.com$/ },
  { id: "icims", host: /(^|\.)icims\.com$/ },
  { id: "bamboohr", host: /\.bamboohr\.com$/, path: /^\/(careers|jobs)\b/ },
  { id: "recruitee", host: /\.recruitee\.com$/ },
  { id: "teamtailor", host: /\.teamtailor\.com$/ },
  { id: "linkedin", host: /(^|\.)linkedin\.com$/, path: /^\/jobs\b/ },
]

export function matchAts(url: string): AtsId | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
  const host = parsed.hostname.toLowerCase()
  const rule = RULES.find((item) => item.host.test(host) && (!item.path || item.path.test(parsed.pathname)))
  return rule?.id ?? null
}
