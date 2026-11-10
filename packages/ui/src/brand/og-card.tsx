export interface OgColors {
  background: string
  foreground: string
  muted: string
  border: string
  accent: string
}

export const OG_SIZE = { width: 1200, height: 630 }

/** Markup for next/og's ImageResponse: satori only takes inline styles and hex colors. */
export function OgCard({
  name,
  title,
  description,
  colors,
}: {
  name: string
  title: string
  description?: string
  colors: OgColors
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: 40,
        background: colors.background,
        color: colors.foreground,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 56,
          border: `2px solid ${colors.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 30, fontFamily: "monospace" }}>
          <div style={{ width: 22, height: 22, background: colors.accent }} />
          {name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{title}</div>
          {description ? (
            <div style={{ fontSize: 32, lineHeight: 1.35, color: colors.muted, maxWidth: 900 }}>{description}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
