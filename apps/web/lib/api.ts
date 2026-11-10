import "server-only"
import { createServerClient } from "@skiffr/orpc/server"

/** The api does the work; the web app only renders. Calls fail soft so a down api never blanks the page. */
const api = createServerClient()

export const getRepo = () => api.public.repo().catch(() => null)
