import { firstName } from "@skiffr/common/utils"
import { nextEnv } from "@skiffr/env/next"
import { Button } from "@skiffr/ui/components/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@skiffr/ui/components/card"
import Link from "next/link"
import { LocalDate } from "@/components/local-date"
import { PageHeader } from "@/components/page-header"
import { call } from "@/lib/api"

export default async function OverviewPage() {
  const [me, stats, notes] = await Promise.all([
    call((api) => api.me.get()),
    call((api) => api.notes.stats()),
    call((api) => api.notes.list()),
  ])
  const env = nextEnv()
  return (
    <>
      <PageHeader title="Overview" description={`Hello ${firstName(me.name)}, here's where things stand.`} />
      <div className="grid gap-4 p-4 md:grid-cols-3 md:p-6">
        <Card>
          <CardHeader>
            <CardDescription>Notes</CardDescription>
            <CardTitle className="font-heading text-4xl tabular-nums">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Pinned</CardDescription>
            <CardTitle className="font-heading text-4xl tabular-nums">{stats.pinned}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>API</CardDescription>
            <CardTitle className="font-heading text-xl">REST + RPC</CardTitle>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                render={<a href={`${env.API_PUBLIC_URL}/v1/docs`} />}
                nativeButton={false}
              >
                Docs
              </Button>
            </CardAction>
          </CardHeader>
        </Card>
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Recent notes</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" render={<Link href="/notes" />} nativeButton={false}>
                All notes
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {notes.slice(0, 5).map((note) => (
              <div key={note.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="truncate">{note.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  <LocalDate value={note.updatedAt} />
                </span>
              </div>
            ))}
            {!notes.length && <p className="py-2 text-muted-foreground text-sm">No notes yet.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
