import { expect, test } from "bun:test"
import { createFrameTracker, type FrameStorage } from "./frames"

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

test("an attacker frame on another origin that reports a form is never a fill target", async () => {
  const tracker = createFrameTracker(memory())
  await tracker.setTop(1, TOP)
  await tracker.report(1, 5, "http://127.0.0.1:8802/attacker", "doc-a")
  await tracker.report(1, 6, "https://initech.example/embed", "doc-b")
  await tracker.report(1, 7, "https://job-boards.greenhouse.io/initech/jobs/1", "doc-c")
  expect(await tracker.trustedFrames(1)).toEqual([6, 7])
})

test("nothing is trusted until the top frame url is known", async () => {
  const tracker = createFrameTracker(memory())
  await tracker.report(1, 6, "https://initech.example/embed", "doc-b")
  expect(await tracker.trustedFrames(1)).toEqual([])
  await tracker.setTop(1, TOP)
  expect(await tracker.trustedFrames(1)).toEqual([6])
})

test("repeat reports from the same document are duplicates, a new document is not", async () => {
  const tracker = createFrameTracker(memory())
  expect(await tracker.report(1, 6, "https://initech.example/a", "doc-1")).toBe("new")
  expect(await tracker.report(1, 6, "https://initech.example/a?x", "doc-1")).toBe("duplicate")
  expect(await tracker.report(1, 6, "https://initech.example/a", "doc-2")).toBe("new")
})

test("reports survive a worker restart and are dropped with the tab", async () => {
  const storage = memory()
  const first = createFrameTracker(storage)
  await first.setTop(1, TOP)
  await first.report(1, 6, "https://initech.example/embed", "doc-b")
  const restarted = createFrameTracker(storage)
  expect(await restarted.trustedFrames(1)).toEqual([6])
  await restarted.reset(1)
  expect(await createFrameTracker(storage).trustedFrames(1)).toEqual([])
})

test("a tab cannot grow the report list without bound", async () => {
  const tracker = createFrameTracker(memory())
  for (let frame = 1; frame <= 200; frame++) await tracker.report(1, frame, "https://initech.example/x", `d${frame}`)
  await tracker.setTop(1, TOP)
  expect((await tracker.trustedFrames(1)).length).toBe(64)
})
