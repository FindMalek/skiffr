import type { Db } from "@skiffr/db"

/** Who runs the schedule when several api replicas are up. */
export interface Leader {
  /** True while this process holds the lead (and when it just took it). */
  tryAcquire(): Promise<boolean>
  release(): Promise<void>
}

const LOCK = "hashtext('skiffr:gmail-sync')"

/**
 * A session level `pg_try_advisory_lock` on a connection set aside for it (a pooled connection would not keep the
 * lock between calls). It frees itself when the process or its connection dies, so another replica takes over.
 */
export function advisoryLeader(db: Db): Leader {
  const client = db.$client
  let held: Awaited<ReturnType<typeof client.reserve>> | null = null

  const drop = async () => {
    const connection = held
    held = null
    try {
      connection?.release()
    } catch {}
  }

  return {
    async tryAcquire() {
      if (held) {
        try {
          await held.unsafe("select 1")
          return true
        } catch {
          await drop()
        }
      }
      const connection = await client.reserve()
      try {
        const [row] = await connection.unsafe<{ locked: boolean }[]>(`select pg_try_advisory_lock(${LOCK}) as locked`)
        if (row?.locked) {
          held = connection
          return true
        }
      } catch {}
      connection.release()
      return false
    },
    async release() {
      const connection = held
      if (!connection) return
      try {
        await connection.unsafe(`select pg_advisory_unlock(${LOCK})`)
      } catch {}
      await drop()
    },
  }
}
