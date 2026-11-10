import { z } from "zod"
import { URL_MAX } from "../constants"

/** Only http(s): these urls end up as `href`s and get fetched server side, so `javascript:` and `file:` never get in. */
export const httpUrlSchema = z.string().trim().max(URL_MAX).pipe(z.httpUrl())
