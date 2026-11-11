import { GlobalRegistrator } from "@happy-dom/global-registrator"

GlobalRegistrator.register({ url: "http://localhost:3002/queue" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** Installed before any module captures `fetch`: the api client binds it on import. A test that reaches the network records the url here and fails. */
export const network: string[] = []
globalThis.fetch = (async (input: RequestInfo | URL) => {
  network.push(String(input))
  throw new TypeError("fetch is off in component tests")
}) as unknown as typeof fetch
;(globalThis as { __network?: string[] }).__network = network
