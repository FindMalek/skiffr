export interface Captured {
  method: string
  path: string
  headers: Headers
  body: string
}

/** A local server that records what it is sent: GlitchTip, OpenObserve and Umami are all one POST away. */
export function mockCollector(status = 200) {
  const requests: Captured[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: request.headers,
        body: await request.text(),
      })
      return new Response("{}", { status })
    },
  })
  return {
    url: `http://localhost:${server.port}`,
    requests,
    everything: () => requests.map((request) => request.body).join("\n"),
    stop: () => server.stop(true),
  }
}
