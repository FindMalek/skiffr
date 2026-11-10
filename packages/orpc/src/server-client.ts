import { createORPCClientUtils } from "./client"

/**
 * Client for Next server components and route handlers, straight to the api service (`API_URL`, e.g.
 * http://skiffr-api:3001 inside Dokploy). Pass `getHeaders` to forward the visitor's cookie for admin calls.
 */
export function createServerClient(getHeaders?: () => Promise<Record<string, string>>) {
  return createORPCClientUtils({
    url: () => `${process.env.API_URL ?? "http://localhost:3001"}/rpc`,
    getHeaders,
  }).client
}
