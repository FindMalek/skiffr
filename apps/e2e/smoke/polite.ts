export const SMOKE_VERSION = "0.1.0"
export const SMOKE_USER_AGENT = `skiffr-smoke/${SMOKE_VERSION} (+https://github.com/FindMalek/skiffr; read-only smoke)`

const TRACKERS =
  /(^|\.)(google-analytics\.com|googletagmanager\.com|doubleclick\.net|googlesyndication\.com|facebook\.net|facebook\.com|hotjar\.com|segment\.(io|com)|mixpanel\.com|amplitude\.com|fullstory\.com|sentry\.io|datadoghq\.com|datadoghq-browser-agent\.com|newrelic\.com|nr-data\.net|intercom\.io|intercomcdn\.com|hs-scripts\.com|hsforms\.net|hs-analytics\.net|clarity\.ms|linkedin\.com|licdn\.com|twitter\.com|ads-twitter\.com|tiktok\.com|bing\.com|optimizely\.com|heapanalytics\.com|logrocket\.com|clearbit\.com|6sense\.com|demandbase\.com|onetrust\.com|cookielaw\.org|osano\.com|recaptcha\.net|posthog\.com|launchdarkly\.com|statsig\.com)$/i

export const isTrackerHost = (hostname: string): boolean => TRACKERS.test(hostname)

/** Lets one task per key run at a time: a host is never asked for two things at once. */
export function createHostLimiter(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>()
  return (key, task) => {
    const result = (tails.get(key) ?? Promise.resolve()).then(task)
    const tail = result.catch(() => undefined)
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return result
  }
}

export const isRefusal = (status: number, resourceType: string): boolean =>
  status === 429 || (status === 403 && ["document", "xhr", "fetch"].includes(resourceType))

/** Counts the 429 and 403 answers of each host. A second one means the host does not want the visits: the run stops. */
export function createStrikes(limit = 2): {
  record: (host: string) => number
  stopped: () => string | null
} {
  const counts = new Map<string, number>()
  let stoppedBy: string | null = null
  return {
    record(host) {
      const count = (counts.get(host) ?? 0) + 1
      counts.set(host, count)
      if (count >= limit && stoppedBy === null) stoppedBy = host
      return count
    },
    stopped: () => stoppedBy,
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
