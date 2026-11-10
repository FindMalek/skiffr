import { isTrustedFrameUrl } from "./ats"

type FrameEntry = { doc: string; url: string }
type TabFrames = { top: string | null; frames: Record<string, FrameEntry> }
type Reports = Record<string, TabFrames>

export type FrameStorage = {
  get: (key: string) => Promise<Record<string, unknown>>
  set: (items: Record<string, unknown>) => Promise<void>
}

export type FrameTracker = {
  setTop: (tabId: number, url: string) => Promise<void>
  report: (tabId: number, frameId: number, url: string, doc: string | undefined) => Promise<"new" | "duplicate">
  trustedFrames: (tabId: number) => Promise<number[]>
  reset: (tabId: number) => Promise<void>
}

const STORAGE_KEY = "frameReports"
const MAX_FRAMES_PER_TAB = 64

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
      const tab = tabOf(reports, tabId)
      tab.top = url
      await storage.set({ [STORAGE_KEY]: reports })
    },
    async report(tabId, frameId, url, doc) {
      const reports = await load()
      const key = doc ?? url
      if (reports[tabId]?.frames[frameId]?.doc === key) return "duplicate"
      if (Object.keys(reports[tabId]?.frames ?? {}).length >= MAX_FRAMES_PER_TAB && !reports[tabId]?.frames[frameId]) {
        return "duplicate"
      }
      const tab = tabOf(reports, tabId)
      tab.frames[frameId] = { doc: key, url }
      await storage.set({ [STORAGE_KEY]: reports })
      return "new"
    },
    async trustedFrames(tabId) {
      const tab = (await load())[tabId]
      if (!tab?.top) return []
      const top = tab.top
      return Object.entries(tab.frames)
        .filter(([, entry]) => isTrustedFrameUrl(top, entry.url))
        .map(([frameId]) => Number(frameId))
    },
    async reset(tabId) {
      const reports = await load()
      if (!reports[tabId]) return
      delete reports[tabId]
      await storage.set({ [STORAGE_KEY]: reports })
    },
  }
}
