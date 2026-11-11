const ERROR_CODE = /^[A-Z0-9_]{3,40}$/
const CLASS_NAME = /^[A-Za-z0-9_]{1,40}$/

/** The postgres or socket code (`22021`, `ECONNREFUSED`) and the class of the innermost error: the only things of a driver error that are safe to log. */
export function describeError(error: unknown): { code?: string; causeName?: string } {
  let code: string | undefined
  let innermost: unknown = error
  for (let depth = 0; depth < 4 && innermost && typeof innermost === "object"; depth++) {
    const candidate = (innermost as { code?: unknown }).code
    if (code === undefined && typeof candidate === "string" && ERROR_CODE.test(candidate)) code = candidate
    const next = (innermost as { cause?: unknown }).cause
    if (!next || typeof next !== "object") break
    innermost = next
  }
  const name = (innermost as { constructor?: { name?: unknown } } | null)?.constructor?.name
  return { code, causeName: typeof name === "string" && CLASS_NAME.test(name) ? name : undefined }
}

/**
 * What a log line may say about an unexpected error: never its message, statement, params, stack or cause objects, which
 * hold whatever the request carried. Errors that already carry a `causeName` (the store errors) keep it.
 */
export function safeErrorFields(error: unknown): {
  name: string
  code?: string
  causeName?: string
  status?: number
} {
  const { code, causeName } = describeError(error)
  const named = (error as { name?: unknown; causeName?: unknown; status?: unknown; statusCode?: unknown } | null) ?? {}
  const name = typeof named.name === "string" && CLASS_NAME.test(named.name) ? named.name : "Error"
  const carried = typeof named.causeName === "string" && CLASS_NAME.test(named.causeName) ? named.causeName : undefined
  const status = [named.status, named.statusCode].find((value): value is number => typeof value === "number")
  return { name, code, causeName: carried ?? causeName, status }
}
