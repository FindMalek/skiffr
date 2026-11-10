import { ORPCError } from "@orpc/client"

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "UNAUTHORIZED"
}

/** A message that's fine to show a guest: ours for expected errors, a generic one for crashes. */
export function errorMessage(error: unknown): string {
  if (error instanceof ORPCError && (error.status < 500 || error.code === "BAD_GATEWAY")) return error.message
  return "Something went wrong. Please try again."
}
