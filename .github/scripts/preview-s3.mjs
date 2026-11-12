import { createHash, createHmac } from "node:crypto"
import { isDry } from "./preview-api.mjs"

const hex = (data) => createHash("sha256").update(data).digest("hex")
const hmac = (key, data) => createHmac("sha256", key).update(data).digest()
const encode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** AWS Signature V4 for the S3 api, enough for bucket and object calls on Garage. Returns the headers to send. */
export function signRequest({
  method,
  url,
  headers = {},
  body = "",
  accessKeyId,
  secretAccessKey,
  region,
  now = new Date(),
}) {
  const u = new URL(url)
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const day = amzDate.slice(0, 8)
  const payloadHash = hex(body)
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) }
  all.host = u.host
  all["x-amz-content-sha256"] = payloadHash
  all["x-amz-date"] = amzDate
  const names = Object.keys(all).sort()
  const query = [...u.searchParams]
    .map(([k, v]) => [encode(k), encode(v)])
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  const canonical = [
    method,
    u.pathname,
    query,
    names.map((n) => `${n}:${String(all[n]).trim()}\n`).join(""),
    names.join(";"),
    payloadHash,
  ].join("\n")
  const scope = `${day}/${region}/s3/aws4_request`
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hex(canonical)].join("\n")
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request")
  const signature = createHmac("sha256", key).update(toSign).digest("hex")
  const { host: _host, ...send } = all
  return {
    ...send,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  }
}

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
const tags = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, "g"))].map((m) => unescapeXml(m[1]))

/**
 * Per-preview buckets through the S3 api itself, so the runner needs no access to Garage's admin port: one key that
 * is allowed to create buckets (`garage key allow --create-bucket`) owns every bucket it creates and can delete them.
 */
export function s3Client({ endpoint, region = "garage", accessKeyId, secretAccessKey }) {
  const base = String(endpoint).replace(/\/+$/, "")
  async function request(method, path, { query = "", okStatuses = [] } = {}) {
    if (method !== "GET" && method !== "HEAD" && isDry()) {
      console.info(`[dry-run] s3 ${method} ${path}`)
      return { status: 200, text: "" }
    }
    const url = `${base}${path}${query ? `?${query}` : ""}`
    const headers = signRequest({ method, url, accessKeyId, secretAccessKey, region })
    const res = await fetch(url, { method, headers })
    const text = await res.text()
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new Error(`s3 ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`)
    }
    return { status: res.status, text }
  }

  const listKeys = async (bucket) => {
    const keys = []
    let token
    do {
      const q = new URLSearchParams({ "list-type": "2", ...(token ? { "continuation-token": token } : {}) })
      const { text } = await request("GET", `/${bucket}`, { query: q.toString() })
      keys.push(...tags(text, "Key"))
      token = tags(text, "IsTruncated")[0] === "true" ? tags(text, "NextContinuationToken")[0] : undefined
    } while (token)
    return keys
  }

  return {
    async createBucket(bucket) {
      const { status } = await request("PUT", `/${bucket}`, { okStatuses: [409] })
      if (status === 409) await request("HEAD", `/${bucket}`)
    },
    async listBuckets() {
      const { text } = await request("GET", "/")
      return tags(text, "Name")
    },
    /** Returns how many objects went. A bucket that is already gone is not an error. */
    async deleteBucket(bucket) {
      let removed = 0
      const probe = await request("HEAD", `/${bucket}`, { okStatuses: [404] })
      if (probe.status === 404) return removed
      for (const key of await listKeys(bucket)) {
        await request("DELETE", `/${bucket}/${key.split("/").map(encode).join("/")}`)
        removed++
      }
      await request("DELETE", `/${bucket}`, { okStatuses: [404] })
      return removed
    },
  }
}

export function s3FromEnv(env) {
  if (!env.S3_ENDPOINT || !env.PREVIEW_S3_ACCESS_KEY_ID || !env.PREVIEW_S3_SECRET_ACCESS_KEY) return null
  const config = {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || "garage",
    accessKeyId: env.PREVIEW_S3_ACCESS_KEY_ID,
    secretAccessKey: env.PREVIEW_S3_SECRET_ACCESS_KEY,
  }
  return { client: s3Client(config), config }
}
