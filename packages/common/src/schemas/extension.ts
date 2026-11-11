import { z } from "zod"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export const extensionSettingsSchema = z.object({
  apiUrl: z
    .url({ protocol: /^https?$/ })
    .trim()
    .transform((url) => url.replace(/\/+$/, ""))
    .refine((url) => {
      const { protocol, hostname, username, password } = new URL(url)
      // fetch refuses a url with credentials in it, so the connection test would only say "unreachable".
      return !username && !password && (protocol === "https:" || LOCAL_HOSTS.has(hostname))
    }, "https only (http works for localhost), without a user or password in the url"),
  token: z.string().trim(),
})

export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>
