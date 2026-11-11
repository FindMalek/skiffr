import { isTrustedFrameUrl } from "./ats"

export type FrameRecord = {
  url: string
  /** Chrome only. Lets a message address one document, so a frame that navigated since is not reached. */
  documentId?: string
  /** The frame's origin is opaque (sandboxed), so its url says nothing about who it is. */
  opaque: boolean
  at: number
}
export type FillTarget = { frameId: number; documentId?: string }
type TabFrames = { top: string | null; topDocumentId?: string; frames: Record<string, FrameRecord> }
type Reports = Record<string, TabFrames>

export type FrameReport = { url: string; documentId?: string; origin?: string }

export type FrameStorage = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

export type FrameTracker = {
  setTop: (tabId: number, url: string) => Promise<void>
  /**
   * The top frame's content script started or its url changed. A different top documentId (or none known) means a
   * new top document, so everything reported so far belongs to a page that is gone and is dropped.
   */
  startTop: (tabId: number, url: string, documentId: string | undefined) => Promise<"new-document" | "same-document">
  report: (tabId: number, frameId: number, report: FrameReport, now?: number) => Promise<"new" | "duplicate">
  drop: (tabId: number, frameId: number) => Promise<void>
  /** Frames that may be told to fill. */
  fillTargets: (tabId: number, now?: number) => Promise<FillTarget[]>
  /** Whether any reported frame is trustworthy, for showing the toast. */
  hasTrustedFrame: (tabId: number) => Promise<boolean>
  reset: (tabId: number) => Promise<void>
}

const STORAGE_KEY = "frameReports"
const MAX_FRAMES_PER_TAB = 64
// a page can make its own url huge, and session storage has a small quota shared by every tab
export const MAX_URL_LENGTH = 2048
const MAX_ID_LENGTH = 64

const capUrl = (url: string): string => url.slice(0, MAX_URL_LENGTH)
export const FRESH_MS = 5_000

/**
 * Which reported frames may receive a fill: only ones on the top frame's origin or a known ats host, never an
 * opaque origin. A record without a documentId cannot be addressed to one document, so it must have been
 * reported just now (the frame may have navigated since).
 */
export function selectFillTargets(
  frames: Record<string, FrameRecord>,
  topUrl: string | null,
  options: { now: number; requireFresh: boolean },
): FillTarget[] {
  if (!topUrl) return []
  const targets: FillTarget[] = []
  for (const [frameId, record] of Object.entries(frames)) {
    if (record.opaque || !isTrustedFrameUrl(topUrl, record.url)) continue
    if (options.requireFresh && !record.documentId && options.now - record.at > FRESH_MS) continue
    targets.push({ frameId: Number(frameId), ...(record.documentId ? { documentId: record.documentId } : {}) })
  }
  return targets
}

// the worker can be stopped while a toast is open, so what each frame reported lives in session storage
export function createFrameTracker(storage: FrameStorage): FrameTracker {
  let loaded: Promise<Reports> | null = null

  function load(): Promise<Reports> {
    loaded ??= storage
      .get(STORAGE_KEY)
      .then((stored) => {
        const value = stored[STORAGE_KEY]
        return typeof value === "object" && value !== null ? (value as Reports) : {}
      })
      .catch(() => ({}))
    return loaded
  }

  // a full or failing storage must not take detection down, the records stay in memory for this worker
  async function persist(reports: Reports): Promise<void> {
    try {
      await storage.set({ [STORAGE_KEY]: reports })
    } catch (error) {
      console.error("[skiffr] could not persist frame records", error)
    }
  }

  function tabOf(reports: Reports, tabId: number): TabFrames {
    const existing = reports[tabId]
    if (existing) return existing
    const created: TabFrames = { top: null, frames: {} }
    reports[tabId] = created
    return created
  }

  return {
    async setTop(tabId, url) {
      const reports = await load()
      tabOf(reports, tabId).top = capUrl(url)
      await persist(reports)
    },
    async startTop(tabId, url, documentId) {
      const reports = await load()
      const known = reports[tabId]
      const same = known !== undefined && documentId !== undefined && known.topDocumentId === documentId
      const tab = same ? known : { top: capUrl(url), frames: {} }
      tab.top = capUrl(url)
      tab.topDocumentId = documentId?.slice(0, MAX_ID_LENGTH)
      reports[tabId] = tab
      await persist(reports)
      return same ? "same-document" : "new-document"
    },
    async report(tabId, frameId, report, now = Date.now()) {
      const reports = await load()
      const known = reports[tabId]?.frames[frameId]
      const same =
        known && (report.documentId ? known.documentId === report.documentId : known.url === capUrl(report.url))
      if (!known && Object.keys(reports[tabId]?.frames ?? {}).length >= MAX_FRAMES_PER_TAB) return "duplicate"
      tabOf(reports, tabId).frames[frameId] = {
        url: capUrl(report.url),
        documentId: report.documentId?.slice(0, MAX_ID_LENGTH),
        opaque: report.origin === "null",
        at: now,
      }
      await persist(reports)
      return same ? "duplicate" : "new"
    },
    async drop(tabId, frameId) {
      const reports = await load()
      if (!reports[tabId]?.frames[frameId]) return
      delete reports[tabId].frames[frameId]
      await persist(reports)
    },
    async fillTargets(tabId, now = Date.now()) {
      const tab = (await load())[tabId]
      return selectFillTargets(tab?.frames ?? {}, tab?.top ?? null, { now, requireFresh: true })
    },
    async hasTrustedFrame(tabId) {
      const tab = (await load())[tabId]
      return selectFillTargets(tab?.frames ?? {}, tab?.top ?? null, { now: 0, requireFresh: false }).length > 0
    },
    async reset(tabId) {
      const reports = await load()
      if (!reports[tabId]) return
      delete reports[tabId]
      await persist(reports)
    },
  }
}
