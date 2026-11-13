/** The header a skiffr client sends: its name and version, nothing else (`extension-chrome/0.0.1`). */
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

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/

const compareIdentifier = (a: string, b: string): number => {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b))
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semver order: numbers first, a pre-release is older than its release, pre-release identifiers compare one by one. `null` when either side is not a version. */
function compareVersions(a: string, b: string): number | null {
  const left = VERSION_PATTERN.exec(a)
  const right = VERSION_PATTERN.exec(b)
  if (!left || !right) return null
  for (let i = 1; i <= 3; i++) {
    const diff = Number(left[i]) - Number(right[i])
    if (diff !== 0) return Math.sign(diff)
  }
  if (!left[4] || !right[4]) return left[4] === right[4] ? 0 : left[4] ? -1 : 1
  const x = left[4].split(".")
  const y = right[4].split(".")
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const diff = compareIdentifier(x[i]!, y[i]!)
    if (diff !== 0) return diff
  }
  return Math.sign(x.length - y.length)
}

/** Whether `version` is older than `minimum`. Anything unparsable is not older. */
export const isOlderVersion = (version: string, minimum: string): boolean => compareVersions(version, minimum) === -1
