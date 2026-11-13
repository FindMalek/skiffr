"use client"

import type { AdminUser } from "@skiffr/common/schemas"
import { Button } from "@skiffr/ui/components/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@skiffr/ui/components/empty"
import { Input } from "@skiffr/ui/components/input"
import { StatusBadge } from "@skiffr/ui/components/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@skiffr/ui/components/table"
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react"
import { useId, useRef, useState } from "react"
import { RelativeTime } from "@/components/time"
import { paginate } from "@/lib/answers"
import { filterUsers, limitSentence, USERS_PAGE_SIZE, userMarkers, usersSentence } from "@/lib/users"

const PAGER_BUTTON = "aria-disabled:pointer-events-none aria-disabled:opacity-50"

const roleText = (role: string | null): string => {
  const word = role ?? "user"
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function Identity({ row }: { row: AdminUser }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span dir="auto" title={row.name} className="truncate font-medium text-sm">
        {row.name}
      </span>
      <span dir="auto" title={row.email} className="truncate text-muted-foreground">
        {row.email}
      </span>
    </div>
  )
}

function Markers({ row }: { row: AdminUser }) {
  const markers = userMarkers(row)
  if (markers.length === 0) return <span className="text-muted-foreground">Active</span>
  return (
    <div className="flex flex-wrap gap-1">
      {markers.includes("banned") && <StatusBadge tone="danger">Banned</StatusBadge>}
      {markers.includes("unverified") && <StatusBadge tone="warning">Unverified</StatusBadge>}
    </div>
  )
}

function UsersTableView({ rows }: { rows: AdminUser[] }) {
  return (
    <div className="hidden border-y md:block">
      <Table className="table-fixed">
        <caption className="sr-only">Accounts, newest first</caption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">User</TableHead>
            <TableHead scope="col" className="w-28">
              Role
            </TableHead>
            <TableHead scope="col" className="w-48">
              Status
            </TableHead>
            <TableHead scope="col" className="w-32 text-right">
              Joined
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="align-top">
                <Identity row={row} />
              </TableCell>
              <TableCell className="align-top">
                <StatusBadge>{roleText(row.role)}</StatusBadge>
              </TableCell>
              <TableCell className="align-top">
                <Markers row={row} />
              </TableCell>
              <TableCell className="text-right align-top text-muted-foreground">
                <RelativeTime value={row.createdAt} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function UsersList({ rows }: { rows: AdminUser[] }) {
  return (
    <ul className="flex flex-col border-y md:hidden" aria-label="Accounts, newest first">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-col gap-2 border-b p-3 last:border-b-0">
          <div className="flex items-start justify-between gap-3">
            <Identity row={row} />
            <StatusBadge>{roleText(row.role)}</StatusBadge>
          </div>
          <Markers row={row} />
          <p className="text-muted-foreground">
            Joined <RelativeTime value={row.createdAt} />
          </p>
        </li>
      ))}
    </ul>
  )
}

export function UsersTable({ users, total }: { users: AdminUser[]; total: number }) {
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const search = useRef<HTMLInputElement>(null)
  const noteId = useId()
  const filtered = filterUsers(users, query)
  const view = paginate(filtered, page, USERS_PAGE_SIZE)
  const first = (view.page - 1) * USERS_PAGE_SIZE + 1
  const last = first + view.rows.length - 1
  const limit = limitSentence(users.length, total)
  // A pager button that has nothing to do stays focusable (aria-disabled, not disabled), so the key that was pressed
  // never lands on an element that stops existing for the keyboard.
  const go = (target: number) => {
    if (target >= 1 && target <= view.pages) setPage(target)
  }

  return (
    <div className="flex flex-col gap-4">
      <search className="relative max-w-md">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={search}
          type="search"
          aria-label="Search users"
          aria-describedby={limit ? noteId : undefined}
          className="pl-7"
          placeholder="Search name or email"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
        />
      </search>
      {limit && (
        <p id={noteId} className="text-muted-foreground">
          {limit}
        </p>
      )}

      <p role="status" className="sr-only">
        {usersSentence(
          { filtered: filtered.length, loaded: users.length, page: view.page, pages: view.pages, first, last },
          limit !== null,
        )}
      </p>

      {users.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No accounts yet</EmptyTitle>
            <EmptyDescription>People who sign up on this server show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : filtered.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No users match</EmptyTitle>
            <EmptyDescription>Try another name or email.{limit ? ` ${limit}` : ""}</EmptyDescription>
          </EmptyHeader>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setQuery("")
              search.current?.focus()
            }}
          >
            Clear search
          </Button>
        </Empty>
      ) : (
        <>
          <UsersTableView rows={view.rows} />
          <UsersList rows={view.rows} />
          <nav aria-label="User pages" className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground tabular-nums">
              {first}-{last} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className={PAGER_BUTTON}
                aria-disabled={view.page <= 1 || undefined}
                onClick={() => go(view.page - 1)}
              >
                <ChevronLeftIcon data-icon="inline-start" />
                Previous
              </Button>
              <span className="text-muted-foreground tabular-nums">
                Page {view.page} of {view.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className={PAGER_BUTTON}
                aria-disabled={view.page >= view.pages || undefined}
                onClick={() => go(view.page + 1)}
              >
                Next
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  )
}
