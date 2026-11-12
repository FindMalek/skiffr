/** The header a skiffr client sends: its name and version, nothing else (`extension-chrome/0.3.1`). */
export const CLIENT_HEADER = "x-skiffr-client"

const CLIENT_PATTERN = /^([a-z][a-z0-9-]{0,31})\/(\d{1,5}\.\d{1,5}\.\d{1,5}(?:-[0-9A-Za-z.-]{1,16})?)$/

export interface ClientInfo {
  client: string
  clientVersion: string
}

export const formatClient = ({ client, clientVersion }: ClientInfo): string => `${client}/${clientVersion}`

/** `null` for a missing or malformed header: a client without it (an older extension) still works, it just is not named. */
export function parseClient(header: string | null | undefined): ClientInfo | null {
  const match = CLIENT_PATTERN.exec(header ?? "")
  return match ? { client: match[1]!, clientVersion: match[2]! } : null
}

/** Whether `version` is older than `minimum`. A pre-release is older than its release; anything unparsable is not older. */
export function isOlderVersion(version: string, minimum: string): boolean {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(value)
    return match ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: Boolean(match[4]) } : null
  }
  const a = parse(version)
  const b = parse(minimum)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a.parts[i]! !== b.parts[i]!) return a.parts[i]! < b.parts[i]!
  }
  return a.pre && !b.pre
}
