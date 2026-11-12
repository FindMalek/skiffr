import { expect, test } from "bun:test"
import { createHeartbeat, HEARTBEAT_INTERVAL_MS } from "./heartbeat"

function setup(token = "skp_abc") {
  const stored: Record<string, unknown> = {}
  const calls: number[] = []
  let time = 1_000_000
  let fail = false
  const beat = createHeartbeat({
    settings: async () => ({ apiUrl: "http://localhost:3001", token }),
    call: async (run) => {
      calls.push(time)
      if (fail) throw new Error("offline")
      return run({ extension: { whoami: async () => ({}) } } as never)
    },
    area: {
      get: async (key) => ({ [key]: stored[key] }),
      set: async (items) => void Object.assign(stored, items),
    },
    now: () => time,
  })
  const advance = (ms: number) => {
    time += ms
  }
  const failing = (on: boolean) => {
    fail = on
  }
  return { beat, calls, advance, failing }
}

test("a beat is sent at most once per interval and never without a token", async () => {
  const { beat, calls, advance } = setup()
  await Promise.all([beat(), beat()])
  await beat()
  expect(calls).toHaveLength(1)
  advance(HEARTBEAT_INTERVAL_MS - 1)
  await beat()
  expect(calls).toHaveLength(1)
  advance(1)
  await beat()
  expect(calls).toHaveLength(2)

  const anonymous = setup("")
  await anonymous.beat()
  expect(anonymous.calls).toHaveLength(0)
})

test("a failing api never throws out of a beat and is not retried before the interval", async () => {
  const { beat, calls, failing } = setup()
  failing(true)
  await expect(beat()).resolves.toBeUndefined()
  await beat()
  expect(calls).toHaveLength(1)
})
