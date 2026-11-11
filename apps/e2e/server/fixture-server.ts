import { readFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const PAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pages")
const ALT_ORIGIN_TOKEN = "__ALT_ORIGIN__"

export interface Submission {
  method: string
  url: string
}

export interface FixtureServer {
  /** Pages are served over http: content scripts do not run on file:// without a per-extension opt-in. */
  origin: string
  /** Same server on another hostname, so an iframe can be cross-origin. */
  altOrigin: string
  /** Every request to /submit. The extension must never submit a form, so tests assert this stays empty. */
  submissions: Submission[]
  stop: () => Promise<void>
}

interface State {
  altOrigin: string
  submissions: Submission[]
}

function resolvePage(urlPath: string): string | null {
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, "")
  if (relative.startsWith("..")) return null
  return join(PAGES_DIR, relative)
}

async function handle(req: IncomingMessage, res: ServerResponse, state: State): Promise<void> {
  const url = new URL(req.url ?? "/", "http://fixture.local")
  if (url.pathname === "/submit") {
    state.submissions.push({ method: req.method ?? "GET", url: `${url.pathname}${url.search}` })
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Submitted</title><p>Submitted</p>")
    return
  }
  const file = resolvePage(url.pathname)
  if (!file || extname(file) !== ".html") {
    res.writeHead(404).end("not found")
    return
  }
  try {
    const html = (await readFile(file, "utf8")).replaceAll(ALT_ORIGIN_TOKEN, state.altOrigin)
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html)
  } catch {
    res.writeHead(404).end("not found")
  }
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const state: State = { altOrigin: "", submissions: [] }
  const server: Server = createServer((req, res) => void handle(req, res, state))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  state.altOrigin = `http://localhost:${port}`
  return {
    origin: `http://127.0.0.1:${port}`,
    altOrigin: state.altOrigin,
    submissions: state.submissions,
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}
