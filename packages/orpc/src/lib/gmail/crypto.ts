import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const VERSION = "v1"

export class CryptoError extends Error {
  override name = "CryptoError"
  constructor() {
    super("A sealed value could not be opened.")
  }
}

/** The 32 byte key from `GMAIL_ENCRYPTION_KEY` (base64). */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64")
  if (key.length !== 32) throw new Error("GMAIL_ENCRYPTION_KEY must be 32 bytes, base64 encoded.")
  return key
}

/**
 * AES-256-GCM with a random 96 bit IV per value. `context` (the owner's id) is authenticated but not stored, so a sealed
 * value copied onto another user's row does not open. Output: `v1.<iv>.<tag>.<ciphertext>`, base64url.
 */
export function seal(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(Buffer.from(context))
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".")
}

export function open(key: Buffer, sealed: string, context: string): string {
  const [version, iv, tag, body, ...rest] = sealed.split(".")
  if (version !== VERSION || !iv || !tag || body === undefined || rest.length > 0) throw new CryptoError()
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"))
    decipher.setAAD(Buffer.from(context))
    decipher.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")
  } catch {
    throw new CryptoError()
  }
}

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex")

/** Signs `value`; the key is derived for this purpose, so it is never the one that seals tokens. */
export function sign(key: Buffer, value: string): string {
  return createHmac("sha256", createHmac("sha256", key).update("skiffr gmail state").digest())
    .update(value)
    .digest("base64url")
}

export function verifySignature(key: Buffer, value: string, signature: string): boolean {
  const expected = Buffer.from(sign(key, value))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
