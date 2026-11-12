export const API_KEYS: string[]
export const UMAMI_WEBSITE_KEYS: Record<"api" | "web" | "dashboard" | "docs", string>
export const GLITCHTIP_DSN_KEYS: Record<"web" | "dashboard", string>
export const OPTIONAL_KEYS: string[]
export function envForApp(
  key: "api" | "web" | "dashboard" | "docs",
  extras: Record<string, string>,
): Record<string, string>
