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

const IDENTIFIER = /^[a-z0-9_]{1,63}$/
const FRAMES_MAX = 10
/** Classes whose message is a fixed sentence written in this repo, so it never carries request data. */
const SAFE_MESSAGE = new Set(["AiModelError", "AiInputError", "TokenStoreError", "LearningStoreError"])

/** The constraint and table of a postgres error (names, not values), found anywhere in its cause chain. */
function schemaNames(error: unknown): { constraint?: string; table?: string } {
  const found: { constraint?: string; table?: string } = {}
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const fields = current as Record<string, unknown>
    for (const [key, names] of [
      ["constraint", ["constraint_name", "constraint"]],
      ["table", ["table_name", "table"]],
    ] as const) {
      const value = names.map((name) => fields[name]).find((candidate) => typeof candidate === "string")
      if (!found[key] && typeof value === "string" && IDENTIFIER.test(value)) found[key] = value
    }
    current = fields.cause
  }
  return found
}

/** Only the `at ...` lines: the first line of a stack is the message. The message is cut out first, so a message that holds fake frames adds none. */
function stackFrames(error: unknown): string[] | undefined {
  if (!(error instanceof Error) || typeof error.stack !== "string") return undefined
  const stack = error.message ? error.stack.split(error.message).join("") : error.stack
  const frames = stack
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .slice(0, FRAMES_MAX)
    .map((line) => line.trim().slice(0, 200))
  return frames.length > 0 ? frames : undefined
}

/**
 * What a log line may say about an unexpected error: never params, detail, query or cause objects, which hold whatever
 * the request carried. The message is kept only for the classes written here. Errors that already carry a `causeName`
 * (the store errors) keep it.
 */
export function safeErrorFields(error: unknown): {
  name: string
  code?: string
  causeName?: string
  status?: number
  constraint?: string
  table?: string
  message?: string
  frames?: string[]
} {
  const { code, causeName } = describeError(error)
  const named = (error as { name?: unknown; causeName?: unknown; status?: unknown; statusCode?: unknown } | null) ?? {}
  const name = typeof named.name === "string" && CLASS_NAME.test(named.name) ? named.name : "Error"
  const carried = typeof named.causeName === "string" && CLASS_NAME.test(named.causeName) ? named.causeName : undefined
  const status = [named.status, named.statusCode].find((value): value is number => typeof value === "number")
  const message = error instanceof Error && SAFE_MESSAGE.has(name) ? error.message : undefined
  return {
    name,
    code,
    causeName: carried ?? causeName,
    status,
    ...schemaNames(error),
    message,
    frames: stackFrames(error),
  }
}
