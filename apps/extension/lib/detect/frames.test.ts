import { expect, test } from "bun:test"
import { createFrameTracker, FRESH_MS, type FrameRecord, type FrameStorage, selectFillTargets } from "./frames"

function memory(): FrameStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (items) => {
      Object.assign(data, structuredClone(items))
    },
  }
}

const TOP = "https://initech.example/careers"
const ids = async (tracker: ReturnType<typeof createFrameTracker>, tab = 1) =>
  (await tracker.fillTargets(tab)).map((target) => target.frameId)

test("an attacker frame on another origin that reports a form is never a fill target", async () => {
  const tracker = createFrameTracker(memory())
  await tracker.setTop(1, TOP)
  await tracker.report(1, 5, { url: "http://127.0.0.1:8802/attacker", documentId: "a" })
  await tracker.report(1, 6, { url: "https://initech.example/embed", documentId: "b" })
  await tracker.report(1, 7, { url: "https://job-boards.greenhouse.io/initech/jobs/1", documentId: "c" })
  expect(await ids(tracker)).toEqual([6, 7])
})

test("nothing is trusted until the top frame url is known", async () => {
  const tracker = createFrameTracker(memory())
  await tracker.report(1, 6, { url: "https://initech.example/embed", documentId: "b" })
  expect(await tracker.hasTrustedFrame(1)).toBe(false)
  await tracker.setTop(1, TOP)
  expect(await tracker.hasTrustedFrame(1)).toBe(true)
})

test("repeat reports from the same document are duplicates, a new document is not", async () => {
  const tracker = createFrameTracker(memory())
  expect(await tracker.report(1, 6, { url: "https://initech.example/a", documentId: "doc-1" })).toBe("new")
  expect(await tracker.report(1, 6, { url: "https://initech.example/a?x", documentId: "doc-1" })).toBe("duplicate")
  expect(await tracker.report(1, 6, { url: "https://initech.example/a", documentId: "doc-2" })).toBe("new")
})

test("reports survive a worker restart", async () => {
  const storage = memory()
  const first = createFrameTracker(storage)
  await first.setTop(1, TOP)
  await first.report(1, 6, { url: "https://initech.example/embed", documentId: "b" })
  expect(await ids(createFrameTracker(storage))).toEqual([6])
})

test("a top level navigation resets the tab so old embeds no longer count", async () => {
  const tracker = createFrameTracker(memory())
  await tracker.setTop(1, TOP)
  await tracker.report(1, 7, { url: "https://job-boards.greenhouse.io/initech/jobs/1", documentId: "c" })
  expect(await tracker.hasTrustedFrame(1)).toBe(true)
  await tracker.reset(1)
  expect(await tracker.hasTrustedFrame(1)).toBe(false)
  expect(await ids(tracker)).toEqual([])
})

test("a frame that reports a navigation loses its record", async () => {
  const tracker = createFrameTracker(memory())
  await tracker.setTop(1, TOP)
  await tracker.report(1, 6, { url: "https://initech.example/embed", documentId: "b" })
  await tracker.drop(1, 6)
  expect(await ids(tracker)).toEqual([])
})

test("a tab cannot grow the report list without bound", async () => {
  const tracker = createFrameTracker(memory())
  for (let frame = 1; frame <= 200; frame++) {
    await tracker.report(1, frame, { url: "https://initech.example/x", documentId: `d${frame}` })
  }
  await tracker.setTop(1, TOP)
  expect((await tracker.fillTargets(1)).length).toBe(64)
})

const record = (over: Partial<FrameRecord>): FrameRecord => ({
  url: "https://initech.example/embed",
  opaque: false,
  at: 1000,
  documentId: "d",
  ...over,
})

test("fill targets are only the trusted reported frames, never every frame", () => {
  const frames = {
    "1": record({ url: "https://evil.example/ad" }),
    "2": record({}),
    "3": record({ url: "https://job-boards.greenhouse.io/initech/jobs/1" }),
    "4": record({ url: "http://127.0.0.1:8802/attacker" }),
  }
  expect(selectFillTargets(frames, TOP, { now: 1000, requireFresh: true }).map((t) => t.frameId)).toEqual([2, 3])
})

test("a target carries its documentId so a frame that navigated since is not reached", () => {
  const [target] = selectFillTargets({ "2": record({ documentId: "doc-9" }) }, TOP, { now: 1000, requireFresh: true })
  expect(target).toEqual({ frameId: 2, documentId: "doc-9" })
})

test("an opaque origin is untrusted even at a same origin url", () => {
  const frames = { "2": record({ opaque: true }) }
  expect(selectFillTargets(frames, TOP, { now: 1000, requireFresh: false })).toEqual([])
})

test("without a documentId a record must be fresh to be a fill target", () => {
  const frames = { "2": record({ documentId: undefined, at: 1000 }) }
  expect(selectFillTargets(frames, TOP, { now: 1000 + FRESH_MS, requireFresh: true })).toHaveLength(1)
  expect(selectFillTargets(frames, TOP, { now: 1001 + FRESH_MS, requireFresh: true })).toEqual([])
  expect(selectFillTargets(frames, TOP, { now: 1001 + FRESH_MS, requireFresh: false })).toHaveLength(1)
})

test("an opaque origin reported by the sender is recorded as opaque", async () => {
  const tracker = createFrameTracker(memory())
  await tracker.setTop(1, TOP)
  await tracker.report(1, 6, { url: "https://initech.example/embed", documentId: "b", origin: "null" })
  expect(await tracker.hasTrustedFrame(1)).toBe(false)
})
