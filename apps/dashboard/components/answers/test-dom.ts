import { Window } from "happy-dom"

/** A real DOM for tests that mount components: copies the happy-dom window's globals onto `globalThis`. */
export function installDom(url = "http://localhost:3002/answers"): Window {
  const window = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableErrorCapturing: true } })
  const target = globalThis as Record<string, unknown>
  const own = new Set(["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage"])
  for (const key of Object.getOwnPropertyNames(window)) {
    if (key in target && !own.has(key)) continue
    try {
      Object.defineProperty(target, key, {
        value: (window as unknown as Record<string, unknown>)[key],
        configurable: true,
        writable: true,
      })
    } catch {
      // read-only on this runtime: the tests do not need it
    }
  }
  target.window = window
  target.IS_REACT_ACT_ENVIRONMENT = true
  return window
}

export interface RpcCall {
  path: string
  input: unknown
}

/**
 * The orpc client keeps the `fetch` it saw when it was created, so one router is installed once, before any component
 * module loads, and each test points `rpc.handler` at its own fake api.
 */
export const rpc: { calls: RpcCall[]; handler: (call: RpcCall) => Promise<unknown> | unknown } = {
  calls: [],
  handler: () => null,
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  const path = new URL(request.url).pathname.replace("/api/rpc/", "")
  const body = (await request.json().catch(() => ({}))) as { json?: unknown }
  const call = { path, input: body.json }
  rpc.calls.push(call)
  return Response.json({ json: await rpc.handler(call) })
}) as typeof fetch
