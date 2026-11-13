"use client"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@skiffr/ui/components/dialog"
import { Kbd } from "@skiffr/ui/components/kbd"
import Link from "next/link"
import { useId } from "react"
import { keepFocusInside } from "@/lib/keep-focus-inside"
import { useShortcutsEnabled } from "@/lib/shortcuts-setting"
import { useIsApple } from "./palette"
import { ShortcutKeys, useRegisteredShortcuts } from "./shortcuts"

type Row = { id: string; label: string; keys: React.ReactNode }
type Group = { name: string; rows: Row[] }

function Rows({ group }: { group: Group }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="font-medium text-sm">
        {group.name}
      </h3>
      <dl className="flex flex-col border-y">
        {group.rows.map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-4 border-b py-2 last:border-b-0">
            <dt className="min-w-0 text-sm">{row.label}</dt>
            <dd className="shrink-0">{row.keys}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * The `?` dialog: a list generated from the registry (what the current page registered) plus the modified keys, which
 * are not registered anywhere. A real dialog (focus is trapped and goes back to where it was, `Esc` closes), opened by
 * the `?` key and by the user menu, so it is reachable with shortcuts off.
 */
export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const enabled = useShortcutsEnabled()
  const apple = useIsApple()
  const registered = useRegisteredShortcuts()

  const mod = apple ? "⌘" : "Ctrl"
  const groups: Group[] = [
    {
      name: "Anywhere",
      rows: [
        {
          id: "palette",
          label: "Search and run actions",
          keys: (
            <span className="inline-flex gap-1">
              <Kbd>{mod}</Kbd>
              <Kbd>K</Kbd>
            </span>
          ),
        },
        {
          id: "sidebar",
          label: "Show or hide the sidebar",
          keys: (
            <span className="inline-flex gap-1">
              <Kbd>{mod}</Kbd>
              <Kbd>B</Kbd>
            </span>
          ),
        },
        { id: "escape", label: "Close a dialog or menu", keys: <Kbd>Esc</Kbd> },
      ],
    },
  ]
  // The latest registration of a pair of keys is the one that fires, so it is the one listed.
  const byKeys = new Map(registered.map((shortcut) => [shortcut.keys.join(" "), shortcut]))
  for (const shortcut of byKeys.values()) {
    let group = groups.find((candidate) => candidate.name === shortcut.group)
    if (!group) {
      group = { name: shortcut.group, rows: [] }
      groups.push(group)
    }
    group.rows.push({ id: shortcut.id, label: shortcut.label, keys: <ShortcutKeys keys={shortcut.keys} /> })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={keepFocusInside} className="max-h-11/12 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {enabled ? (
              "Single key shortcuts work while focus is in the page, not in a text field. Every action is also a button or in the search."
            ) : (
              <>
                Single key shortcuts are off in this browser, so only the ones under Anywhere work.{" "}
                <Link href="/settings/appearance" onClick={() => onOpenChange(false)}>
                  Turn them on in Appearance
                </Link>
                .
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {groups.map((group) => (
          <Rows key={group.name} group={group} />
        ))}
      </DialogContent>
    </Dialog>
  )
}
