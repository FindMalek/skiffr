import { formatClient } from "@skiffr/common/utils"
import pkg from "../package.json"

/** The browser this build targets (`chrome`, `firefox`, `edge`), set by wxt at build time. */
const BROWSER = String(import.meta.env?.BROWSER ?? "").replace(/[^a-z]/g, "")

/** What the api may know about this extension: its name with the browser family, and its version. Nothing about the user, the pages or the forms. */
export const CLIENT_INFO = {
  client: BROWSER ? `extension-${BROWSER}` : "extension",
  clientVersion: pkg.version,
}

export const CLIENT_HEADER_VALUE = formatClient(CLIENT_INFO)
