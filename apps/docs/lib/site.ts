/** What the docs say about the project, in one place. */
export const SITE = {
  name: "skiffr",
  /** Public origin, no trailing slash. Set DOCS_URL when deployed. */
  url: (process.env.DOCS_URL ?? "http://localhost:3003").replace(/\/$/, ""),
  tagline: "The one-line pitch for Skiffr goes here: what it does, for whom, in plain words.",
  /** Repo url for the nav link, left empty until you have one. */
  github: "",
  /** Colors of the social card (opengraph-image), filled from the preset. Any hex works. */
  og: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    muted: "#a3a3a3",
    border: "#262626",
    accent: "#e5e5e5",
  },
}
