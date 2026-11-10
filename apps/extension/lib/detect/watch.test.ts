import { expect, test } from "bun:test"
import { Window } from "happy-dom"
import { createFormWatcher } from "./watch"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const FORM = `<h1>Apply</h1><form><input name="full_name"><input type="email"><input type="tel"></form>`

test("detects a form injected after load once and then stops observing", async () => {
  const window = new Window({ url: "https://initech.example/careers" })
  const doc = window.document as unknown as Document
  const seen: boolean[] = []
  const watcher = createFormWatcher({ doc, debounceMs: 5, onDetect: (d) => seen.push(d.isForm) })
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
  const watcher = createFormWatcher({ doc, debounceMs: 5, budgetMs: 20, onDetect: (d) => seen.push(d.isForm) })
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
