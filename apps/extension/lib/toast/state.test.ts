import { expect, test } from "bun:test"
import { INITIAL_TOAST_STATE, reduceToast, type ToastEffect, type ToastEvent, type ToastState } from "./state"

function run(events: ToastEvent[], from: ToastState = INITIAL_TOAST_STATE) {
  const effects: ToastEffect[] = []
  let state = from
  for (const event of events) {
    const step = reduceToast(state, event)
    state = step.state
    effects.push(...step.effects)
  }
  return { state, effects }
}

test("shows once however many times a form is detected", () => {
  expect(run(["detected", "detected"]).effects).toEqual(["show"])
})

test("yes hides the toast and fills", () => {
  expect(run(["detected", "yes"]).effects).toEqual(["show", "hide", "fill"])
})

test("no keeps it closed until navigation", () => {
  expect(run(["detected", "no", "detected"]).effects).toEqual(["show", "hide"])
  expect(run(["detected", "no", "navigated", "detected"]).effects).toEqual(["show", "hide", "show"])
})

test("an auto dismiss behaves like no", () => {
  expect(run(["detected", "timeout", "detected"]).effects).toEqual(["show", "hide"])
})

test("never asks stores the site once and stays blocked after navigation", () => {
  const { state, effects } = run(["detected", "never", "navigated", "detected"])
  expect(effects).toEqual(["show", "hide", "neverAsk"])
  expect(state.blocked).toBe(true)
})

test("a blocked site never shows and a late block hides a shown toast", () => {
  expect(run(["blocked", "detected"]).effects).toEqual([])
  expect(run(["detected", "blocked"]).effects).toEqual(["show", "hide"])
})

test("navigating away hides a shown toast", () => {
  expect(run(["detected", "navigated"]).effects).toEqual(["show", "hide"])
})

test("the fill command closes a shown toast without filling twice", () => {
  expect(run(["detected", "filled"]).effects).toEqual(["show", "hide"])
  expect(run(["filled"]).effects).toEqual([])
})
