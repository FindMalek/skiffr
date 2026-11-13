import type { CSSProperties } from "react"
import type { ProfileForm } from "@/lib/profile-form"
import { completeness } from "@/lib/profile-form"

const MISSING_SHOWN = 5

/** What the extension can fill from the saved profile. The text is the value: the bar is a second cue. */
export function ProfileMeter({ saved }: { saved: ProfileForm }) {
  const { filled, total, missing } = completeness(saved)
  const labelId = "profile-meter-label"
  const text = `${filled} of ${total} fields the extension can fill`
  const shown = missing.slice(0, MISSING_SHOWN).join(", ")
  const more = missing.length - MISSING_SHOWN
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="font-medium text-sm tabular-nums">
        {text}
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot be drawn as a flat black on white bar across engines */}
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuetext={text}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={filled}
        className="h-3 max-w-md border border-border-strong forced-colors:border-[ButtonText]"
      >
        <div
          className="h-full w-(--used) bg-foreground forced-colors:forced-color-adjust-none forced-colors:bg-[Highlight]"
          style={{ "--used": `${(filled / total) * 100}%` } as CSSProperties}
        />
      </div>
      <p className="max-w-prose text-muted-foreground text-xs">
        {missing.length === 0
          ? "Every field is filled."
          : `Still empty: ${shown}${more > 0 ? ` and ${more} more` : ""}.`}
      </p>
    </div>
  )
}
