import { z } from "zod"

export const fillMessageSchema = z.strictObject({ type: z.literal("fill"), skipTop: z.boolean().optional() })
export const formDetectedMessageSchema = z.strictObject({ type: z.literal("form-detected") })
export const frameNavigatedMessageSchema = z.strictObject({ type: z.literal("frame-navigated") })
export const probeFramesMessageSchema = z.strictObject({ type: z.literal("probe-frames") })
export const fillFramesMessageSchema = z.strictObject({ type: z.literal("fill-frames") })
export const siteDisabledMessageSchema = z.strictObject({ type: z.literal("site-disabled") })
export const disableSiteMessageSchema = z.strictObject({ type: z.literal("disable-site") })
export const testConnectionMessageSchema = z.strictObject({ type: z.literal("test-connection") })
export const siteDisabledResponseSchema = z.strictObject({ disabled: z.boolean() })

export type FillMessage = z.infer<typeof fillMessageSchema>
export type FormDetectedMessage = z.infer<typeof formDetectedMessageSchema>
export type FrameNavigatedMessage = z.infer<typeof frameNavigatedMessageSchema>
export type ProbeFramesMessage = z.infer<typeof probeFramesMessageSchema>
export type FillFramesMessage = z.infer<typeof fillFramesMessageSchema>
export type SiteDisabledMessage = z.infer<typeof siteDisabledMessageSchema>
export type DisableSiteMessage = z.infer<typeof disableSiteMessageSchema>
export type TestConnectionMessage = z.infer<typeof testConnectionMessageSchema>
export type SiteDisabledResponse = z.infer<typeof siteDisabledResponseSchema>

function guard<T>(schema: z.ZodType<T>): (value: unknown) => value is T {
  return (value): value is T => schema.safeParse(value).success
}

export const isFillMessage = guard(fillMessageSchema)
export const isFormDetectedMessage = guard(formDetectedMessageSchema)
export const isFrameNavigatedMessage = guard(frameNavigatedMessageSchema)
export const isProbeFramesMessage = guard(probeFramesMessageSchema)
export const isFillFramesMessage = guard(fillFramesMessageSchema)
export const isSiteDisabledMessage = guard(siteDisabledMessageSchema)
export const isDisableSiteMessage = guard(disableSiteMessageSchema)
export const isTestConnectionMessage = guard(testConnectionMessageSchema)
