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
type TabFrames = { top: string | null; frames: Record<string, FrameRecord> }
type Reports = Record<string, TabFrames>

export type FrameReport = { url: string; documentId?: string; origin?: string }

export type FrameStorage = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

export type FrameTracker = {
  setTop: (tabId: number, url: string) => Promise<void>
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
    loaded ??= storage.get(STORAGE_KEY).then((stored) => {
      const value = stored[STORAGE_KEY]
      return typeof value === "object" && value !== null ? (value as Reports) : {}
    })
    return loaded
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
      tabOf(reports, tabId).top = url
      await storage.set({ [STORAGE_KEY]: reports })
    },
    async report(tabId, frameId, report, now = Date.now()) {
      const reports = await load()
      const known = reports[tabId]?.frames[frameId]
      const same = known && (report.documentId ? known.documentId === report.documentId : known.url === report.url)
      if (!known && Object.keys(reports[tabId]?.frames ?? {}).length >= MAX_FRAMES_PER_TAB) return "duplicate"
      tabOf(reports, tabId).frames[frameId] = {
        url: report.url,
        documentId: report.documentId,
        opaque: report.origin === "null",
        at: now,
      }
      await storage.set({ [STORAGE_KEY]: reports })
      return same ? "duplicate" : "new"
    },
    async drop(tabId, frameId) {
      const reports = await load()
      if (!reports[tabId]?.frames[frameId]) return
      delete reports[tabId].frames[frameId]
      await storage.set({ [STORAGE_KEY]: reports })
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
      await storage.set({ [STORAGE_KEY]: reports })
    },
  }
}
