import { z } from "zod"

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

export const extensionSettingsSchema = z.object({
  apiUrl: z
    .url({ protocol: /^https?$/ })
    .trim()
    .transform((url) => url.replace(/\/+$/, ""))
    .refine((url) => {
      const { protocol, hostname } = new URL(url)
      return protocol === "https:" || LOCAL_HOSTS.has(hostname)
    }, "http is only allowed for localhost"),
  token: z.string().trim(),
})

export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>
