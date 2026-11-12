const ERRORS: Record<string, string> = {
  blocked: "That address is not a public web page, so skiffr will not fetch it. Remove it and add a public one.",
  dns: "The site's name could not be found.",
  network: "The site could not be reached. skiffr tries again on its own.",
  timeout: "The site took too long to answer. skiffr tries again on its own.",
  too_large: "The page is bigger than skiffr reads (2 MB).",
  content_type: "The address does not serve a web page or a feed.",
  not_found: "The page is gone (404). Check the address.",
  rate_limited: "The site asked skiffr to slow down. It tries again later.",
  upstream: "The site had a problem. skiffr tries again on its own.",
  unparseable: "The page came back but skiffr could not read jobs from it.",
  internal: "Something went wrong on our side. skiffr tries again on its own.",
}

const KINDS: Record<string, string> = {
  auto: "Unknown",
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workable: "Workable",
  feed: "Feed",
  html: "Web page",
}

export const errorFor = (code: string | null): string =>
  code && Object.hasOwn(ERRORS, code) ? (ERRORS[code] as string) : (ERRORS.internal as string)

export const kindLabel = (kind: string): string => (Object.hasOwn(KINDS, kind) ? (KINDS[kind] as string) : "Web page")
