import { isBoardHost } from "@skiffr/common/utils"
import type { Provider } from "./senders"

const ZIPRECRUITER = /(?:^|\.)ziprecruiter\.com$/

/** Link hosts a known board's own emails may point at. The board domains come from the shared canonical helper; ZipRecruiter has no vendor id there. */
export const BOARD_HOST: Record<Exclude<Provider, "other">, (host: string) => boolean> = {
  linkedin: (host) => isBoardHost("linkedin", host),
  indeed: (host) => isBoardHost("indeed", host),
  glassdoor: (host) => isBoardHost("glassdoor", host),
  wellfound: (host) => isBoardHost("wellfound", host),
  ziprecruiter: (host) => ZIPRECRUITER.test(host),
}
