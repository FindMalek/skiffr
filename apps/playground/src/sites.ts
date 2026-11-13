export type SiteKind = "board" | "wizard" | "company" | "framework" | "guard"

export interface Site {
  id: string
  name: string
  kind: SiteKind
  /** Real host names the page answers to (with a resolver rule or a proxy), so the extension's host based detection runs. */
  hosts: string[]
  /** The path of the job on its host, shaped like the real board's. */
  jobPath: string
  /** Hosts shared by two pages (a board and its embed) tell them apart by path. */
  claims?: (path: string) => boolean
  /** The extension has a board adapter for this host. */
  adapter: boolean
  description: string
  tests: string[]
  /** Other states of the same page worth listing on the index. */
  extra?: { label: string; query: string }[]
}

const FRAME_PATH = "/embed/job_app"

export const SITES: Site[] = [
  {
    id: "greenhouse",
    name: "Greenhouse (job-boards)",
    kind: "board",
    hosts: ["job-boards.greenhouse.io"],
    jobPath: "/acme/jobs/4001001",
    adapter: true,
    description:
      "The new Greenhouse board: react-select widgets, a remote location search, EEOC and consent questions.",
    tests: [
      "react-select comboboxes",
      "async location results",
      "private questions left alone",
      "page state survives a re-render",
    ],
  },
  {
    id: "greenhouse-legacy",
    name: "Greenhouse (legacy boards)",
    kind: "board",
    hosts: ["boards.greenhouse.io"],
    claims: (path) => !path.startsWith(FRAME_PATH),
    jobPath: "/acme/jobs/4001002",
    adapter: false,
    description: "The old boards.greenhouse.io markup: a rails form with job_application[...] names and plain selects.",
    tests: ["plain label for inputs", "native selects", "cross version detection on the same ats"],
  },
  {
    id: "lever",
    name: "Lever",
    kind: "board",
    hosts: ["jobs.lever.co"],
    jobPath: "/acme/6ddc5e28-5b1e-4a0e-9a3a-000000000001/apply",
    adapter: true,
    description:
      "jobs.lever.co apply page, including the location dropdown that wipes typed text on blur unless a result is picked.",
    tests: [
      "location autocomplete that clears typed text",
      "yes/no checkboxes",
      "pronouns and EEO sections untouched",
      "signature fields untouched",
    ],
  },
  {
    id: "ashby",
    name: "Ashby",
    kind: "board",
    hosts: ["jobs.ashbyhq.com"],
    jobPath: "/acme/0b1c2d3e-4f50-4a6b-8c7d-000000000002/application",
    adapter: true,
    description: "Ashby single page app with generated class names, yes/no buttons and an autocomplete.",
    tests: ["yes/no button pairs", "autocomplete listbox", "labelled radio groups", "privacy checkbox untouched"],
  },
  {
    id: "workable",
    name: "Workable",
    kind: "board",
    hosts: ["apply.workable.com"],
    jobPath: "/acme/j/A1B2C3D4E5/apply",
    adapter: true,
    description: "apply.workable.com with aria radiogroups, a dropdown and a cookie banner that covers the form.",
    tests: ["aria radiogroups", "cookie consent overlay", "custom dropdown", "EEO answers untouched"],
  },
  {
    id: "linkedin",
    name: "LinkedIn Easy Apply",
    kind: "wizard",
    hosts: ["www.linkedin.com", "linkedin.com"],
    jobPath: "/jobs/view/4001006",
    adapter: false,
    description: "A modal wizard: every step replaces the content of the dialog, the last one reviews the answers.",
    tests: [
      "content replaced between steps",
      "numeric and yes/no questions",
      "voluntary self identification step",
      "review step",
    ],
  },
  {
    id: "workday",
    name: "Workday",
    kind: "wizard",
    hosts: ["acme.wd5.myworkdayjobs.com"],
    jobPath: "/en-US/Acme_Careers/job/Remote/Senior-Engineer_R-1001/apply",
    adapter: false,
    description:
      "data-automation-id markup in several pages: my information, experience, questions, disclosures, review.",
    tests: [
      "data-automation-id selectors",
      "listbox dropdowns",
      "multi page flow",
      "disability self identification and signature untouched",
    ],
    extra: [{ label: "with the account wall", query: "wall=1" }],
  },
  {
    id: "smartrecruiters",
    name: "SmartRecruiters",
    kind: "board",
    hosts: ["jobs.smartrecruiters.com"],
    jobPath: "/Acme/743999000000001-senior-engineer",
    adapter: false,
    description: "oneclick-ui style form made of custom element wrappers and a consent block.",
    tests: [
      "custom element wrappers around inputs",
      "consent checkboxes untouched",
      "sections with their own headings",
    ],
  },
  {
    id: "teamtailor",
    name: "Teamtailor",
    kind: "board",
    hosts: ["acme.teamtailor.com"],
    jobPath: "/jobs/4001009-senior-engineer",
    adapter: false,
    description: "Rails style candidate[...] names, floating labels and a privacy checkbox.",
    tests: ["candidate[...] names", "floating labels", "privacy checkbox untouched"],
  },
  {
    id: "bamboohr",
    name: "BambooHR",
    kind: "board",
    hosts: ["acme.bamboohr.com"],
    jobPath: "/careers/12",
    adapter: false,
    description:
      "A /careers/<id> page with a fabric style form: desired pay, date available and a work authorization question.",
    tests: ["path gated host detection", "date and pay fields", "radio groups"],
  },
  {
    id: "recruitee",
    name: "Recruitee",
    kind: "board",
    hosts: ["acme.recruitee.com"],
    jobPath: "/o/senior-engineer/c/new",
    adapter: false,
    description: "A single full name field, a cover letter and a GDPR consent checkbox.",
    tests: ["one name field instead of two", "gdpr consent untouched"],
  },
  {
    id: "personio",
    name: "Personio",
    kind: "board",
    hosts: ["acme.jobs.personio.de"],
    jobPath: "/job/1001001",
    adapter: false,
    description: "European board with start date, salary expectation, weekly hours and data privacy consent.",
    tests: ["date input", "salary expectation", "two consent checkboxes untouched"],
  },
  {
    id: "join",
    name: "JOIN",
    kind: "board",
    hosts: ["join.com"],
    jobPath: "/companies/acme/1001001-senior-engineer",
    adapter: false,
    description: "A component library form with floating labels and a stacked consent block.",
    tests: ["floating labels", "stacked consent", "optional fields left empty"],
  },
  {
    id: "generic",
    name: "Company careers page",
    kind: "company",
    hosts: ["careers.acme.test"],
    jobPath: "/careers/senior-engineer",
    adapter: false,
    description: "A plain company page with a generic form: no board, no framework, only labels.",
    tests: ["generic detection without a known host", "label based mapping"],
  },
  {
    id: "embed",
    name: "Company page with a Greenhouse embed",
    kind: "company",
    hosts: ["www.acme.test"],
    jobPath: "/company/careers",
    adapter: false,
    description: "A company page that holds the Greenhouse form in an iframe served from a second host.",
    tests: ["cross origin iframe", "frame trust rules", "fill inside a frame"],
  },
  {
    id: "embed-frame",
    name: "Greenhouse embed frame",
    kind: "board",
    hosts: ["boards.greenhouse.io"],
    claims: (path) => path.startsWith(FRAME_PATH),
    jobPath: `${FRAME_PATH}?for=acme&token=4001010`,
    adapter: false,
    description: "The frame itself, so it can be opened and filled on its own.",
    tests: ["the frame document alone"],
  },
  {
    id: "react",
    name: "React controlled form",
    kind: "framework",
    hosts: [],
    jobPath: "/apply/react",
    adapter: false,
    description:
      "A real React 19 form with controlled inputs, mounted late: values written without the native setter are lost.",
    tests: ["controlled inputs", "value tracker", "late mount (latency switch)"],
  },
  {
    id: "vue",
    name: "Vue form",
    kind: "framework",
    hosts: [],
    jobPath: "/apply/vue",
    adapter: false,
    description: "A real Vue 3 form using v-model directives on text, select and checkbox.",
    tests: ["v-model text and select", "change versus input events"],
  },
  {
    id: "shadow",
    name: "Shadow DOM form",
    kind: "framework",
    hosts: [],
    jobPath: "/apply/shadow",
    adapter: false,
    description: "The whole form lives in an open shadow root, labels included.",
    tests: ["controls inside an open shadow root", "labels inside the root"],
  },
  {
    id: "honeypot",
    name: "Inert honeypot form",
    kind: "guard",
    hosts: [],
    jobPath: "/apply/honeypot",
    adapter: false,
    description:
      "A real form plus traps no person sees: an off screen website field, a hidden email confirmation and a disabled field.",
    tests: ["hidden fields stay empty", "off screen fields stay empty", "disabled fields stay empty"],
  },
  {
    id: "eeo",
    name: "EEO, consent and signature",
    kind: "guard",
    hosts: [],
    jobPath: "/apply/eeo",
    adapter: false,
    description: "Contact fields next to equal opportunity questions, consent checkboxes and a legal signature.",
    tests: ["eeo selects untouched", "consent checkboxes untouched", "signature and date untouched"],
  },
]

export const SITE_BY_ID: ReadonlyMap<string, Site> = new Map(SITES.map((site) => [site.id, site]))
