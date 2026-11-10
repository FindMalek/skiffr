/** What the dashboard says about itself in titles and link previews. */
export const SITE = {
  name: "skiffr",
  tagline: "The one-line pitch for Skiffr goes here: what it does, for whom, in plain words.",
  /** Colors of the social card (opengraph-image), filled from the preset. Any hex works. */
  og: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    muted: "#a3a3a3",
    border: "#262626",
    accent: "#e5e5e5",
  },
}

/** The dashboard origin, read per request so one build serves every environment. */
export function dashboardUrl(): string {
  return (process.env.DASHBOARD_URL ?? "http://localhost:3002").replace(/\/$/, "")
}
