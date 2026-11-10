export type FillMessage = { type: "fill" }

export function isFillMessage(value: unknown): value is FillMessage {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "fill"
}
