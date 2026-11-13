import { errorCode } from "@skiffr/orpc/errors"
import { Badge } from "@skiffr/ui/components/badge"
import { Card, CardContent } from "@skiffr/ui/components/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@skiffr/ui/components/table"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { LocalDate } from "@/components/local-date"
import { PageHeader } from "@/components/page-header"
import { call } from "@/lib/api"

export const metadata: Metadata = { title: "Users" }

export default async function UsersPage() {
  // Not an admin: the page does not exist for you (a real 404, not a crash the monitoring counts as a 5xx).
  const { total, users } = await call((api) => api.admin.users()).catch((error: unknown) => {
    if (errorCode(error) === "FORBIDDEN") notFound()
    throw error
  })
  return (
    <>
      <PageHeader title="Users" description={`${total} accounts. Admins only.`} />
      <div className="p-4 md:p-6">
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "outline"}>{u.role ?? "user"}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      <LocalDate value={u.createdAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
