import { ORPCError } from "@orpc/client"

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "UNAUTHORIZED"
}

/** A failed input validation says "Input validation failed" and keeps the schema's own message in `data.issues`. */
function validationMessage(error: ORPCError<string, unknown>): string | undefined {
  if (error.code !== "BAD_REQUEST") return undefined
  const issues = (error.data as { issues?: Array<{ message?: unknown }> } | undefined)?.issues
  const first = issues?.[0]?.message
  return typeof first === "string" && first ? first : undefined
}

/** A message that's fine to show a guest: ours for expected errors, a generic one for crashes. */
export function errorMessage(error: unknown): string {
  if (error instanceof ORPCError) {
    const issue = validationMessage(error)
    if (issue) return issue
  }
  if (error instanceof ORPCError && (error.status < 500 || error.code === "BAD_GATEWAY")) return error.message
  return "Something went wrong. Please try again."
}

/** The `ORPCError` code (`CONFLICT`, `NOT_FOUND`, ...) of a failed call, if it has one. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof ORPCError ? error.code : undefined
}
