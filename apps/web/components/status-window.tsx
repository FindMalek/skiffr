"use client"

import { orpc } from "@skiffr/orpc/react"
import { useQuery } from "@tanstack/react-query"

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-2">
        {ok !== undefined && <span className={ok ? "size-1.5 bg-primary" : "size-1.5 bg-destructive"} />}
        {value}
      </span>
    </div>
  )
}

/** A live call from the landing page to the api, every 10 s: proof the whole stack is up. */
export function StatusWindow() {
  const { data, isError } = useQuery({ ...orpc.public.status.queryOptions(), refetchInterval: 10_000 })
  return (
    <div className="w-full max-w-xl border bg-card text-left shadow-sm">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span className="size-2.5 rounded-full bg-muted-foreground/30" />
        <span className="ml-2 text-muted-foreground text-xs">status — live from the api</span>
      </div>
      <div className="flex flex-col gap-2 px-4 py-4 font-mono text-sm">
        {isError ? (
          <Row label="api" value="unreachable" ok={false} />
        ) : !data ? (
          <Row label="api" value="checking…" />
        ) : (
          <>
            <Row label="api" value="ok" ok />
            <Row
              label="database"
              value={data.database === "ok" ? `ok · ${data.databaseMs} ms` : "down"}
              ok={data.database === "ok"}
            />
            <Row label="environment" value={data.env} />
          </>
        )}
      </div>
    </div>
  )
}
