import { expect, test } from "bun:test"
import { checkForm, describeFailure } from "./auth-copy"

test("a failed attempt reads from the code and status, never from the server text", () => {
  expect(describeFailure("reset", { status: 400, code: "INVALID_TOKEN" })).toEqual({
    message: "This reset link has expired or was already used. Ask for a new one.",
  })
  expect(describeFailure("reset", { status: 400, code: "RESET_PASSWORD_DISABLED" }).message).toBe(
    "Password reset isn't set up on this server.",
  )
  expect(describeFailure("sign-up", { status: 422, code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }).message).toBe(
    "We couldn't create that account. If you already have one, sign in instead.",
  )
  expect(describeFailure("sign-in", { status: 0 }).message).toBe(
    "Can't reach the server. Check your connection and try again.",
  )
  expect(describeFailure("sign-in", { status: 500 }).message).toBe(
    "Something went wrong on our side. Try again in a moment.",
  )
  expect(describeFailure("sign-up", { status: 400, code: "NAME_TOO_LONG" }).field).toBe("name")
  expect(describeFailure("sign-in", { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" })).toMatchObject({
    field: "password",
  })
})

test("sign up checks the name length and the password rule, sign in only that a password is there", () => {
  expect(checkForm("sign-up", { name: "n".repeat(101), email: "a@b.dev", password: "short" })).toEqual({
    name: "Use at most 100 characters.",
    password: "Use at least 10 characters.",
  })
  expect(checkForm("sign-in", { email: "a@b.dev", password: "short" })).toEqual({})
})
