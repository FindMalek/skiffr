import { z } from "zod"

export const extensionSettingsSchema = z.object({
  apiUrl: z
    .url({ protocol: /^https?$/ })
    .trim()
    .transform((url) => url.replace(/\/+$/, "")),
  token: z.string().trim(),
})

export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>
