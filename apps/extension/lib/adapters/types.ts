import type { AtsId } from "../detect/ats"
import type { CollectedField, FieldKind, FillResult } from "../fill/types"

/**
 * What one board adds to the generic engine. Every hook is optional and may return nothing: the engine then does what
 * it does on any site. A hook that throws counts as returning nothing. Hooks only read the control they are given and
 * the field around it, and never submit, upload or touch a password or hidden input.
 */
export type Adapter = {
  id: AtsId
  /** The application's own form, for the page's noise filter. */
  scope?: (doc: Document) => Element | null
  /** A control that is never read or filled: demographic sections, and what only the person should agree to. */
  skip?: (el: HTMLElement) => boolean
  /** The question the page asks, where the generic derivation picks up helper text or a missing label. */
  fieldLabel?: (el: HTMLElement) => string | undefined
  /** A widget the generic collector does not see as a field (a row of Yes and No buttons). */
  fieldKind?: (el: HTMLElement) => FieldKind | undefined
  /** The options of such a widget. */
  fieldChoices?: (el: HTMLElement) => HTMLElement[] | undefined
  /** What such a widget shows now. */
  readValue?: (el: HTMLElement) => string | undefined
  /** Sets a widget the generic setters cannot drive. Nothing back means the generic path runs. */
  fill?: (field: CollectedField, value: string) => Promise<FillResult | undefined>
}
