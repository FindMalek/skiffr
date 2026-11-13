import { formatClient } from "@skiffr/common/utils"
import { browser } from "wxt/browser"

/** The browser this build targets (`chrome`, `firefox`, `edge`), set by wxt at build time. */
const BROWSER = String(import.meta.env?.BROWSER ?? "").replace(/[^a-z]/g, "")

/** The manifest version, `0.0.0` where there is no extension runtime (unit tests). */
function manifestVersion(): string {
  try {
    return browser.runtime.getManifest().version
  } catch {
    return "0.0.0"
  }
}

/** What the api may know about this extension: its name with the browser family, and its version. Nothing about the user, the pages or the forms. */
export const CLIENT_INFO = {
  client: BROWSER ? `extension-${BROWSER}` : "extension",
  clientVersion: manifestVersion(),
}

export const CLIENT_HEADER_VALUE = formatClient(CLIENT_INFO)
