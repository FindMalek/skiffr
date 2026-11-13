export const VARIANTS = ["renamed-ids", "moved-fields", "new-required-field"] as const
export type Variant = (typeof VARIANTS)[number]

export interface Switches {
  /** Milliseconds added to every timer that stands in for a network answer. */
  latency: number
  cookie: boolean
  layout: "a" | "b"
  variant: Variant | null
  /** Tags the submissions of one test run, so parallel runs do not read each other's. */
  run: string
  wall: boolean
}

const MAX_LATENCY = 10_000

export function isVariant(value: string | null | undefined): value is Variant {
  return (VARIANTS as readonly string[]).includes(value ?? "")
}

/** `variant=none` turns off a variant the admin page switched on. */
export function readSwitches(params: URLSearchParams, adminVariant: Variant | null = null): Switches {
  const latency = Number(params.get("latency") ?? 0)
  const asked = params.get("variant")
  return {
    latency: Number.isFinite(latency) ? Math.min(Math.max(Math.trunc(latency), 0), MAX_LATENCY) : 0,
    cookie: params.get("cookie") === "1",
    layout: params.get("layout") === "b" ? "b" : "a",
    variant: isVariant(asked) ? asked : asked === "none" ? null : adminVariant,
    run: (params.get("run") ?? "").replace(/[^\w-]/g, "").slice(0, 40),
    wall: params.get("wall") === "1",
  }
}

export class VariantState {
  #byPage = new Map<string, Variant>()

  get(site: string): Variant | null {
    return this.#byPage.get(site) ?? null
  }

  set(site: string, variant: Variant | null): void {
    if (variant) this.#byPage.set(site, variant)
    else this.#byPage.delete(site)
  }

  all(): Record<string, Variant> {
    return Object.fromEntries(this.#byPage)
  }

  reset(): void {
    this.#byPage.clear()
  }
}
