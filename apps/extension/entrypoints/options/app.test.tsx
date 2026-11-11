import { expect, test } from "bun:test"
import { renderToString } from "react-dom/server"
import { App } from "./app"

// effects do not run on the server, so this is the page as a user sees it before storage has answered
test("the form is locked until stored settings load, so a late read cannot overwrite what was typed", () => {
  const html = renderToString(<App />)
  const controls = html.match(/<(input|button)\b[^>]*>/g) ?? []
  expect(controls.length).toBe(4)
  for (const control of controls) expect(control).toContain("disabled")
})
