"use client"

import { displayText, safeHref } from "@skiffr/common/utils"
import { errorMessage } from "@skiffr/orpc/errors"
import { browserClient, orpc } from "@skiffr/orpc/react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@skiffr/ui/components/command"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BriefcaseIcon,
  ExternalLinkIcon,
  FileTextIcon,
  KeyRoundIcon,
  type LucideIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { SETTINGS_ENTRIES } from "@/components/settings/settings-routes"
import { bankKey, fetchAllAnswers, filterAnswers } from "@/lib/answers"
import { DEFAULT_FILTERS, listInput } from "@/lib/queue"
import { ADMIN_NAV, PRIMARY_NAV, SETTINGS_NAV } from "./nav"
import { useThemeToggle } from "./theme-toggle"

const MIN_QUERY = 2
const DEBOUNCE_MS = 200
const RESULTS = 5

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

function Row({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <>
      <Icon aria-hidden="true" />
      <span className="min-w-0 truncate">{children}</span>
    </>
  )
}

/**
 * Pages, actions and a search over your jobs and answers. It is mounted on the first open, so nothing is loaded or
 * fetched before that, and a query is only ever sent to your own api, never logged.
 */
export function CommandPalette({
  open,
  onOpenChange,
  isAdmin,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  isAdmin: boolean
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const theme = useThemeToggle()
  const [query, setQuery] = useState("")
  const term = useDebounced(query.trim())
  const searching = open && term.length >= MIN_QUERY

  const jobs = useQuery({
    ...orpc.jobs.list.queryOptions({ input: listInput({ ...DEFAULT_FILTERS, status: "all", q: term }, RESULTS) }),
    enabled: searching,
  })
  const bank = useQuery({
    queryKey: bankKey(orpc.answers.key()),
    queryFn: () => fetchAllAnswers(browserClient),
    enabled: searching,
    retry: 1,
  })
  const answers = useMemo(() => filterAnswers(bank.data ?? [], term, "all").slice(0, RESULTS), [bank.data, term])
  const jobRows = (jobs.data ?? []).slice(0, RESULTS)

  const sync = useMutation(
    orpc.gmail.syncNow.mutationOptions({
      onSuccess: (result) => {
        if (result.state === "busy") toast.message("A sync is already running.")
        else if (result.state === "stopped") toast.error("The sync stopped early. See Job sources in settings.")
        else toast.success(result.jobsAdded > 0 ? `Added ${result.jobsAdded} jobs` : "Nothing new")
        return queryClient.invalidateQueries({ queryKey: orpc.gmail.key() })
      },
      onError: (error) => toast.error(errorMessage(error)),
    }),
  )

  const close = () => {
    onOpenChange(false)
    setQuery("")
  }
  const go = (href: string) => {
    close()
    router.push(href as Route)
  }
  const openNext = async () => {
    close()
    try {
      const next = await browserClient.jobs.next()
      if (!next) return void toast.info("Nothing is queued.")
      const href = safeHref(next.url)
      if (!href) return void toast.error("That job's link is not a web address, so it was not opened.")
      window.open(href, "_blank", "noopener,noreferrer")
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Search and commands"
      description="Jump to a page, search your jobs and answers, or run an action."
    >
      <CommandInput placeholder="Search pages, jobs, answers" value={query} onValueChange={setQuery} />
      <CommandList>
        {jobRows.length + answers.length === 0 && (
          <CommandEmpty>
            {searching && !jobs.isPending && !bank.isPending ? "Nothing matches." : "No page or action matches."}
          </CommandEmpty>
        )}
        {searching && (jobs.isError || bank.isError) && (
          <p role="status" className="px-3 py-2 text-destructive text-sm">
            Could not search your {jobs.isError ? "jobs" : "answers"}. Pages and actions still work.
          </p>
        )}
        <CommandGroup heading="Pages">
          {[...PRIMARY_NAV, SETTINGS_NAV].map((item) => (
            <CommandItem key={item.href} value={`Page ${item.label}`} onSelect={() => go(item.href)}>
              <Row icon={item.icon}>{item.label}</Row>
            </CommandItem>
          ))}
          {SETTINGS_ENTRIES.map((entry) => (
            <CommandItem key={entry.href} value={`Page Settings ${entry.label}`} onSelect={() => go(entry.href)}>
              <Row icon={SETTINGS_NAV.icon}>Settings: {entry.label}</Row>
            </CommandItem>
          ))}
          {isAdmin &&
            ADMIN_NAV.map((item) => (
              <CommandItem key={item.href} value={`Page Admin ${item.label}`} onSelect={() => go(item.href)}>
                <Row icon={item.icon}>Admin: {item.label}</Row>
              </CommandItem>
            ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="Action Add job" onSelect={() => go("/queue#add-job")}>
            <Row icon={PlusIcon}>Add job</Row>
          </CommandItem>
          <CommandItem value="Action Open next job" onSelect={openNext}>
            <Row icon={ExternalLinkIcon}>Open next job</Row>
          </CommandItem>
          <CommandItem value="Action Create extension token" onSelect={() => go("/settings/extension")}>
            <Row icon={KeyRoundIcon}>Create extension token</Row>
          </CommandItem>
          <CommandItem
            value="Action Sync Gmail now"
            onSelect={() => {
              close()
              sync.mutate(undefined)
            }}
          >
            <Row icon={RefreshCwIcon}>Sync Gmail now</Row>
          </CommandItem>
          <CommandItem
            value="Action Switch theme"
            onSelect={() => {
              close()
              theme.toggle()
            }}
          >
            <Row icon={MoonIcon}>Switch to {theme.next} theme</Row>
          </CommandItem>
        </CommandGroup>
        {jobRows.length > 0 && (
          <CommandGroup heading="Jobs" forceMount>
            {jobRows.map((job) => (
              <CommandItem
                key={job.id}
                forceMount
                value={`Job ${job.id}`}
                onSelect={() => go(`/queue?q=${encodeURIComponent(job.company)}`)}
              >
                <Row icon={BriefcaseIcon}>
                  {displayText(job.title, 60)}{" "}
                  <span className="text-muted-foreground">at {displayText(job.company, 40)}</span>
                </Row>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {answers.length > 0 && (
          <CommandGroup heading="Answers" forceMount>
            {answers.map((answer) => (
              <CommandItem key={answer.id} forceMount value={`Answer ${answer.id}`} onSelect={() => go("/answers")}>
                <Row icon={FileTextIcon}>{displayText(answer.rawLabel, 80)}</Row>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
