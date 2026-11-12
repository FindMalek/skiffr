import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createServer as createSecureServer } from "node:https"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

const PAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "pages")
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
}
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
  /** Same pages over https with a throwaway certificate: some board hosts are preloaded as https only, so a page on one cannot be served over http. */
  secureOrigin: string
  /** Every request to /submit. The extension must never submit a form, so tests assert this stays empty. */
  submissions: Submission[]
  stop: () => Promise<void>
}

interface State {
  altOrigin: string
  submissions: Submission[]
}

function decodePath(urlPath: string): string | null {
  try {
    return decodeURIComponent(urlPath)
  } catch {
    return null
  }
}

function resolvePage(decodedPath: string): string | null {
  const relative = normalize(decodedPath).replace(/^[/\\]+/, "")
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
  const decoded = decodePath(url.pathname)
  if (decoded === null) {
    res.writeHead(400).end("bad request")
    return
  }
  const file = resolvePage(decoded)
  if (!file || !TYPES[extname(file)]) {
    res.writeHead(404).end("not found")
    return
  }
  try {
    const html = (await readFile(file, "utf8")).replaceAll(ALT_ORIGIN_TOKEN, state.altOrigin)
    res.writeHead(200, { "content-type": TYPES[extname(file)] as string }).end(html)
  } catch {
    res.writeHead(404).end("not found")
  }
}

/** Needs only the `openssl` binary: no prompt, no home directory, every file in a temp dir that is removed again. */
export function throwawayCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "skiffr-e2e-cert-"))
  try {
    const keyFile = join(dir, "key.pem")
    const certFile = join(dir, "cert.pem")
    const args = ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1"]
    args.push("-subj", "/CN=localhost", "-keyout", keyFile, "-out", certFile)
    const run = spawnSync("openssl", args, { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000, encoding: "utf8" })
    if (run.status !== 0) throw new Error(`openssl could not make the fixture certificate: ${run.error ?? run.stderr}`)
    return { key: readFileSync(keyFile, "utf8"), cert: readFileSync(certFile, "utf8") }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const state: State = { altOrigin: "", submissions: [] }
  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res, state).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end("server error")
    })
  }
  const server: Server = createServer(onRequest)
  const secure: Server = createSecureServer(throwawayCertificate(), onRequest)
  await Promise.all([server, secure].map((one) => new Promise<void>((resolve) => one.listen(0, "127.0.0.1", resolve))))
  const { port } = server.address() as AddressInfo
  const { port: securePort } = secure.address() as AddressInfo
  state.altOrigin = `http://localhost:${port}`
  const close = (one: Server) =>
    new Promise<void>((resolve, reject) => one.close((error) => (error ? reject(error) : resolve())))
  return {
    origin: `http://127.0.0.1:${port}`,
    altOrigin: state.altOrigin,
    secureOrigin: `https://127.0.0.1:${securePort}`,
    submissions: state.submissions,
    stop: async () => {
      await Promise.all([close(server), close(secure)])
    },
  }
}
