export type FillMessage = { type: "fill"; skipTop?: boolean }
export type FormDetectedMessage = { type: "form-detected" }
export type ProbeFramesMessage = { type: "probe-frames" }
export type ReportFormMessage = { type: "report-form" }
export type FillFramesMessage = { type: "fill-frames" }
export type SiteDisabledMessage = { type: "site-disabled" }
export type DisableSiteMessage = { type: "disable-site" }

export type SiteDisabledResponse = { disabled: boolean }

function hasType(value: unknown, type: string): boolean {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === type
}

export function isFillMessage(value: unknown): value is FillMessage {
  return hasType(value, "fill")
}

export function isFormDetectedMessage(value: unknown): value is FormDetectedMessage {
  return hasType(value, "form-detected")
}

export function isProbeFramesMessage(value: unknown): value is ProbeFramesMessage {
  return hasType(value, "probe-frames")
}

export function isReportFormMessage(value: unknown): value is ReportFormMessage {
  return hasType(value, "report-form")
}

export function isFillFramesMessage(value: unknown): value is FillFramesMessage {
  return hasType(value, "fill-frames")
}

export function isSiteDisabledMessage(value: unknown): value is SiteDisabledMessage {
  return hasType(value, "site-disabled")
}

export function isDisableSiteMessage(value: unknown): value is DisableSiteMessage {
  return hasType(value, "disable-site")
}
