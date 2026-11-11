import { expect, test } from "bun:test"
import { Window } from "happy-dom"
import { detectApplicationForm } from "./score"
import { createFormWatcher } from "./watch"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const FORM = `<h1>Apply</h1><form><input name="full_name"><input type="email"><input type="tel"></form>`

test("detects a form injected after load once and then stops observing", async () => {
  const window = new Window({ url: "https://initech.example/careers" })
  const doc = window.document as unknown as Document
  const seen: boolean[] = []
  const watcher = createFormWatcher({ doc, throttleMs: 5, onDetect: (d) => seen.push(d.isForm) })
  watcher.start()
  expect(seen).toEqual([])

  doc.body.innerHTML = FORM
  await wait(30)
  doc.body.insertAdjacentHTML("beforeend", "<p>more</p>")
  await wait(30)
  expect(seen).toEqual([true])
})

test("gives up after the time budget", async () => {
  const window = new Window({ url: "https://initech.example/careers" })
  const doc = window.document as unknown as Document
  const seen: boolean[] = []
  const watcher = createFormWatcher({ doc, throttleMs: 5, budgetMs: 20, onDetect: (d) => seen.push(d.isForm) })
  watcher.start()
  await wait(40)
  doc.body.innerHTML = FORM
  await wait(30)
  expect(seen).toEqual([])

  watcher.rearm()
  doc.body.insertAdjacentHTML("beforeend", "<p>late</p>")
  await wait(30)
  expect(seen).toEqual([true])
})

test("a page that mutates every few ms still gets checked and finds a late form", async () => {
  const window = new Window({ url: "https://initech.example/careers" })
  const doc = window.document as unknown as Document
  const runs: number[] = []
  const seen: boolean[] = []
  const check = (target: Document) => {
    runs.push(Date.now())
    return detectApplicationForm(target)
  }
  const watcher = createFormWatcher({ doc, throttleMs: 40, check, onDetect: (d) => seen.push(d.isForm) })
  watcher.start()
  doc.body.innerHTML = '<div id="ticker"></div>'
  const ticker = setInterval(() => {
    const el = doc.getElementById("ticker")
    if (el) el.textContent = `tick ${Date.now()}`
  }, 5)
  await wait(150)
  doc.body.insertAdjacentHTML("beforeend", FORM)
  await wait(120)
  clearInterval(ticker)
  watcher.stop()
  expect(seen).toEqual([true])
  expect(runs.length).toBeGreaterThan(3)
})

test("keeps watching after the page replaces its html element", async () => {
  const window = new Window({ url: "https://initech.example/careers" })
  const doc = window.document as unknown as Document
  const seen: boolean[] = []
  const watcher = createFormWatcher({ doc, throttleMs: 5, onDetect: (d) => seen.push(d.isForm) })
  watcher.start()

  const next = doc.createElement("html")
  next.innerHTML = `<head></head><body><div id="slot"></div></body>`
  doc.documentElement.remove()
  doc.append(next)
  await wait(20)
  doc.getElementById("slot")?.insertAdjacentHTML("beforeend", FORM)
  await wait(30)
  expect(seen).toEqual([true])
})

test("a hidden form revealed by a click is found after the watcher was re-armed", async () => {
  const window = new Window({ url: "https://careers.initech.example/designer" })
  const doc = window.document as unknown as Document
  doc.body.innerHTML = `<h1>Apply</h1><div id="p" hidden>${FORM}</div>`
  const seen: boolean[] = []
  const watcher = createFormWatcher({ doc, throttleMs: 5, budgetMs: 10, onDetect: (d) => seen.push(d.isForm) })
  watcher.start()
  await wait(30)
  watcher.rearm()
  doc.getElementById("p")?.removeAttribute("hidden")
  await wait(30)
  expect(seen).toEqual([true])
})

test("re-checks without any mutation, for frames that looked hidden while still being laid out", async () => {
  const window = new Window({ url: "https://initech.example/careers" })
  const doc = window.document as unknown as Document
  let calls = 0
  const seen: boolean[] = []
  const check = () => ({ isForm: ++calls > 1, ats: null, confidence: 1, reasons: [] })
  const watcher = createFormWatcher({
    doc,
    throttleMs: 5,
    recheckMs: [10],
    check,
    onDetect: (d) => seen.push(d.isForm),
  })
  watcher.start()
  expect(seen).toEqual([])
  await wait(60)
  expect(seen).toEqual([true])
})
