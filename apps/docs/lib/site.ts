/** What the docs say about the project, in one place. */
export const SITE = {
  name: "skiffr",
  /** Public origin, no trailing slash. Set DOCS_URL when deployed. */
  url: (process.env.DOCS_URL ?? "http://localhost:3003").replace(/\/$/, ""),
  tagline: "Open-source job application autofill that learns from every form you fix.",
  github: "https://github.com/FindMalek/skiffr",
  /** Colors of the social card (opengraph-image), filled from the preset. Any hex works. */
  og: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    muted: "#a3a3a3",
    border: "#262626",
    accent: "#e5e5e5",
  },
}
