export type PageKind = "ats" | "negative"

export interface FixturePage {
  path: string
  kind: PageKind
  /** The form the detector should recognise: always true for ats pages, false for the negatives. */
  isApplicationForm: boolean
}

export const ATS_PAGES = {
  greenhouse: { path: "/ats/greenhouse.html", kind: "ats", isApplicationForm: true },
  lever: { path: "/ats/lever.html", kind: "ats", isApplicationForm: true },
  ashby: { path: "/ats/ashby.html", kind: "ats", isApplicationForm: true },
  workable: { path: "/ats/workable.html", kind: "ats", isApplicationForm: true },
  generic: { path: "/ats/generic.html", kind: "ats", isApplicationForm: true },
} as const satisfies Record<string, FixturePage>

export const NEGATIVE_PAGES = {
  newsletter: { path: "/negatives/newsletter.html", kind: "negative", isApplicationForm: false },
  login: { path: "/negatives/login.html", kind: "negative", isApplicationForm: false },
  search: { path: "/negatives/search.html", kind: "negative", isApplicationForm: false },
  checkout: { path: "/negatives/checkout.html", kind: "negative", isApplicationForm: false },
} as const satisfies Record<string, FixturePage>

/** A cross-origin greenhouse form inside an iframe. */
export const EMBEDDED_PAGE: FixturePage = { path: "/ats/embedded.html", kind: "ats", isApplicationForm: true }

export type AtsName = keyof typeof ATS_PAGES
export type NegativeName = keyof typeof NEGATIVE_PAGES
