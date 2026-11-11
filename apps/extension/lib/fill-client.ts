import { siteKey } from "./detect/ats"
import type { CollectedField } from "./fill"
import { ROUND_TRIP_TIMEOUT_MS } from "./fill-config"
import { FillRequestError, type MappingProvider } from "./fill-handler"
import { type FillField, type FillRequestMessage, fillResponseSchema } from "./messages"

export type SendToWorker = (message: FillRequestMessage) => Promise<unknown>

function toFillField({ descriptor, info }: CollectedField): FillField {
  const autocomplete = info.autocomplete?.trim().slice(0, 100)
  return {
    id: descriptor.id,
    label: descriptor.label,
    name: descriptor.name,
    ariaLabel: descriptor.ariaLabel,
    placeholder: descriptor.placeholder,
    type: descriptor.type,
    ...(autocomplete ? { autocomplete } : {}),
    options: descriptor.options,
  }
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FillRequestError("timeout")), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * The content script's mapping source: asks the worker, which owns the token and the api. Only the fields' text leaves
 * the frame, never a value typed on the page, and never anything for a url that has no site key.
 */
export function createWorkerProvider(
  send: SendToWorker,
  url: () => string = () => location.href,
  timeoutMs = ROUND_TRIP_TIMEOUT_MS,
): MappingProvider {
  return async (fields) => {
    const site = siteKey(url())
    if (!site) throw new FillRequestError("invalid")
    const reply = await within(
      send({ type: "fill-request", siteKey: site, fields: fields.map(toFillField) }).catch(() => {
        throw new FillRequestError("failed")
      }),
      timeoutMs,
    )
    const parsed = fillResponseSchema.safeParse(reply)
    if (!parsed.success) throw new FillRequestError("failed")
    if (!parsed.data.ok) throw new FillRequestError(parsed.data.code)
    const { mapping, values, suggestions, summary } = parsed.data
    return { mapping, values, suggestions, problem: summary.problem }
  }
}
