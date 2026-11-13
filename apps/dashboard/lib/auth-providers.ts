import "server-only"
import { call } from "@/lib/api"

const OFF = { github: false, passwordReset: false }

/** What the auth pages offer, read on the server so the page paints whole. An api that is down turns the extras off. */
export async function authProviders(): Promise<{ github: boolean; passwordReset: boolean }> {
  try {
    const { github, passwordReset } = await call((client) => client.public.authProviders())
    return { github, passwordReset }
  } catch {
    return OFF
  }
}
