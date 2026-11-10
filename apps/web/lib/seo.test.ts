import { afterEach, expect, test } from "bun:test"
import { isIndexable } from "./seo"

const before = { ...process.env }
afterEach(() => {
  process.env = { ...before }
})

test("only a real, non preview origin is indexable", () => {
  process.env.WEB_URL = "https://skiffr.com/"
  process.env.DEPLOY_ENV = "production"
  expect(isIndexable()).toBe(true)

  process.env.DEPLOY_ENV = "pr-12"
  expect(isIndexable()).toBe(false)

  process.env.DEPLOY_ENV = "production"
  process.env.WEB_URL = "http://localhost:3000"
  expect(isIndexable()).toBe(false)
})
