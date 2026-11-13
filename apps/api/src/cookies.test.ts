import { expect, test } from "bun:test"
import { cookiePolicy } from "./cookies"

const prod = (dashboardUrl: string | undefined) => cookiePolicy({ nodeEnv: "production", dashboardUrl })

test("production on https is secure, whatever the case of the scheme", () => {
  expect(prod("https://dashboard.example.com")).toEqual({ secure: true })
  expect(prod("HTTPS://Dashboard.Example.com")).toEqual({ secure: true })
})

test("production on plain http is only quiet for a loopback address", () => {
  for (const url of ["http://localhost:3002", "http://127.0.0.1:3002", "http://[::1]:3002"]) {
    expect(prod(url)).toEqual({ secure: false })
  }
  const remote = prod("http://dashboard.example.com")
  expect(remote.secure).toBe(false)
  expect(remote.warning).toContain("not Secure")
})

test("production without a dashboard url, or with junk, does not start", () => {
  expect(() => prod(undefined)).toThrow("DASHBOARD_URL is not set")
  expect(() => prod("")).toThrow("DASHBOARD_URL is not set")
  expect(() => prod("not a url")).toThrow("not a valid url")
})

test("outside production nothing is secure and nothing is required", () => {
  expect(cookiePolicy({ nodeEnv: "development", dashboardUrl: undefined })).toEqual({ secure: false })
})
